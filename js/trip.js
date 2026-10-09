// 여행 정보 화면 — 여행 하나의 모든 정보를 한곳에서
// 입력: 주소의 ?trip=여행번호 → trips 행, 저장된 일정(trip_places), 준비물(checklist), 내 다른 여행 목록
// 출력: 여행 조건, 비용(예산 사용 그래프), 날짜별 일정(읽기 전용)과 지도, 준비물 체크리스트(바로 수정·저장),
//       6차시: 공개 설정·후기·장소별 한줄평·사진 (js/memories.js)
//       일정을 고치려면 '일정 수정하기' → detail.html

const DAY_COLORS = ['#2f8f7e', '#e07a2f', '#3b6fd8', '#b8437a', '#7a5cc4', '#c49a1a', '#4a8a2a'];
let map = null;
const current = { plan: null, timeline: null };   // 파일 저장(export.js)에 넘길 지금 일정

async function start() {
  const trip = await loadTripFromUrl();
  const status = document.getElementById('status');
  if (!trip) { status.textContent = '여행 정보를 찾을 수 없어요.'; return; }
  const role = await tripRole(trip);   // 'owner' | 'editor' | 'viewer' (친구에게 공유받은 여행이면 editor·viewer)
  setupTripShare(trip, role);          // 함께 여행할 친구 (js/share.js)
  document.getElementById('title').textContent = trip.region ? trip.region + ' 여행' : '여행 정보';
  document.getElementById('subtitle').textContent = tripTitle(trip) + ' (' + trip.days + '일)';
  renderInfo(trip, role);
  status.textContent = '';
  document.getElementById('trip-layout').hidden = false;

  // 준비물 (다른 여행 목록은 불러오기용)
  const others = await sb.from('trips').select('id,start_date,end_date,region').neq('id', trip.id).order('start_date');
  const checklist = setupChecklist(trip.id, others.data || [], role === 'viewer');
  if (role === 'viewer') document.querySelector('.suggest-box').hidden = true;

  // 일정
  try {
    let plan = null, places = null;
    if (trip.region) {
      places = await loadPlaces(trip.region);
      ensureScores(places, trip);
      plan = await loadSavedPlan(trip, places);
      if (plan) plan.signature = places.signature;   // 대표 먹거리·할거리 표시용
    }
    setupMemories(trip, plan, role);   // 일정이 없어도 후기·사진은 쓸 수 있음 (공개는 일정이 있어야 가능)
    // 추천 준비물: 체크리스트를 다 불러온 뒤, 이미 담은 것은 빼고 보여 줌 (보기 전용이면 위에서 숨김)
    if (role !== 'viewer') checklist.loaded.then(function () {
      return setupPackingSuggestions(trip, plan, checklist.add, checklist.items);
    }).then(function (sg) { checklist.onChange = sg.refresh; }).catch(showError);
    if (!plan) {
      document.getElementById('no-plan-card').hidden = false;
      document.getElementById('recommend-link').href = (trip.together ? 'together.html?trip=' : 'result.html?trip=') + trip.id;   // 함께 정하기면 취향 모으기부터
      return;
    }
    const timeline = computeTimeline(trip, plan);
    current.plan = plan; current.timeline = timeline;
    renderCost(trip, plan, timeline);
    renderSchedule(trip, plan, timeline);
    document.getElementById('map-card').hidden = false;
    kakao.maps.load(function () { renderMap(timeline, trip); });
  } catch (e) { showError(e); }
}

function renderInfo(trip, role) {
  const rows = [
    ['날짜', trip.start_date + ' ~ ' + trip.end_date + ' (' + trip.days + '일)'],
    ['인원', peopleText(trip) + (trip.days > 1 ? ' · 방 ' + (trip.rooms || 1) + '개' : '') + (trip.pet ? ' · 반려동물 동반' : '')],
    ['출발지', trip.departure_address || '-'],
    ['이동 수단', trip.transport],
    ['템포', trip.tempo],
    ['취향', trip.tags.map(function (t, i) { return (i === 0 ? '①' : '') + '#' + t; }).join(' ')],
    ['예산', won(trip.budget_min) + ' ~ ' + won(trip.budget_max)],
    ['여행지', trip.region ? trip.region + ' · ' + trip.plan_type + '안 ' + PLAN_INFO[trip.plan_type].name : '아직 안 고름']
  ];
  document.getElementById('info-list').innerHTML = rows.map(function (r) {
    return '<dt>' + r[0] + '</dt><dd>' + esc(r[1]) + '</dd>';
  }).join('');

  const buttons = document.getElementById('trip-buttons');
  const canEdit = role !== 'viewer', owner = role === 'owner';
  buttons.innerHTML =
    (trip.region && canEdit ? '<a class="small-btn" href="detail.html?trip=' + trip.id + '">✏️ 일정 수정하기</a>' : '') +
    (canEdit ? '<a class="small-btn" href="result.html?trip=' + trip.id + '">' + (trip.region ? '여행지 다시 추천받기' : '여행지 추천받기') + '</a>' : '') +
    '<button type="button" class="small-btn" id="pdf-btn">📄 PDF로 저장</button>' +
    '<button type="button" class="small-btn" id="xlsx-btn">📊 엑셀로 저장</button>' +
    '<button type="button" class="small-btn danger" id="delete-btn">' + (owner ? '여행 삭제' : '이 여행에서 나가기') + '</button>';
  document.getElementById('pdf-btn').addEventListener('click', function () { exportPdf(trip); });
  document.getElementById('xlsx-btn').addEventListener('click', async function () {
    this.disabled = true;
    try { await exportXlsx(trip, current.plan, current.timeline); showError(null); } catch (e) { showError(e); }
    this.disabled = false;
  });
  document.getElementById('delete-btn').addEventListener('click', async function () {
    if (owner) {
      if (!confirm('이 여행을 삭제할까요? 일정과 준비물도 함께 지워지고, 함께하는 친구들도 더 이상 볼 수 없어요.')) return;
      const { error } = await sb.from('trips').delete().eq('id', trip.id);
      if (error) return showError(error);
    } else {
      if (!confirm('이 여행에서 나갈까요? 다시 들어오려면 초대 링크가 필요해요.')) return;
      const { data } = await sb.auth.getUser();
      const { error } = await sb.from('trip_members').delete().eq('trip_id', trip.id).eq('user_id', data.user.id);
      if (error) return showError(error);
    }
    location.replace('record.html');
  });
}

