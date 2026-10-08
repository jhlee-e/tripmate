// 공개 코스 화면
// 입력: (목록) public_courses 보기 전체, 검색어·정렬 / (코스 하나) 주소의 ?course=번호 → 그 코스의 일정(trip_places)·후기·한줄평(reviews)·공개 사진(photos)
// 출력: 공개 코스 목록, 또는 코스 하나의 날짜별 일정·지도·후기·사진과 '내 여행에 담기' 버튼(→ condition.html?copy=번호)
//       출발지·예산은 public_courses 보기에 들어 있지 않아서 화면에도 나오지 않음
//       로그인하지 않은 사람: 목록과 코스 개요(코스 정보·여행 후기)까지만 보여 주고, 날짜별 일정·지도·사진은 로그인 후

const DAY_COLORS = ['#2f8f7e', '#e07a2f', '#3b6fd8', '#b8437a', '#7a5cc4', '#c49a1a', '#4a8a2a'];
let me = null;

async function start() {
  const { data: sess } = await sb.auth.getSession();
  me = sess.session ? sess.session.user : null;
  if (me) {
    sb.from('users').select('nickname').eq('id', me.id).single().then(function (res) {
      document.getElementById('nav-user').textContent = (res.data ? res.data.nickname : me.email) + '님';
    });
  } else {
    // 비로그인: 위쪽 메뉴를 '로그인 · 회원가입'으로 바꿈 (로그인 뒤 지금 보던 화면으로 돌아오도록 next 전달)
    const back = encodeURIComponent('courses.html' + location.search);
    document.querySelector('.top-nav').innerHTML = '<span id="nav-user">둘러보는 중</span>' +
      '<a href="index.html?next=' + back + '">로그인</a><a href="signup.html">회원가입</a>';
    document.getElementById('subtitle').textContent = '다른 여행자가 공개한 코스를 둘러보세요. 로그인하면 날짜별 일정·지도·사진까지 보고 내 여행에 담을 수 있어요';
  }
  try {
    if (param('course')) await showCourse(Number(param('course')));
    else await showList();
  } catch (e) { showError(e); }
}

function starsText(n) { return n ? '<span class="stars-text">' + '★'.repeat(n) + '☆'.repeat(5 - n) + '</span>' : ''; }
function nightsText(days) { return (days > 1 ? (days - 1) + '박 ' : '당일 ') + days + '일'; }

// ---------- 목록 ----------
async function showList() {
  const { data, error } = await sb.from('public_courses').select('*');
  if (error) throw error;
  document.getElementById('status').textContent = '';
  document.getElementById('list-view').hidden = false;
  const search = document.getElementById('search'), sort = document.getElementById('sort');

  function render() {
    const q = search.value.trim();
    const rows = data.filter(function (c) { return !q || c.region.indexOf(q) !== -1 || c.title.indexOf(q) !== -1; });
    const key = sort.value;
    rows.sort(function (a, b) {
      if (key === 'saved') return b.saved_count - a.saved_count;
      if (key === 'rating') return (b.rating || 0) - (a.rating || 0);
      return b.created_at < a.created_at ? -1 : 1;
    });
    const list = document.getElementById('course-list');
    list.innerHTML = '';
    document.getElementById('course-empty').hidden = rows.length > 0;
    rows.forEach(function (c) {
      const li = document.createElement('li');
      li.className = 'course-item';
      li.innerHTML = '<strong></strong>' +
        '<span class="meta">📍 ' + esc(c.region) + ' · ' + nightsText(c.days) + ' · ' + esc(c.tempo) + ' · ' + esc(c.transport) +
          ' · ' + c.tags.map(function (t) { return '#' + esc(t); }).join(' ') + '</span>' +
        '<span class="meta">' + (c.rating ? starsText(c.rating) + ' · ' : '') + c.saved_count + '명이 담음 · ' +
          (me && c.user_id === me.id ? '<span class="mine">내 코스</span>' : esc(c.nickname) + '님') + '</span>';
      li.querySelector('strong').textContent = c.title;
      li.addEventListener('click', function () { location.href = 'courses.html?course=' + c.id; });
      list.appendChild(li);
    });
  }
  search.addEventListener('input', render);
  sort.addEventListener('change', render);
  render();
}

