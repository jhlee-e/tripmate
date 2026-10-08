// 여행 기록: 공개 설정 · 후기(여행 전체 + 장소별 한줄평) · 사진 (여행 정보 화면 trip.html에서 사용)
// 입력: 여행(trips 행), 저장된 일정(plan, 아직 없으면 null), 사용자가 고른 공개 여부·별점·글·사진 파일
// 출력: trips.is_public·shared_courses·reviews·photos에 저장하고 화면에 그림. 사진 파일은 Storage 버킷 'trip-photos'에 올림

const PHOTO_BUCKET = 'trip-photos';
const PHOTO_MAX_SIDE = 1600;     // 올리기 전에 긴 변을 1600px로 줄임 (휴대폰 원본 5~10MB → 수백 KB)
const PHOTO_NEAR_KM = 1;         // 사진 GPS에서 이 거리 안에 일정 장소가 있으면 그 장소로 미리 골라 둠

async function setupMemories(trip, plan) {
  const places = planPlaces(plan);
  setupShare(trip, plan);
  setupReviews(trip, places);
  setupPhotos(trip, places);
}

// 일정에 들어간 장소 목록 (같은 장소는 한 번, 숙소 조식처럼 장소 파일에 없는 가짜 장소는 뺌, 숙소는 맨 끝)
function planPlaces(plan) {
  if (!plan) return [];
  const seen = {}, list = [];
  function add(p) {
    const id = String(p.id);
    if (seen[id] || p.breakfastOf != null || id.indexOf('bf-') === 0) return;
    seen[id] = true;
    list.push({ id: id, name: p.name, type: p.type, lat: p.lat, lng: p.lng });
  }
  plan.days.forEach(function (d) { d.stops.forEach(function (s) { add(s.p); }); });
  if (plan.lodging) add(plan.lodging);
  return list;
}

// ---------- 별점 입력 (★ 5개) ----------
// 입력: 넣을 칸, 처음 값(0 = 없음), 바뀔 때 부를 함수, 같은 별을 다시 누르면 지울 수 있는지
// 출력: { get() } — 지금 고른 별점
function starInput(box, value, onChange, clearable) {
  box.classList.add('stars');
  box.innerHTML = '';
  let cur = value || 0;
  const btns = [];
  for (let i = 1; i <= 5; i++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = '★';
    b.title = i + '점';
    b.addEventListener('click', function () {
      cur = clearable && cur === i ? 0 : i;
      paint();
      if (onChange) onChange(cur);
    });
    btns.push(b);
    box.appendChild(b);
  }
  function paint() { btns.forEach(function (b, k) { b.classList.toggle('on', k < cur); }); }
  paint();
  return { get: function () { return cur; } };
}

// ---------- 1. 공개 설정 ----------
// 공개하면 다른 사람이 '공개 코스' 화면에서 일정·후기·한줄평과 '공개'로 고른 사진을 볼 수 있음 (출발지·예산은 보이지 않음)
async function setupShare(trip, plan) {
  const card = document.getElementById('share-card');
  if (!plan) { card.hidden = true; return; }
  card.hidden = false;
  const box = document.getElementById('share-public');
  const title = document.getElementById('share-title');
  const msg = document.getElementById('share-msg');

  const res = await sb.from('shared_courses').select('*').eq('trip_id', trip.id).maybeSingle();
  if (res.error) return showError(res.error);
  let course = res.data;
  box.checked = !!trip.is_public;
  title.value = course ? course.title : trip.region + ' ' + (trip.days > 1 ? (trip.days - 1) + '박 ' : '') + trip.days + '일 코스';

  function showState() {
    title.disabled = !box.checked;
    if (trip.is_public && course) {
      msg.innerHTML = '공개 중이에요 · ' + course.saved_count + '명이 담아 갔어요 · <a href="courses.html?course=' + course.id + '">공개 코스에서 보기 →</a>';
    } else {
      msg.textContent = '비공개예요. 나만 볼 수 있어요.';
    }
  }
  showState();
  box.addEventListener('change', function () { title.disabled = !box.checked; });

  document.getElementById('share-save').addEventListener('click', async function () {
    const name = title.value.trim();
    if (box.checked && !name) { msg.textContent = '코스 제목을 입력해 주세요.'; return; }
    this.disabled = true;
    try {
      if (box.checked) {
        // 코스 행을 만들거나 제목만 바꿈 (trip_id가 같으면 기존 행 갱신 → 담은 횟수는 유지)
        const up = await sb.from('shared_courses').upsert({ trip_id: trip.id, title: name }, { onConflict: 'trip_id' }).select().single();
        if (up.error) throw up.error;
        course = up.data;
      }
      // 비공개로 바꿔도 코스 행은 남겨 둠 (다시 공개하면 담은 횟수가 이어짐). 남에게는 trips.is_public이 false라 안 보임
      const t = await sb.from('trips').update({ is_public: box.checked }).eq('id', trip.id);
      if (t.error) throw t.error;
      trip.is_public = box.checked;
      showError(null);
      showState();
    } catch (e) { showError(e); }
    this.disabled = false;
  });
}