function renderCost(trip, plan, t) {
  const c = t.cost;
  const over = c.total > trip.budget_max;
  document.getElementById('total-cost').innerHTML = '총 ' + won(c.total) +
    (over ? ' <small class="over-text">최대 예산보다 ' + won(c.total - trip.budget_max) + ' 많아요</small>'
          : ' <small>/ 최대 예산 ' + won(trip.budget_max) + '</small>');
  document.getElementById('total-meta').textContent = '총 이동 ' + t.distanceKm.toFixed(0) + 'km · 하루 평균 ' +
    t.visitsPerDay.toFixed(1) + '곳 · ' + (plan.lodging ? '숙소 ' + plan.lodging.name : '당일치기');
  const parts = [['숙박', c.lodging, 'lodging'], ['식비', c.food, 'food'], ['교통', c.transport, 'transport'], ['입장료', c.admission, 'admission']];
  const scale = Math.max(c.total, trip.budget_max);
  document.getElementById('budget-bar').innerHTML = parts.map(function (p) {
    return '<span class="seg ' + p[2] + '" style="width:' + (p[1] / scale * 100) + '%"></span>';
  }).join('') + '<span class="budget-line" style="left:' + Math.min(100, trip.budget_max / scale * 100) + '%"></span>';
  document.getElementById('budget-legend').innerHTML = parts.map(function (p) {
    return '<li><span class="dot ' + p[2] + '"></span>' + p[0] + ' ' + won(p[1]) + '</li>';
  }).join('') + '<li><span class="dot line"></span>최대 예산</li>';
  document.getElementById('daily-cost').innerHTML = dailyCostTable(trip, t);
  document.getElementById('cost-card').hidden = false;
}

function renderSchedule(trip, plan, t) {
  const box = document.getElementById('schedule');
  box.innerHTML = '';
  t.days.forEach(function (day, di) {
    const sec = document.createElement('div');
    sec.className = 'day-block';
    const date = new Date(trip.start_date);
    date.setDate(date.getDate() + di);
    let html = '<h3 style="color:' + DAY_COLORS[di % DAY_COLORS.length] + '">' + (di + 1) + '일차 <small>' +
      (date.getMonth() + 1) + '/' + date.getDate() + '</small></h3><ol class="mini-timeline">';
    html += '<li class="mini-point">' + hhmm(day.start) + ' ' + (di === 0 || !plan.lodging ? '🏠 출발 (아침은 집에서)' : '🏨 숙소에서 출발') + '</li>';
    let n = 0;
    day.items.forEach(function (it, i) {
      const p = it.stop.p;
      const label = it.stop.meal ? '🍴 ' + it.stop.meal : (++n) + '';
      const sigText = signatureLabel(p, plan.signature);
      html += '<li class="mini-item" data-day="' + di + '" data-i="' + i + '"><span class="mini-time">' + hhmm(it.begin) + '</span>' +
        '<span class="mini-no">' + label + '</span><span class="mini-name">' + esc(p.name) +
          (sigText ? ' <span class="sig-badge">★ ' + esc(sigText) + '</span>' : '') +
          (it.hoursIssue ? ' <span class="over-text" title="' + esc(it.hoursIssue) + '">⚠ ' + esc(it.hoursIssue) + '</span>' : '') +
          (it.queue ? ' <small class="muted">줄 약 ' + it.queue + '분</small>' : '') + '</span>' +
        '<span class="mini-cost">' + (it.cost ? won(it.cost) : '') + '</span></li>';
    });
    if (day.endPoint.isHome) {
      html += '<li class="mini-point">' + hhmm(day.endMin) + ' 🏠 집 도착</li>';
    } else {
      if (day.freeMin > 0) html += '<li class="mini-point">☕ 자유 시간 ' + durationText(day.freeMin) + '</li>';
      html += '<li class="mini-point">' + hhmm(day.endMin) + ' 🏨 숙소 도착 (' + esc(plan.lodging.name) + ')</li>';
    }
    sec.innerHTML = html + '</ol>';
    sec.querySelectorAll('.mini-item').forEach(function (li) {
      li.addEventListener('click', function () {
        const it = t.days[Number(li.dataset.day)].items[Number(li.dataset.i)];
        showPlace(it.stop.p);
        if (map) map.panTo(new kakao.maps.LatLng(it.stop.p.lat, it.stop.p.lng));
      });
    });
    box.appendChild(sec);
  });
  document.getElementById('schedule-card').hidden = false;
}

