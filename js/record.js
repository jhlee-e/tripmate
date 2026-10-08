// 내 여행(목록) 화면 스크립트
// 입력: 로그인한 사용자의 trips 행, 사용자가 누른 여행 칸·삭제 버튼
// 출력: 저장한 여행 목록을 그림. 여행을 누르면 그 여행의 모든 정보(일정·비용·준비물)를 보는 trip.html로 이동
//       6차시: 나의 기록 지도 — 내 여행들의 일정 장소(여행별 색 점)와 사진(썸네일 동그라미)을 한 지도에

const TRIP_COLORS = ['#2f8f7e', '#e07a2f', '#3b6fd8', '#b8437a', '#7a5cc4', '#c49a1a', '#4a8a2a', '#d0473b'];
let myId = null;   // 내 사용자 id — 친구에게 공유받은 여행(주인이 다른 여행)을 구분할 때 사용

async function loadTrips() {
  const { data, error } = await sb.from('trips').select('*').order('start_date', { ascending: true });
  if (error) return showError(error);

  const list = document.getElementById('trip-list');
  list.innerHTML = '';
  document.getElementById('trip-empty').hidden = data.length > 0;

  data.forEach(function (trip) {
    const shared = myId && trip.user_id !== myId;   // 친구가 초대해 준 여행
    const li = document.createElement('li');
    li.className = 'trip-item';
    li.innerHTML =
      '<div class="trip-info">' +
        '<strong></strong>' +
        '<span>' + trip.days + '일 · ' + peopleText(trip) + ' · ' + trip.transport + ' · ' + trip.tempo + '</span>' +
        '<span class="trip-tags">' + trip.tags.map(function (t) { return '#' + t; }).join(' ') + '</span>' +
        '<span class="trip-from"></span>' +
        (trip.region ? '<span class="trip-tags">📍 ' + esc(trip.region) + ' · ' + trip.plan_type + '안' +
          (trip.total_cost ? ' · ' + won(trip.total_cost) : '') + '</span>'
                     : '<span class="muted">아직 여행지를 고르지 않았어요</span>') +
      '</div>' +
      '<div class="trip-actions">' +
        '<button type="button" class="small-btn danger">' + (shared ? '나가기' : '삭제') + '</button>' +
      '</div>';
    li.querySelector('strong').textContent = tripTitle(trip) + ' (' + trip.days + '일)';
    if (shared) li.querySelector('strong').insertAdjacentHTML('afterend', '<span class="shared-badge">👥 함께하는 여행</span>');
    else if (trip.invite_code) li.querySelector('strong').insertAdjacentHTML('afterend', '<span class="shared-badge">👥 친구 초대 중</span>');
    li.querySelector('.trip-from').textContent = '출발: ' + (trip.departure_address || '-');
    li.addEventListener('click', function () { location.href = 'trip.html?trip=' + trip.id; });
    li.querySelector('button.danger').addEventListener('click', function (e) {
      e.stopPropagation();   // 삭제 버튼을 누를 때 여행 열기가 같이 일어나지 않게
      if (shared) leaveTrip(trip.id); else deleteTrip(trip.id);
    });
    list.appendChild(li);
  });
  return data;
}

async function leaveTrip(id) {
  if (!confirm('이 여행에서 나갈까요? 다시 들어오려면 초대 링크가 필요해요.')) return;
  const { error } = await sb.from('trip_members').delete().eq('trip_id', id).eq('user_id', myId);
  if (error) return showError(error);
  refreshAll();
}

async function deleteTrip(id) {
  if (!confirm('이 여행을 삭제할까요? 일정과 준비물도 함께 지워집니다.')) return;
  const { error } = await sb.from('trips').delete().eq('id', id);
  if (error) return showError(error);
  refreshAll();
}

// 여행 목록과 기록 지도를 함께 다시 그림 (삭제한 여행의 점·사진도 지도에서 빠지도록)
async function refreshAll() {
  const trips = await loadTrips();
  document.getElementById('map-card').hidden = true;
  if (trips && trips.length) drawRecordMap(trips);
}