// ---------- 2. 후기: 여행 전체(별점 필수 + 글) · 장소별 한줄평(별점 선택 + 짧은 글) ----------
async function setupReviews(trip, places) {
  const res = await sb.from('reviews').select('*').eq('trip_id', trip.id);
  if (res.error) return showError(res.error);
  const byPlace = {};
  let tripReview = null;
  res.data.forEach(function (r) { if (r.place_id == null) tripReview = r; else byPlace[r.place_id] = r; });

  // 여행 전체 후기
  const text = document.getElementById('review-text');
  const msg = document.getElementById('review-msg');
  const stars = starInput(document.getElementById('review-stars'), tripReview ? tripReview.rating : 0, null, false);
  text.value = tripReview ? tripReview.content || '' : '';
  msg.textContent = tripReview ? '저장된 후기예요.' : '';
  document.getElementById('review-save').addEventListener('click', async function () {
    if (!stars.get()) { msg.textContent = '별점을 골라 주세요.'; return; }
    const row = { rating: stars.get(), content: text.value.trim() || null };
    const q = tripReview
      ? sb.from('reviews').update(row).eq('id', tripReview.id).select().single()
      : sb.from('reviews').insert(Object.assign({ trip_id: trip.id }, row)).select().single();
    const { data, error } = await q;
    if (error) return showError(error);
    tripReview = data;
    showError(null);
    msg.textContent = '후기를 저장했어요.';
  });

  // 장소별 한줄평: 별점이나 글을 바꾸면 바로 저장, 둘 다 비우면 지움
  const list = document.getElementById('place-reviews');
  list.innerHTML = '';
  document.getElementById('place-review-box').hidden = places.length === 0;
  places.forEach(function (p) {
    const li = document.createElement('li');
    li.className = 'place-review';
    li.innerHTML = '<span class="pr-name"></span><span class="pr-stars"></span>' +
                   '<input type="text" maxlength="60" placeholder="한줄평 (예: 일몰 때 가면 최고)"><span class="pr-state muted"></span>';
    li.querySelector('.pr-name').textContent = (p.type === '숙소' ? '🏨 ' : p.type === '식당' ? '🍴 ' : '') + p.name;
    const input = li.querySelector('input');
    const state = li.querySelector('.pr-state');
    let row = byPlace[p.id] || null;
    input.value = row ? row.content || '' : '';
    const st = starInput(li.querySelector('.pr-stars'), row ? row.rating : 0, save, true);

    async function save() {
      const rating = st.get() || null, content = input.value.trim() || null;
      let r;
      if (!rating && !content) {
        if (!row) return;
        r = await sb.from('reviews').delete().eq('id', row.id);
        if (!r.error) row = null;
      } else if (row) {
        r = await sb.from('reviews').update({ rating: rating, content: content }).eq('id', row.id).select().single();
        if (!r.error) row = r.data;
      } else {
        r = await sb.from('reviews').insert({ trip_id: trip.id, place_id: p.id, place_name: p.name, rating: rating, content: content }).select().single();
        if (!r.error) row = r.data;
      }
      if (r.error) return showError(r.error);
      showError(null);
      state.textContent = '저장됨';
      setTimeout(function () { state.textContent = ''; }, 1500);
    }
    input.addEventListener('change', save);   // 칸을 벗어나거나 Enter를 누르면 저장
    list.appendChild(li);
  });
}