// 지도: 모든 날을 날짜별 색으로 (집은 멀어서 빼고 숙소·장소만)
function renderMap(t, trip) {
  let km = 0, failed = 0, autoWalked = false, pending = t.days.length;   // 도로 거리 합계, 경로를 못 받은 날 수
  map = new kakao.maps.Map(document.getElementById('detail-map'), { center: new kakao.maps.LatLng(36.3, 127.8), level: 9 });
  map.addControl(new kakao.maps.ZoomControl(), kakao.maps.ControlPosition.RIGHT);
  const bounds = new kakao.maps.LatLngBounds();
  t.days.forEach(function (day, di) {
    const color = DAY_COLORS[di % DAY_COLORS.length];
    const pts = [], modes = [], refs = [];   // 경로 점, 각 점으로 오는 구간의 걷기/대중교통, 그 선택을 담는 곳
    let n = 0;
    function pushPt(p, mode, ref) {
      if (pts.length) { modes.push(mode || null); refs.push(ref); }
      pts.push({ lat: p.lat, lng: p.lng });
    }
    function pin(p, label, dark) {
      const pos = new kakao.maps.LatLng(p.lat, p.lng);
      bounds.extend(pos);
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'map-pin';
      el.style.background = dark ? '#333' : color;
      el.textContent = label;
      el.addEventListener('click', function () { showPlace(p); });
      new kakao.maps.CustomOverlay({ position: pos, content: el, yAnchor: 0.5 }).setMap(map);
    }
    if (!day.startPoint.isHome) { pin(day.startPoint, '숙', true); pushPt(day.startPoint); }
    day.items.forEach(function (it) { pin(it.stop.p, it.stop.meal ? '🍴' : (di + 1) + '-' + (++n), false); pushPt(it.stop.p, it.moveMode, it.stop); });
    if (!day.endPoint.isHome) {
      const dayPlan = current.plan.days[di];
      if (!dayPlan.backStop) dayPlan.backStop = {};
      pushPt(day.endPoint, day.backMode, dayPlan.backStop);
    }
    // 날짜별 경로선: 실제 길을 따라 (js/road-route.js — 불러오기 전·실패 시에는 점선 직선)
    drawRoute(map, pts, color, function (ok, info) {
      if (!ok) failed++; else km += info.distance || 0;
      // 대중교통 경로가 없는 구간은 걷기로 보고 시간표·비용을 다시 계산 (지도는 이미 걷기로 그려짐)
      if (ok && info.learned) autoWalked = true;   // 실제 대중교통 시간을 받았으면 시간표·비용 다시 계산
      if (ok && info.legs) info.legs.forEach(function (leg, i) {
        const ref = refs[i];
        if (leg.noTransit && ref && !ref.legMode && !ref.autoWalk) { ref.autoWalk = true; autoWalked = true; }
      });
      document.getElementById('route-note').textContent = routeNoteText(trip.transport, failed === 0, failed ? null : { distance: km });
      if (--pending === 0 && autoWalked) {
        current.timeline = computeTimeline(trip, current.plan);
        renderCost(trip, current.plan, current.timeline);
        renderSchedule(trip, current.plan, current.timeline);
      }
    }, trip.transport, modes);
  });
  map.setBounds(bounds, 40, 40, 40, 40);
}

function showPlace(p) {
  const route = 'https://map.kakao.com/link/to/' + encodeURIComponent(p.name) + ',' + p.lat + ',' + p.lng;
  document.getElementById('place-card').innerHTML =
    (p.photo ? '<img class="place-photo" src="' + esc(p.photo) + '" alt=""><small class="photo-credit">사진: 한국관광공사</small>' : '') +
    '<h3>' + esc(p.name) + '</h3>' +
    '<p class="helper-text muted">' + esc(p.type === '식당' ? cuisineOf(p) : (p.categoryName || p.type)) + (p.address ? ' · ' + esc(p.address) : '') + '</p>' +
    legInfoHtml(p) +
    '<p class="place-links">' + (p.link ? '<a href="' + esc(p.link) + '" target="_blank" rel="noopener">카카오맵에서 보기</a>' : '') +
    '<a href="' + esc(route) + '" target="_blank" rel="noopener">카카오맵 길찾기</a>' +
      '<a href="' + esc(blogSearchUrl(p)) + '" target="_blank" rel="noopener">블로그 후기 보기</a></p>';
}

start();