// ---------- 나의 기록 지도 ----------
// 입력: 내 여행 목록 → 그 여행들의 trip_places·photos / 출력: 여행별 색 점, 사진 동그라미, 누르면 작은 창
async function drawRecordMap(trips) {
  const ids = trips.map(function (t) { return t.id; });
  const [pl, ph] = await Promise.all([
    sb.from('trip_places').select('trip_id,place_id,name,type,lat,lng').in('trip_id', ids),
    sb.from('photos').select('*').in('trip_id', ids).not('lat', 'is', null)
  ]);
  if (pl.error) return showError(pl.error);
  if (ph.error) return showError(ph.error);
  const places = pl.data.filter(function (r) { return r.lat != null && String(r.place_id).indexOf('bf-') !== 0; });
  if (!places.length && !ph.data.length) return;   // 지도에 찍을 게 없으면 지도 칸을 숨긴 채로 둠

  const urls = await signedUrls(ph.data.map(function (r) { return r.url; }));
  const byId = {}, color = {};
  trips.forEach(function (t, i) { byId[t.id] = t; color[t.id] = TRIP_COLORS[i % TRIP_COLORS.length]; });
  const today = new Date().toISOString().slice(0, 10);

  document.getElementById('map-card').hidden = false;
  kakao.maps.load(function () {
    const map = new kakao.maps.Map(document.getElementById('record-map'), { center: new kakao.maps.LatLng(36.3, 127.8), level: 12 });
    map.addControl(new kakao.maps.ZoomControl(), kakao.maps.ControlPosition.RIGHT);
    const all = new kakao.maps.LatLngBounds(), perTrip = {};
    let popup = null;

    function openPopup(pos, html) {
      if (popup) popup.setMap(null);
      const el = document.createElement('div');
      el.className = 'map-popup';
      el.innerHTML = '<button type="button" aria-label="닫기">✕</button>' + html;
      el.querySelector('button').addEventListener('click', function () { popup.setMap(null); });
      popup = new kakao.maps.CustomOverlay({ position: pos, content: el, yAnchor: 1, zIndex: 10 });
      popup.setMap(map);
    }
    function add(tripId, lat, lng, el, html) {
      const pos = new kakao.maps.LatLng(lat, lng);
      all.extend(pos);
      (perTrip[tripId] = perTrip[tripId] || new kakao.maps.LatLngBounds()).extend(pos);
      el.addEventListener('click', function () { openPopup(pos, html); });
      new kakao.maps.CustomOverlay({ position: pos, content: el, yAnchor: 0.5 }).setMap(map);
    }
    function tripLink(t) { return '<a href="trip.html?trip=' + t.id + '">' + esc(tripTitle(t)) + ' →</a>'; }

    places.forEach(function (r) {
      const t = byId[r.trip_id];
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'map-pin';
      el.style.cssText = 'min-width:14px;height:14px;padding:0;background:' + color[r.trip_id];
      el.title = r.name;
      add(r.trip_id, r.lat, r.lng, el, '<strong>' + (r.type === '숙소' ? '🏨 ' : r.type === '식당' ? '🍴 ' : '') + esc(r.name) + '</strong><br>' + tripLink(t));
    });
    ph.data.forEach(function (r) {
      const t = byId[r.trip_id], url = urls[r.url] || '';
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'photo-pin';
      el.style.backgroundImage = 'url("' + url + '")';
      el.style.borderColor = color[r.trip_id];
      add(r.trip_id, r.lat, r.lng, el, '<img src="' + esc(url) + '" alt=""><strong>' + esc(r.place_name || '사진 위치') + '</strong><br>' + tripLink(t));
    });
    map.setBounds(all, 40, 40, 40, 40);

    // 범례: 여행별 색, 누르면 그 여행으로 확대
    const legend = document.getElementById('map-legend');
    legend.innerHTML = '';
    trips.forEach(function (t) {
      if (!perTrip[t.id]) return;
      const li = document.createElement('li');
      li.innerHTML = '<span class="dot" style="background:' + color[t.id] + '"></span>';
      li.appendChild(document.createTextNode(tripTitle(t) + (t.start_date > today ? ' (예정)' : '')));
      li.addEventListener('click', function () { map.setBounds(perTrip[t.id], 40, 40, 40, 40); });
      legend.appendChild(li);
    });
  });
}

// Storage 경로 여러 개 → { 경로: 1시간짜리 보기 주소 } (사진 버킷이 비공개라 서명된 주소가 필요)
async function signedUrls(paths) {
  const out = {};
  if (!paths.length) return out;
  const { data, error } = await sb.storage.from('trip-photos').createSignedUrls(paths, 3600);
  if (error) { console.error(error); return out; }
  data.forEach(function (d) { if (d.signedUrl) out[d.path] = d.signedUrl; });
  return out;
}

async function start() {
  const user = await requireLogin();
  if (!user) return;
  myId = user.id;
  const { data } = await sb.from('users').select('nickname').eq('id', user.id).single();
  document.getElementById('nav-user').textContent = (data ? data.nickname : user.email) + '님';
  refreshAll();
}

start();