// ---------- 3. 사진 ----------
// 사진 속 GPS가 있으면 그 위치를 쓰고 가까운 일정 장소를 미리 골라 둠, 없으면 일정 장소를 꼭 골라야 함

async function setupPhotos(trip, places) {
  const { data: auth } = await sb.auth.getUser();
  const userId = auth.user.id;
  const fileInput = document.getElementById('photo-input');
  const pendingBox = document.getElementById('photo-pending');
  const uploadBtn = document.getElementById('photo-upload');
  const msg = document.getElementById('photo-msg');
  let pending = [];   // [{ file, gps, el }]

  function placeOptions(gps) {
    return (gps ? '<option value="gps">📍 사진 위치 (장소 지정 안 함)</option>' : '<option value="">장소를 골라 주세요</option>') +
      places.map(function (p, i) { return '<option value="' + i + '">' + esc(p.name) + '</option>'; }).join('');
  }

  fileInput.addEventListener('change', async function () {
    const files = Array.from(fileInput.files);
    fileInput.value = '';
    for (const file of files) {
      let gps = null;
      try { gps = await exifr.gps(file); } catch (e) { gps = null; }       // GPS가 없거나 읽을 수 없는 형식이면 null
      if (gps && !(isFinite(gps.latitude) && isFinite(gps.longitude))) gps = null;
      const el = document.createElement('li');
      el.className = 'pending-photo';
      el.innerHTML = '<img alt=""><div class="pp-body"><span class="pp-name"></span>' +
        '<select class="pp-place">' + placeOptions(gps) + '</select>' +
        '<label class="pp-public"><input type="checkbox"> 공개</label>' +
        '<span class="helper-text muted">' + (gps ? 'GPS 위치가 있는 사진이에요' : '사진에 위치 정보가 없어요') + '</span></div>' +
        '<button type="button" class="link-btn">빼기</button>';
      el.querySelector('img').src = URL.createObjectURL(file);
      el.querySelector('.pp-name').textContent = file.name;
      if (gps) {   // 가장 가까운 일정 장소 (1km 안)
        let best = -1, bestKm = PHOTO_NEAR_KM;
        places.forEach(function (p, i) {
          const km = distanceKm({ lat: gps.latitude, lng: gps.longitude }, p);
          if (km < bestKm) { bestKm = km; best = i; }
        });
        if (best >= 0) el.querySelector('select').value = String(best);
      }
      const item = { file: file, gps: gps, el: el };
      el.querySelector('button').addEventListener('click', function () {
        pending = pending.filter(function (x) { return x !== item; });
        el.remove();
        uploadBtn.hidden = pending.length === 0;
      });
      pending.push(item);
      pendingBox.appendChild(el);
    }
    uploadBtn.hidden = pending.length === 0;
    if (!places.length) msg.textContent = '일정이 없는 여행이라 위치 정보가 있는 사진만 지도에 표시돼요.';
  });

  uploadBtn.addEventListener('click', async function () {
    const missing = pending.filter(function (x) { return !x.el.querySelector('select').value && places.length; });
    if (missing.length) { msg.textContent = '위치 정보가 없는 사진은 장소를 골라 주세요.'; return; }
    uploadBtn.disabled = true;
    let done = 0;
    for (const item of pending.slice()) {
      msg.textContent = '올리는 중… (' + (done + 1) + ' / ' + pending.length + ')';
      try {
        const blob = await shrinkImage(item.file);
        const path = userId + '/' + trip.id + '/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.jpg';
        const up = await sb.storage.from(PHOTO_BUCKET).upload(path, blob, { contentType: 'image/jpeg' });
        if (up.error) throw up.error;
        const v = item.el.querySelector('select').value;
        const p = v !== '' && v !== 'gps' ? places[Number(v)] : null;
        const row = {
          trip_id: trip.id, url: path, place_name: p ? p.name : null,
          lat: item.gps ? item.gps.latitude : (p ? p.lat : null),
          lng: item.gps ? item.gps.longitude : (p ? p.lng : null),
          is_public: item.el.querySelector('.pp-public input').checked
        };
        const ins = await sb.from('photos').insert(row);
        if (ins.error) { await sb.storage.from(PHOTO_BUCKET).remove([path]); throw ins.error; }
        item.el.remove();
        pending = pending.filter(function (x) { return x !== item; });
        done++;
      } catch (e) {
        showError({ message: item.file.name + ' — ' + (e.message || '이 사진 형식은 열 수 없어요 (JPG·PNG로 바꿔 주세요)') });
      }
    }
    msg.textContent = done ? '사진 ' + done + '장을 올렸어요.' : '';
    uploadBtn.disabled = false;
    uploadBtn.hidden = pending.length === 0;
    loadGallery();
  });

  async function loadGallery() {
    const { data, error } = await sb.from('photos').select('*').eq('trip_id', trip.id).order('created_at');
    if (error) return showError(error);
    const grid = document.getElementById('photo-grid');
    grid.innerHTML = '';
    document.getElementById('photo-empty').hidden = data.length > 0;
    if (!data.length) return;
    const urls = await signedUrls(data.map(function (r) { return r.url; }));
    data.forEach(function (r) {
      const fig = document.createElement('figure');
      fig.className = 'photo-item';
      fig.innerHTML = '<a target="_blank" rel="noopener"><img alt="" loading="lazy"></a><figcaption>' +
        '<span class="pi-place"></span><label><input type="checkbox"> 공개</label>' +
        '<button type="button" class="link-btn danger-link">삭제</button></figcaption>';
      fig.querySelector('a').href = urls[r.url] || '#';
      fig.querySelector('img').src = urls[r.url] || '';
      fig.querySelector('.pi-place').textContent = r.place_name || (r.lat != null ? '📍 사진 위치' : '장소 없음');
      const box = fig.querySelector('input');
      box.checked = r.is_public;
      box.addEventListener('change', async function () {
        const { error } = await sb.from('photos').update({ is_public: box.checked }).eq('id', r.id);
        if (error) { box.checked = !box.checked; showError(error); }
      });
      fig.querySelector('button').addEventListener('click', async function () {
        if (!confirm('이 사진을 삭제할까요?')) return;
        const del = await sb.from('photos').delete().eq('id', r.id);
        if (del.error) return showError(del.error);
        await sb.storage.from(PHOTO_BUCKET).remove([r.url]);
        loadGallery();
      });
      grid.appendChild(fig);
    });
  }
  loadGallery();
}

// Storage 경로 여러 개 → { 경로: 1시간짜리 보기 주소 } (비공개 버킷이라 주소에 서명이 붙어야 열림)
async function signedUrls(paths) {
  const out = {};
  if (!paths.length) return out;
  const { data, error } = await sb.storage.from(PHOTO_BUCKET).createSignedUrls(paths, 3600);
  if (error) { console.error(error); return out; }
  data.forEach(function (d) { if (d.signedUrl) out[d.path] = d.signedUrl; });
  return out;
}

// 사진 줄이기: 긴 변을 PHOTO_MAX_SIDE 이하로, JPEG 85% 품질 (휴대폰 사진의 회전 방향은 그대로 반영)
async function shrinkImage(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return new Promise(function (resolve, reject) {
    canvas.toBlob(function (b) { b ? resolve(b) : reject(new Error('사진을 변환하지 못했어요')); }, 'image/jpeg', 0.85);
  });
}