// ---------- 코스 개요 (로그인하지 않은 사람) ----------
// 입력: public_courses 한 행 / 출력: 코스 정보·여행 후기와 '로그인하고 전체 일정 보기' 안내 (일정·지도·사진은 불러오지 않음)
function showOverview(course) {
  document.title = 'TripMate - ' + course.title;
  document.getElementById('title').textContent = course.title;
  document.getElementById('subtitle').textContent = course.region + ' · ' + nightsText(course.days) + ' · ' + course.nickname + '님의 코스';
  document.getElementById('status').textContent = '';
  document.getElementById('course-view').hidden = false;
  fillInfo(course);
  const next = encodeURIComponent('courses.html?course=' + course.id);
  const copyBtn = document.getElementById('copy-btn');
  copyBtn.textContent = '로그인하고 전체 일정 보기';
  copyBtn.href = 'index.html?next=' + next;
  document.getElementById('copy-note').innerHTML = '날짜별 일정·지도·사진은 로그인한 회원에게만 보여요. 계정이 없다면 <a href="signup.html">회원가입</a>';
  document.getElementById('schedule').innerHTML = '<div class="locked-box">🔒 ' + course.days + '일 동안의 일정과 지도는 로그인하면 볼 수 있어요.</div>';
  document.querySelector('.trip-side').hidden = true;
  document.getElementById('course-view').classList.add('overview-only');
}

// 코스 정보 표 + 여행 전체 후기 (개요·전체 보기 공통)
function fillInfo(course) {
  const rows = [
    ['여행지', course.region + ' · ' + course.plan_type + '안'],
    ['기간', nightsText(course.days)],
    ['인원', course.people + '명' + (course.days > 1 ? ' · 방 ' + (course.rooms || 1) + '개' : '')],
    ['이동 수단', course.transport],
    ['템포', course.tempo],
    ['취향', course.tags.map(function (t) { return '#' + t; }).join(' ')],
    ['총비용', course.total_cost ? won(course.total_cost) + ' (1인 약 ' + won(course.total_cost / course.people) + ')' : '-'],
    ['담은 사람', course.saved_count + '명']
  ];
  document.getElementById('info-list').innerHTML = rows.map(function (r) { return '<dt>' + r[0] + '</dt><dd>' + esc(r[1]) + '</dd>'; }).join('');
  if (course.rating) {
    document.getElementById('review-box').innerHTML = '<p class="helper-text">' + starsText(course.rating) + ' 여행 후기</p>' +
      (course.review ? '<p class="review-quote">' + esc(course.review) + '</p>' : '');
  }
}

// ---------- 코스 하나 ----------
async function showCourse(id) {
  const c = await sb.from('public_courses').select('*').eq('id', id).maybeSingle();
  if (c.error) throw c.error;
  if (!c.data) { document.getElementById('status').textContent = '코스를 찾을 수 없어요. 비공개로 바뀌었을 수 있어요.'; return; }
  const course = c.data;
  if (!me) return showOverview(course);
  const [pl, rv, ph] = await Promise.all([
    sb.from('trip_places').select('*').eq('trip_id', course.trip_id).order('day_no').order('order_no'),
    sb.from('reviews').select('*').eq('trip_id', course.trip_id).eq('user_id', course.user_id),   // 코스 주인의 후기만 (함께 간 친구 후기 제외)
    sb.from('photos').select('*').eq('trip_id', course.trip_id).eq('is_public', true).order('created_at')
  ]);
  [pl, rv, ph].forEach(function (r) { if (r.error) throw r.error; });

  document.title = 'TripMate - ' + course.title;
  document.getElementById('title').textContent = course.title;
  document.getElementById('subtitle').textContent = course.region + ' · ' + nightsText(course.days) + ' · ' +
    (course.user_id === me.id ? '내가 공개한 코스' : course.nickname + '님의 코스');
  document.getElementById('status').textContent = '';
  document.getElementById('course-view').hidden = false;

  // 코스 정보 + 여행 전체 후기
  fillInfo(course);
  const copyBtn = document.getElementById('copy-btn');
  if (course.user_id === me.id) {
    copyBtn.textContent = '내 여행 정보로 가기';
    copyBtn.href = 'trip.html?trip=' + course.trip_id;
    document.getElementById('copy-note').textContent = '내가 공개한 코스예요. 공개 설정은 여행 정보 화면에서 바꿀 수 있어요.';
  } else {
    copyBtn.href = 'condition.html?copy=' + course.id;
  }

  // 장소별 한줄평
  const oneLiner = {};
  rv.data.forEach(function (r) { if (r.place_id != null) oneLiner[r.place_id] = r; });

  // 날짜별 일정 (저장할 때의 시작 시각 그대로. 집↔여행지 구간은 출발지가 사람마다 달라서 보여 주지 않음)
  const lodging = pl.data.find(function (r) { return r.day_no === 0; });
  const box = document.getElementById('schedule');
  const daysRows = [];
  for (let d = 1; d <= course.days; d++) daysRows.push(pl.data.filter(function (r) { return r.day_no === d; }));
  let map = null;
  daysRows.forEach(function (list, di) {
    const sec = document.createElement('div');
    sec.className = 'day-block';
    let html = '<h3 style="color:' + DAY_COLORS[di % DAY_COLORS.length] + '">' + (di + 1) + '일차</h3><ol class="mini-timeline">';
    let n = 0;
    list.forEach(function (r, i) {
      const ol = oneLiner[r.place_id];
      html += '<li class="mini-item" data-day="' + di + '" data-i="' + i + '"><span class="mini-time">' + esc(r.start_time || '') + '</span>' +
        '<span class="mini-no">' + (r.meal ? '🍴 ' + esc(r.meal) : (++n)) + '</span><span class="mini-name">' + esc(r.name) +
        (ol ? '<span class="one-liner">' + (ol.rating ? starsText(ol.rating) + ' ' : '') + esc(ol.content || '') + '</span>' : '') +
        '</span><span class="mini-cost"></span></li>';
    });
    if (lodging && di < course.days - 1) {
      const ol = oneLiner[lodging.place_id];
      html += '<li class="mini-point">🏨 숙소: ' + esc(lodging.name) +
        (ol ? '<span class="one-liner">' + (ol.rating ? starsText(ol.rating) + ' ' : '') + esc(ol.content || '') + '</span>' : '') + '</li>';
    }
    sec.innerHTML = html + '</ol>';
    sec.querySelectorAll('.mini-item').forEach(function (li) {
      li.addEventListener('click', function () {
        const r = daysRows[Number(li.dataset.day)][Number(li.dataset.i)];
        if (map && r.lat != null) { map.setLevel(4); map.panTo(new kakao.maps.LatLng(r.lat, r.lng)); }
      });
    });
    box.appendChild(sec);
  });

  // 지도: 날짜별 색 번호 점과 경로선 (숙소 → 장소들 → 숙소)
  kakao.maps.load(function () {
    map = new kakao.maps.Map(document.getElementById('detail-map'), { center: new kakao.maps.LatLng(36.3, 127.8), level: 9 });
    map.addControl(new kakao.maps.ZoomControl(), kakao.maps.ControlPosition.RIGHT);
    const bounds = new kakao.maps.LatLngBounds();
    function pin(r, label, bg) {
      const pos = new kakao.maps.LatLng(r.lat, r.lng);
      bounds.extend(pos);
      const el = document.createElement('span');
      el.className = 'map-pin';
      el.style.background = bg;
      el.textContent = label;
      el.title = r.name;
      new kakao.maps.CustomOverlay({ position: pos, content: el, yAnchor: 0.5 }).setMap(map);
      return pos;
    }
    if (lodging && lodging.lat != null) pin(lodging, '숙', '#333');
    daysRows.forEach(function (list, di) {
      const color = DAY_COLORS[di % DAY_COLORS.length], path = [];
      if (lodging && lodging.lat != null && di > 0) path.push(new kakao.maps.LatLng(lodging.lat, lodging.lng));
      let n = 0;
      list.forEach(function (r) { if (r.lat != null) path.push(pin(r, r.meal ? '🍴' : (di + 1) + '-' + (++n), color)); });
      if (lodging && lodging.lat != null && di < course.days - 1) path.push(new kakao.maps.LatLng(lodging.lat, lodging.lng));
      new kakao.maps.Polyline({ path: path, strokeWeight: 4, strokeColor: color, strokeOpacity: 0.75 }).setMap(map);
    });
    if (!bounds.isEmpty()) map.setBounds(bounds, 40, 40, 40, 40);
  });

  // 공개 사진
  if (ph.data.length) {
    const { data } = await sb.storage.from('trip-photos').createSignedUrls(ph.data.map(function (r) { return r.url; }), 3600);
    const urls = {};
    (data || []).forEach(function (d) { if (d.signedUrl) urls[d.path] = d.signedUrl; });
    const grid = document.getElementById('photo-grid');
    ph.data.forEach(function (r) {
      if (!urls[r.url]) return;
      const fig = document.createElement('figure');
      fig.className = 'photo-item';
      fig.innerHTML = '<a target="_blank" rel="noopener"><img alt="" loading="lazy"></a><figcaption><span class="pi-place"></span></figcaption>';
      fig.querySelector('a').href = urls[r.url];
      fig.querySelector('img').src = urls[r.url];
      fig.querySelector('.pi-place').textContent = r.place_name || '📍 사진 위치';
      grid.appendChild(fig);
    });
    document.getElementById('photo-card').hidden = grid.children.length === 0;
  }
}

start();
