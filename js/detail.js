// 일정 상세 화면 (타임라인 + 지도 + 수정 + 저장)
// 입력: 주소의 ?trip=번호&region=지역&plan=A|B|C → 추천 일정을 새로 만듦
//       (순서 바꾸기는 항목 왼쪽 ⠿ 손잡이를 끌어서 놓기, 날짜 탭 위에 놓으면 그날 끝으로 옮김)
//       주소에 region·plan이 없으면 → 그 여행에 저장해 둔 일정(trip_places)을 불러옴
//       사용자의 수정(삭제·순서·다른 날로 옮기기·교체·체류 시간·추가·시작 시각·숙소)
// 출력: 날짜별 시간표·지도 경로·예산 사용 그래프. 수정할 때마다 computeTimeline으로 다시 계산,
//       '이 일정 저장'을 누르면 trips(region·plan_type·total_cost·day_starts)와 trip_places에 저장

let trip = null;          // 여행 조건 (trips 한 행)
let places = [];          // 이 지역 장소 전체
let plan = null;          // { type, region, lodging, days: [{ start, stops }] }
let timeline = null;      // computeTimeline 결과
let curDay = 0;           // 지금 보고 있는 날 (0 = 1일차)
let dirty = false;        // 저장하지 않은 수정이 있는지
let map = null, mapObjects = [];

const errorText = document.getElementById('error-text');
function showError(e) { errorText.textContent = e ? '오류: ' + e.message : ''; if (e) console.error(e); }

// ---------- 1. 시작: 일정 만들기 또는 불러오기 ----------

async function start() {
  trip = await loadTripFromUrl();
  const status = document.getElementById('status');
  if (!trip) { status.textContent = '여행 정보를 찾을 수 없어요.'; return; }
  // 친구에게 '보기만' 권한으로 공유받은 여행은 고칠 수 없으므로 여행 정보 화면으로
  if (await tripRole(trip) === 'viewer') { location.replace('trip.html?trip=' + trip.id); return; }
  document.getElementById('trip-summary').textContent = tripSummary(trip);

  try {
    const region = param('region') || trip.region;
    const key = param('plan') || trip.plan_type;
    if (!region || !key) { status.textContent = '아직 고른 일정이 없어요. 여행지 추천부터 받아 주세요.'; return; }
    places = await loadPlaces(region);
    ensureScores(places, trip);
    document.getElementById('back-link').href = 'plans.html?trip=' + trip.id + '&region=' + encodeURIComponent(region);

    if (param('plan')) {                       // 추천 일정 새로 만들기
      const plans = buildPlans(trip, region, places);
      if (!plans) { status.textContent = '이 예산으로는 일정을 만들 수 없어요.'; return; }
      plan = plans[key];
      if (trip.region) document.getElementById('save-msg').textContent = '저장하면 이 여행에 저장된 기존 일정(' + trip.region + ' ' + trip.plan_type + '안)을 덮어써요.';
    } else {                                   // 저장된 일정 불러오기
      plan = await loadSavedPlan(trip, places);
      if (!plan) { status.textContent = '저장된 일정이 없어요. 여행지 추천부터 받아 주세요.'; return; }
      document.getElementById('save-msg').textContent = param('copied')
        ? '공개 코스에서 담은 일정이에요. 내 출발지·인원으로 시간과 비용을 다시 계산했어요. 확인한 뒤 \'이 일정 저장\'을 눌러 주세요.'
        : '저장된 일정이에요.';
      if (param('copied')) dirty = true;   // 총비용이 아직 저장되지 않았으므로 저장을 유도
    }
    document.getElementById('title').textContent = region + ' · ' + key + '안 ' + PLAN_INFO[key].name;
    status.textContent = '';
    document.getElementById('summary-card').hidden = false;
    document.getElementById('detail-layout').hidden = false;
    kakao.maps.load(function () {
      map = new kakao.maps.Map(document.getElementById('detail-map'), { center: new kakao.maps.LatLng(36.3, 127.8), level: 9 });
      map.addControl(new kakao.maps.ZoomControl(), kakao.maps.ControlPosition.RIGHT);
      refresh(false);
    });
  } catch (e) { showError(e); }
}


// ---------- 2. 다시 계산하고 다시 그리기 ----------

function refresh(changed) {
  if (changed) {
    dirty = true;
    document.getElementById('save-msg').textContent = '수정한 내용이 아직 저장되지 않았어요.';
  }
  timeline = computeTimeline(trip, plan);
  renderSummary();
  renderTabs();
  renderDay();
  renderLodging();
  renderMap();
}

function renderSummary() {
  const c = timeline.cost;
  const over = c.total > trip.budget_max;
  document.getElementById('total-cost').innerHTML = '총 ' + won(c.total) +
    (over ? ' <small class="over-text">최대 예산 ' + won(trip.budget_max) + '을 ' + won(c.total - trip.budget_max) + ' 넘어요</small>'
          : ' <small>/ 최대 예산 ' + won(trip.budget_max) + '</small>');
  document.getElementById('total-meta').textContent =
    '총 이동 ' + timeline.distanceKm.toFixed(0) + 'km · 하루 평균 ' + timeline.visitsPerDay.toFixed(1) + '곳 방문' +
    (plan.lodging ? ' · 숙소 ' + plan.lodging.name : ' · 당일치기');

  // 예산 사용 그래프: 막대 전체 = max(총비용, 최대 예산)
  const parts = [['숙박', c.lodging, 'lodging'], ['식비', c.food, 'food'], ['교통', c.transport, 'transport'], ['입장료', c.admission, 'admission']];
  const scale = Math.max(c.total, trip.budget_max);
  document.getElementById('budget-bar').innerHTML = parts.map(function (p) {
    return '<span class="seg ' + p[2] + '" style="width:' + (p[1] / scale * 100) + '%" title="' + p[0] + ' ' + won(p[1]) + '"></span>';
  }).join('') + '<span class="budget-line" style="left:' + Math.min(100, trip.budget_max / scale * 100) + '%"></span>';
  document.getElementById('budget-legend').innerHTML = parts.map(function (p) {
    return '<li><span class="dot ' + p[2] + '"></span>' + p[0] + ' ' + won(p[1]) + '</li>';
  }).join('') + '<li><span class="dot line"></span>최대 예산</li>';
  document.getElementById('daily-cost').innerHTML = dailyCostTable(trip, timeline);
}

function renderTabs() {
  const tabs = document.getElementById('day-tabs');
  tabs.innerHTML = '';
  timeline.days.forEach(function (d, i) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip' + (i === curDay ? ' selected' : '') + (d.over ? ' warn' : '');
    b.dataset.day = i;
    b.textContent = (i + 1) + '일차' + (d.over ? ' ⚠' : '');
    b.addEventListener('click', function () { curDay = i; renderTabs(); renderDay(); renderMap(); });
    tabs.appendChild(b);
  });
}

function renderDay() {
  const day = timeline.days[curDay];
  const limit = TEMPO[trip.tempo].hours * 60;
  document.getElementById('day-start').value = hhmm(plan.days[curDay].start);
  document.getElementById('day-active').textContent = '활동 ' + durationText(day.activeMin) + ' / ' + durationText(limit) + ' (이동+관람, 식사 제외)';
  document.getElementById('day-warning').textContent = day.over ? '이 날은 ' + trip.tempo + ' 템포의 하루 활동 시간을 넘었어요.' : '';

  const list = document.getElementById('timeline');
  list.innerHTML = '';
  const lastDay = curDay === timeline.days.length - 1;
  list.appendChild(pointItem(hhmm(day.start), curDay === 0 || !plan.lodging ? '🏠 출발지에서 출발 <small>(아침은 집에서 먹고 출발)</small>' : '🏨 숙소에서 출발'));

  let visitNo = 0;   // 식사를 빼고 센 방문 번호 (지도 번호와 같음)
  day.items.forEach(function (it, i) {
    const p = it.stop.p;
    if (!it.stop.meal) visitNo++;
    const li = document.createElement('li');
    li.className = 'tl-item' + (it.stop.meal ? ' meal' : '');
    li.dataset.index = i;
    const isFood = p.type === '식당';
    li.innerHTML =
      moveLine(it.moveMode, it.moveMin, it.moveKm, p, it.begin > it.arrive ? ' · ' + durationText(it.begin - it.arrive) + ' 기다림' : '', it.stop) +
      '<div class="tl-main">' +
        '<span class="drag-handle" title="끌어서 순서 바꾸기 (날짜 탭에 놓으면 그날로 옮김)">⠿</span>' +
        '<span class="tl-no">' + (it.stop.meal ? '🍴' : visitNo) + '</span>' +
        '<div class="tl-body">' +
          '<p class="tl-time">' + hhmm(it.begin) + ' – ' + hhmm(it.end) + (it.stop.meal ? ' · ' + esc(it.stop.meal) : '') +
            (it.queue ? ' <small>(줄 서기 약 ' + it.queue + '분 포함)</small>' : '') + '</p>' +
          (it.hoursIssue ? '<p class="field-warning">⚠ ' + esc(it.hoursIssue) + ' — 시간을 바꾸거나 ⇄로 교체해 주세요</p>' : '') +
          infoBadges(p) +
          '<button type="button" class="tl-name link-btn"></button>' +
          '<p class="tl-meta">' + esc(isFood ? cuisineOf(p) : (p.categoryName || p.type)) + ' · ' + (it.cost ? won(it.cost) : '무료') + '</p>' +
        '</div>' +
      '</div>' +
      '<div class="tl-edit">' +
        '<label class="stay-field">체류 <input type="number" class="stay-input" min="10" step="10" value="' + it.stop.stay + '">분</label>' +
        '<button type="button" class="icon-btn" data-act="prev" title="전날 끝으로" ' + (curDay === 0 ? 'disabled' : '') + '>◀</button>' +
        '<button type="button" class="icon-btn" data-act="next" title="다음 날 처음으로" ' + (lastDay ? 'disabled' : '') + '>▶</button>' +
        '<button type="button" class="icon-btn" data-act="swap" title="다른 장소로 교체">⇄</button>' +
        (isFood ? '<button type="button" class="icon-btn" data-act="remeal" title="다른 종류 메뉴로 다시 추천">🔄</button>' : '') +
        '<button type="button" class="icon-btn danger" data-act="del" title="삭제">✕</button>' +
      '</div>' +
      '<div class="swap-box" hidden></div>';
    li.querySelector('.tl-name').textContent = p.name;
    li.querySelector('.tl-name').addEventListener('click', function () { showPlace(p); panTo(p); });
    li.querySelector('.stay-input').addEventListener('change', function (e) {
      const v = Math.round(Number(e.target.value));
      if (v >= 10) { plan.days[curDay].stops[i].stay = v; refresh(true); } else e.target.value = it.stop.stay;
    });
    li.querySelectorAll('[data-act]').forEach(function (btn) {
      btn.addEventListener('click', function () { editStop(btn.dataset.act, i, li); });
    });
    li.querySelector('.drag-handle').addEventListener('pointerdown', function (e) { startDrag(e, i, li); });
    bindModeButtons(li, it.stop);
    list.appendChild(li);
  });

  // 숙소로 가는 날: 자유 시간 → 숙소 도착 시각(바꿀 수 있음, 모든 날 공통)
  if (!day.endPoint.isHome && day.freeMin > 0) {
    list.appendChild(pointItem(hhmm(day.departMin), '☕ 자유 시간 ' + durationText(day.freeMin) + ' 뒤 숙소로'));
  }
  const endText = day.endPoint.isHome ? '🏠 집 도착' : '🏨 숙소 도착 <label class="return-field">도착 시각 ' +
    '<input type="time" step="600" class="return-input" value="' + hhmm(plan.lodgingArrive || LODGING_ARRIVE) + '"> 이후</label>';
  const end = pointItem(hhmm(day.endMin), endText);
  const arriveInput = end.querySelector('.return-input');
  if (arriveInput) arriveInput.addEventListener('change', function (e) {
    const [h, m] = e.target.value.split(':').map(Number);
    if (!Number.isNaN(h)) { plan.lodgingArrive = h * 60 + m; refresh(true); }
  });
  if (!plan.days[curDay].backStop) plan.days[curDay].backStop = {};
  end.insertAdjacentHTML('afterbegin', moveLine(day.backMode, day.backMin, day.backKm, day.endPoint, '', plan.days[curDay].backStop));
  bindModeButtons(end, plan.days[curDay].backStop);
  list.appendChild(end);
}

// 이동 한 줄: '↓ 🚶 걷기 5분 · 0.3km' + (대중교통 여행이면) [🚶 걷기 | 🚌 대중교통] 버튼과 받아 온 노선 안내
// 입력: 구간 이동 방법('walk' | 'transit' | null), 시간(분), 거리(km), 도착 장소, 덧붙일 글 / 출력: HTML
function moveLine(mode, min, km, dest, extra, ref) {
  const label = mode === 'walk' ? '🚶 걷기' : mode === 'transit' ? '🚌 대중교통' : (trip.transport === '자동차' ? '🚗 자동차' : '🚆 ' + trip.transport);
  const leg = mode && dest ? legInfo[pointKey(dest)] : null;
  const ride = leg && leg.mode === 'transit' ? ' · ' + esc(leg.summary) : '';
  const none = (leg && leg.noTransit) || (ref && ref.autoWalk && !ref.legMode) ? ' · 대중교통 경로가 없어 걷기' : '';
  const far = mode === 'walk' && km >= 2 ? ' <span class="over-text">⚠ 걷기엔 먼 거리 (택시 고려)</span>' : '';
  return '<p class="tl-move">↓ ' + label + ' ' + durationText(min) + ' · ' + km.toFixed(1) + 'km' + ride + none + (extra || '') + far +
    (mode ? ' <span class="mode-toggle" role="group" aria-label="이동 방법">' +
      '<button type="button" data-mode="walk" class="' + (mode === 'walk' ? 'on' : '') + '">🚶</button>' +
      '<button type="button" data-mode="transit" class="' + (mode === 'transit' ? 'on' : '') + '">🚌</button></span>' : '') + '</p>';
}

// 걷기/대중교통 버튼: 누르면 그 구간을 그 방법으로 고정, 이미 고정한 방법을 다시 누르면 자동(400m 기준)으로 되돌림
function bindModeButtons(el, ref) {
  el.querySelectorAll('.mode-toggle button').forEach(function (b) {
    const auto = !ref.legMode;
    b.title = (b.dataset.mode === 'walk' ? '걷기' : '대중교통') + (auto ? ' (지금은 자동으로 정해짐)' : ref.legMode === b.dataset.mode ? ' (직접 고름 — 다시 누르면 자동)' : '');
    if (auto) b.classList.add('auto');
    b.addEventListener('click', function () {
      ref.legMode = ref.legMode === b.dataset.mode ? undefined : b.dataset.mode;
      refresh(true);
    });
  });
}

// 후기 조사 정보 배지: 품질 등급·혼밥·최소 인원·주차·아이 동반·주의할 점
function infoBadges(p) {
  const i = p.info;
  if (!i) return '';
  const b = [];
  if (i.q) b.push({ A: '👍 평이 아주 좋음', B: '평이 좋음', C: '평이 보통', D: '평이 엇갈림' }[i.q]);
  if (i.solo === true && p.type === '식당') b.push('혼밥 가능');
  if (i.minPeople) b.push(i.minPeople + '인부터');
  if (i.parking === true) b.push('주차 가능');
  if (i.parking === false) b.push('주차 어려움');
  if (i.kids) b.push('아이와 가기 좋음');
  if (i.pet) b.push('반려동물 가능');
  (i.issues || []).forEach(function (x) { b.push('⚠ ' + x); });
  return b.length ? '<p class="info-badges">' + b.map(function (x) { return '<span>' + esc(x) + '</span>'; }).join('') + '</p>' : '';
}

function pointItem(time, text) {
  const li = document.createElement('li');
  li.className = 'tl-point';
  li.innerHTML = '<span class="tl-time">' + time + '</span> ' + text;
  return li;
}

// ---------- 3. 수정 ----------

function editStop(act, i, li) {
  const stops = plan.days[curDay].stops;
  if (act === 'prev' && curDay > 0) { plan.days[curDay - 1].stops.push(stops.splice(i, 1)[0]); }
  else if (act === 'next' && curDay < plan.days.length - 1) { plan.days[curDay + 1].stops.unshift(stops.splice(i, 1)[0]); }
  else if (act === 'del') { stops.splice(i, 1); }
  else if (act === 'swap') { openSwap(i, li); return; }
  else if (act === 'remeal') { if (!remeal(i)) return; }
  else return;
  refresh(true);
}

// 일정에 이미 들어 있는 장소 id
function usedIds() {
  const s = new Set();
  plan.days.forEach(function (d) { d.stops.forEach(function (st) { s.add(st.p.id); }); });
  return s;
}

// 교체: 같은 종류(명소/식당) 중 가까운 후보 15곳을 고르는 목록
function openSwap(i, li) {
  const box = li.querySelector('.swap-box');
  if (!box.hidden) { box.hidden = true; return; }
  const stop = plan.days[curDay].stops[i];
  const used = usedIds();
  const candidates = places.filter(function (p) {
    return p.type === stop.p.type && p.recommend && !used.has(p.id) && !isChain(p.name) && (p.type !== '명소' || p.stayMin > 0);
  }).map(function (p) { return { p: p, km: distanceKm(stop.p, p) }; })
    .sort(function (a, b) { return a.km - b.km; }).slice(0, 15);
  const select = document.createElement('select');
  select.innerHTML = '<option value="">가까운 ' + stop.p.type + ' 중에서 고르기</option>' + candidates.map(function (c, k) {
    return '<option value="' + k + '">' + esc(c.p.name) + (c.p.type === '식당' ? ' · ' + cuisineOf(c.p) : '') + ' · ' +
      c.km.toFixed(1) + 'km · ' + (c.p.cost ? won(c.p.cost) : '무료') + '</option>';
  }).join('');
  select.addEventListener('change', function () {
    if (select.value === '') return;
    const p = candidates[Number(select.value)].p;
    stop.p = p;
    if (!stop.meal) stop.stay = p.stayMin;
    else stop.meal = mealLabel(p, stop.meal);
    refresh(true);
  });
  box.innerHTML = '';
  box.appendChild(select);
  box.hidden = false;
}

// 아침 식당 후보: 추천 후보 식사 식당 (체인 제외)
function mealRestaurants() {
  return places.filter(function (p) { return p.type === '식당' && p.recommend && !isChain(p.name) && foodKind(p) === 'meal'; });
}

// 식당이 디저트·카페면 '디저트', 아니면 원래 끼니 이름(디저트였으면 '식사')
function mealLabel(p, current) {
  if (foodKind(p) === 'dessert') return '디저트';
  return !current || current === '디저트' ? '식사' : current;
}

// 🔄 다른 메뉴로 다시 추천: 지금 메뉴 종류와 '다른 종류'의 식사 식당 중에서
//    여행 전체에서 덜 먹은 종류 + 바로 앞 장소에서 가까운 곳을 고름 (일정 만들 때와 같은 pickRestaurant 사용)
function remeal(i) {
  const day = plan.days[curDay];
  const stop = day.stops[i];
  const current = cuisineOf(stop.p);
  const eaten = {};
  plan.days.forEach(function (d) {
    d.stops.forEach(function (st) { if (st !== stop && st.p.type === '식당') eaten[cuisineOf(st.p)] = (eaten[cuisineOf(st.p)] || 0) + 1; });
  });
  const prev = i > 0 ? day.stops[i - 1].p : timeline.days[curDay].startPoint;
  const from = prev.isHome ? stop.p : prev;
  const list = places.filter(function (p) {
    return p.type === '식당' && p.recommend && !isChain(p.name) && foodKind(p) === 'meal' && cuisineOf(p) !== current;
  });
  const pick = pickRestaurant(plan.type, list, from, usedIds(), eaten, current);
  if (!pick) { showError(new Error('근처에 다른 종류의 식당이 없어요.')); return false; }
  showError(null);
  stop.p = pick;
  stop.meal = mealLabel(pick, stop.meal);
  return true;
}

// ---------- 3-2. 끌어서 순서 바꾸기 (마우스·터치 모두: pointer 이벤트) ----------
// 입력: ⠿ 손잡이를 누른 채 움직인 위치 / 출력: 놓은 자리로 stops 배열 순서를 바꾸고 다시 계산
//       날짜 탭 위에 놓으면 그 날의 맨 끝으로 옮김
let drag = null;

function startDrag(e, index, li) {
  e.preventDefault();
  li.classList.add('dragging');
  drag = { from: index, li: li, to: index, day: null };
  document.addEventListener('pointermove', moveDrag);
  document.addEventListener('pointerup', endDrag, { once: true });
}

function moveDrag(e) {
  if (!drag) return;
  document.querySelectorAll('.drop-before, .drop-after, .chip.drop-target').forEach(function (el) {
    el.classList.remove('drop-before', 'drop-after', 'drop-target');
  });
  // 1) 날짜 탭 위인지
  const under = document.elementFromPoint(e.clientX, e.clientY);
  const tab = under && under.closest('.day-tabs .chip');
  if (tab) {
    drag.day = Number(tab.dataset.day);
    if (drag.day !== curDay) tab.classList.add('drop-target');
    return;
  }
  drag.day = null;
  // 2) 타임라인 항목 사이 어디인지: 각 항목 가운데 높이보다 위면 그 앞
  const items = Array.from(document.querySelectorAll('#timeline .tl-item'));
  let to = items.length;
  for (let k = 0; k < items.length; k++) {
    const r = items[k].getBoundingClientRect();
    if (e.clientY < r.top + r.height / 2) { to = k; break; }
  }
  drag.to = to;
  if (to < items.length) items[to].classList.add('drop-before');
  else if (items.length) items[items.length - 1].classList.add('drop-after');
}

function endDrag() {
  document.removeEventListener('pointermove', moveDrag);
  if (!drag) return;
  const d = drag;
  drag = null;
  d.li.classList.remove('dragging');
  document.querySelectorAll('.drop-before, .drop-after, .chip.drop-target').forEach(function (el) {
    el.classList.remove('drop-before', 'drop-after', 'drop-target');
  });
  const stops = plan.days[curDay].stops;
  if (d.day !== null && d.day !== curDay) {               // 다른 날로
    plan.days[d.day].stops.push(stops.splice(d.from, 1)[0]);
    refresh(true);
    return;
  }
  let to = d.to;
  if (to > d.from) to--;                                   // 빼낸 뒤에는 뒤쪽 번호가 한 칸 당겨짐
  if (d.day !== null || to === d.from) return;
  stops.splice(to, 0, stops.splice(d.from, 1)[0]);
  refresh(true);
}

// 하루 시작 시각
document.getElementById('day-start').addEventListener('change', function (e) {
  const [h, m] = e.target.value.split(':').map(Number);
  if (Number.isNaN(h)) return;
  plan.days[curDay].start = h * 60 + m;
  refresh(true);
});

// 장소 추가: 이름 검색
document.getElementById('add-input').addEventListener('input', function (e) {
  const q = e.target.value.trim();
  const out = document.getElementById('add-results');
  out.innerHTML = '';
  if (q.length < 1) return;
  const used = usedIds();
  places.filter(function (p) {
    return (p.type === '명소' || p.type === '식당') && !used.has(p.id) && p.name.indexOf(q) !== -1;
  }).sort(function (a, b) { return (b._s || 0) - (a._s || 0); }).slice(0, 10).forEach(function (p) {
    const li = document.createElement('li');
    li.innerHTML = '<span></span><button type="button" class="small-btn">' + (curDay + 1) + '일차에 추가</button>';
    li.querySelector('span').textContent = p.name + ' (' + (p.type === '식당' ? cuisineOf(p) : p.type) + (p.cost ? ' · ' + won(p.cost) : '') + ')';
    li.querySelector('button').addEventListener('click', function () {
      const stop = p.type === '식당' ? { p: p, stay: 60, meal: mealLabel(p, '식사') } : { p: p, stay: p.stayMin > 0 ? p.stayMin : 60 };
      plan.days[curDay].stops.push(stop);
      e.target.value = '';
      out.innerHTML = '';
      refresh(true);
    });
    out.appendChild(li);
  });
  if (!out.children.length) out.innerHTML = '<li class="muted">검색 결과가 없어요.</li>';
});

// 숙소 변경: 일정 장소들의 가운데에서 가까운 숙소 30곳
function renderLodging() {
  const box = document.getElementById('lodging-box');
  box.hidden = !plan.lodging && trip.days === 1;
  if (box.hidden) return;
  const all = [];
  plan.days.forEach(function (d) { d.stops.forEach(function (s) { all.push(s.p); }); });
  const center = all.length ? { lat: all.reduce(function (s, p) { return s + p.lat; }, 0) / all.length,
                                lng: all.reduce(function (s, p) { return s + p.lng; }, 0) / all.length } : plan.lodging;
  const list = places.filter(function (p) { return p.type === '숙소' && p.cost > 0 && p.recommend; })
    .map(function (p) { return { p: p, km: distanceKm(center, p) }; })
    .sort(function (a, b) { return a.km - b.km; }).slice(0, 30);
  if (plan.lodging && !list.some(function (x) { return x.p.id === plan.lodging.id; })) {
    list.unshift({ p: plan.lodging, km: distanceKm(center, plan.lodging) });
  }
  const select = document.getElementById('lodging-select');
  select.innerHTML = list.map(function (x, k) {
    return '<option value="' + k + '"' + (plan.lodging && x.p.id === plan.lodging.id ? ' selected' : '') + '>' +
      esc(x.p.name) + ' · 1박 ' + won(x.p.cost) + ' · 일정 중심에서 ' + x.km.toFixed(1) + 'km</option>';
  }).join('');
  select.onchange = function () {
    plan.lodging = list[Number(select.value)].p;
    syncBreakfast(trip, plan, mealRestaurants());   // 숙소가 바뀌면 조식(숙소 조식 / 근처 식당 아침)도 맞춰 바꿈
    refresh(true);
  };
}

// ---------- 4. 지도 ----------

const DAY_COLORS = ['#2f8f7e', '#e07a2f', '#3b6fd8', '#b8437a', '#7a5cc4', '#c49a1a', '#4a8a2a'];

function renderMap() {
  if (!map) return;
  mapObjects.forEach(function (o) { o.setMap(null); });
  mapObjects = [];
  const color = DAY_COLORS[curDay % DAY_COLORS.length];
  const day = timeline.days[curDay];
  const bounds = new kakao.maps.LatLngBounds();

  function addPoint(p, label, cls) {
    const pos = new kakao.maps.LatLng(p.lat, p.lng);
    bounds.extend(pos);
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'map-pin ' + cls;
    el.style.background = cls === 'lodging' ? '#333' : color;
    el.textContent = label;
    el.addEventListener('click', function () { showPlace(p); });
    const ov = new kakao.maps.CustomOverlay({ position: pos, content: el, yAnchor: 0.5, zIndex: cls === 'lodging' ? 1 : 2 });
    ov.setMap(map);
    mapObjects.push(ov);
  }
  // 경로에 넣을 점과, 각 점으로 오는 구간의 이동 방법(걷기/대중교통)·그 선택을 담는 곳(stop 또는 backStop)
  const pts = [], modes = [], refs = [];
  function pushPt(p, mode, ref) {
    if (pts.length) { modes.push(mode || null); refs.push(ref); }
    pts.push({ lat: p.lat, lng: p.lng });
  }

  // 출발지(집)는 멀리 있어 지도에서 빼고, 숙소·장소만 표시
  if (!day.startPoint.isHome) { addPoint(day.startPoint, '숙', 'lodging'); pushPt(day.startPoint); }
  let n = 0;
  day.items.forEach(function (it) {
    addPoint(it.stop.p, it.stop.meal ? '🍴' : String(++n), it.stop.meal ? 'meal' : 'visit');
    pushPt(it.stop.p, it.moveMode, it.stop);
  });
  if (!day.endPoint.isHome) {
    if (day.startPoint.isHome) addPoint(day.endPoint, '숙', 'lodging');
    const dayPlan = plan.days[curDay];
    if (!dayPlan.backStop) dayPlan.backStop = {};
    pushPt(day.endPoint, day.backMode, dayPlan.backStop);
  }
  // 경로선: 실제 길을 따라 (js/road-route.js — 불러오기 전·실패 시에는 점선 직선)
  //   대중교통 경로가 없다고 나온 구간은 걷기로 바꿔 시간표를 다시 계산 (사용자가 직접 고른 구간은 그대로)
  const note = document.getElementById('route-note');
  const route = drawRoute(map, pts, color, function (ok, info) {
    note.textContent = routeNoteText(trip.transport, ok, info);
    if (!ok || !info || !info.legs) return;
    if (replaceUnreachable(info.legs, pts, refs)) return;   // 바꾼 장소가 있으면 거기서 다시 그림
    let changed = false;
    info.legs.forEach(function (leg, i) {
      const ref = refs[i];
      if (leg.noTransit && ref && !ref.legMode && !ref.autoWalk) { ref.autoWalk = true; changed = true; }
    });
    if (changed || info.learned) refresh(false);   // 걷기로 바뀐 구간이 있거나 실제 대중교통 시간을 새로 받았으면 시간표 다시 계산
    else renderDay();   // 구간 안내(🚌 202 → …)를 타임라인에 표시
  }, trip.transport, modes);
  mapObjects.push({ setMap: function () { route.remove(); } });
  if (pts.length) map.setBounds(bounds, 40, 40, 40, 40);
}

// ---------- 대중교통으로 가기 어려운 장소 바꾸기 ----------
// 이재훈 결정 (2026-10-09): 대중교통 여행이면, 대중교통 경로가 없고 걷기에도 먼(2km 이상) 장소는 추천하지 않음
// 입력: 길찾기 결과(구간들), 경로 점, 각 점의 stop / 출력: 그런 장소를 같은 종류의 다른 장소로 바꾸고 true (없으면 false)
//   새로 추천받은 일정(주소에 ?plan=)에서만 자동으로 바꿈. 저장된 일정은 사용자가 고른 것이라 바꾸지 않고 경고만 표시
//   사용자가 걷기/대중교통을 직접 고른 구간, 숙소로 가는 구간은 건드리지 않음
const FAR_WALK_KM = 2;
const unreachable = new Set();   // 이번 화면에서 '대중교통 없음 + 먼 거리'로 확인된 장소 id
let replaceRounds = 0;
function replaceUnreachable(legs, pts, refs) {
  if (trip.transport !== '대중교통' || !param('plan') || replaceRounds >= 6) return false;
  const used = usedIds(), notes = [];
  legs.forEach(function (leg, i) {
    const stop = refs[i];
    if (!leg.noTransit || !stop || !stop.p || stop.legMode || distanceKm(pts[i], pts[i + 1]) < FAR_WALK_KM) return;
    unreachable.add(stop.p.id);
    const prev = pts[i];
    const pool = stop.p.type === '식당' ? mealRestaurants() : places.filter(function (p) { return p.type === '명소' && usable(p, trip); });
    const cand = pool.filter(function (p) { return !used.has(p.id) && !unreachable.has(p.id); })
      .sort(function (a, b) { return (b._s || 0) / (1 + distanceKm(prev, b) / 2) - (a._s || 0) / (1 + distanceKm(prev, a) / 2); })[0];
    if (!cand) return;
    notes.push(stop.p.name + ' → ' + cand.name);
    used.add(cand.id);
    stop.p = cand;
    if (!stop.meal) stop.stay = cand.stayMin;
    delete stop.autoWalk;
  });
  if (!notes.length) return false;
  replaceRounds++;
  refresh(true);
  document.getElementById('save-msg').textContent = '대중교통으로 가기 어려운 곳을 바꿨어요: ' + notes.join(', ');
  return true;
}

function panTo(p) { if (map) map.panTo(new kakao.maps.LatLng(p.lat, p.lng)); }

function showPlace(p) {
  const card = document.getElementById('place-card');
  const route = 'https://map.kakao.com/link/to/' + encodeURIComponent(p.name) + ',' + p.lat + ',' + p.lng;
  card.innerHTML =
    (p.photo ? '<img class="place-photo" src="' + esc(p.photo) + '" alt=""><small class="photo-credit">사진: 한국관광공사</small>' : '') +
    '<h3>' + esc(p.name) + '</h3>' +
    '<p class="helper-text muted">' + esc(p.categoryName || p.type) + (p.address ? ' · ' + esc(p.address) : '') + '</p>' +
    '<p class="helper-text">' + (p.type === '숙소' ? '1박 ' : '1인 ') + (p.cost ? won(p.cost) : '무료') +
      (p.costCheck === '추정' ? ' (추정)' : '') + (p.stayMin && p.type !== '숙소' ? ' · 기본 체류 ' + p.stayMin + '분' : '') + '</p>' +
    (p.basis && p.scoredBy && p.scoredBy.indexOf('세부분류') === -1 ? '<p class="helper-text">' + esc(p.basis) + '</p>' : '') +
    legInfoHtml(p) +
    '<p class="place-links">' +
      (p.link ? '<a href="' + esc(p.link) + '" target="_blank" rel="noopener">카카오맵에서 보기</a>' : '') +
      '<a href="' + esc(route) + '" target="_blank" rel="noopener">카카오맵 길찾기</a>' +
      '<a href="' + esc(blogSearchUrl(p)) + '" target="_blank" rel="noopener">블로그 후기 보기</a></p>';
}

// ---------- 5. 저장 ----------

document.getElementById('save-btn').addEventListener('click', async function () {
  const btn = this, msg = document.getElementById('save-msg');
  btn.disabled = true;
  msg.textContent = '저장 중…';
  try {
    // 0) 함께 편집하는 친구가 그사이에 먼저 저장했는지 확인 (나중에 저장한 쪽이 덮어쓰므로 물어봄)
    if (trip.updated_at) {
      const now = await sb.from('trips').select('updated_at').eq('id', trip.id).single();
      if (!now.error && now.data.updated_at !== trip.updated_at &&
          !confirm('이 화면을 연 뒤에 다른 사람이 이 여행을 먼저 고쳤어요. 내 일정으로 덮어쓸까요?\n(취소하면 저장하지 않아요. 새로고침하면 바뀐 일정을 볼 수 있어요.)')) {
        msg.textContent = '저장하지 않았어요.';
        btn.disabled = false;
        return;
      }
    }
    // 0-2) 걷기/대중교통을 직접 고른 구간이 있으면, 저장할 열이 DB에 있는지 먼저 확인 (없으면 지우기 전에 멈춤 → 일정이 사라지지 않게)
    const picked = plan.days.some(function (d) {
      return (d.backStop && d.backStop.legMode) || d.stops.some(function (st) { return st.legMode; });
    });
    if (picked) {
      const chk = await sb.from('trip_places').select('leg_mode').limit(1);
      if (chk.error) throw new Error('leg_mode 열이 없어요');
    }
    // 1) 여행에 고른 여행지·일정안·총비용·날짜별 시작 시각 기록
    const up = await sb.from('trips').update(Object.assign({
      region: plan.region, plan_type: plan.type, total_cost: Math.round(timeline.cost.total),
      // 날짜별 시작 시각 + 맨 끝에 숙소 도착 시각 (예: 3일 여행이면 [1일차, 2일차, 3일차, 숙소 도착])
      day_starts: plan.days.map(function (d) { return d.start; }).concat([plan.lodgingArrive || LODGING_ARRIVE])
    }, plan.days.some(function (d) { return d.backStop && d.backStop.legMode; }) || trip.back_modes
      ? { back_modes: plan.days.map(function (d) { return (d.backStop && d.backStop.legMode) || null; }) } : {})).eq('id', trip.id).select().single();
    if (up.error) throw up.error;
    trip.updated_at = up.data.updated_at;
    // 2) 예전 장소 목록 지우고 새로 넣기 (숙소는 day_no 0)
    const del = await sb.from('trip_places').delete().eq('trip_id', trip.id);
    if (del.error) throw del.error;
    const rows = [];
    if (plan.lodging) {
      rows.push({ trip_id: trip.id, place_id: String(plan.lodging.id), name: plan.lodging.name, type: '숙소',
        day_no: 0, order_no: 0, cost: timeline.cost.lodging, lat: plan.lodging.lat, lng: plan.lodging.lng });
    }
    timeline.days.forEach(function (d, di) {
      d.items.forEach(function (it, oi) {
        rows.push({ trip_id: trip.id, place_id: String(it.stop.p.id), name: it.stop.p.name, type: it.stop.p.type,
          day_no: di + 1, order_no: oi + 1, start_time: hhmm(it.begin), stay_min: it.stop.stay, cost: it.cost,
          lat: it.stop.p.lat, lng: it.stop.p.lng, meal: it.stop.meal || null, not_before: it.stop.notBefore || null });
        if (it.stop.legMode) rows[rows.length - 1].leg_mode = it.stop.legMode;   // 사용자가 고른 걷기/대중교통만 저장 (자동은 저장 안 함)
      });
    });
    const ins = await sb.from('trip_places').insert(rows);
    if (ins.error) throw ins.error;
    dirty = false;
    trip.region = plan.region; trip.plan_type = plan.type;
    history.replaceState(null, '', 'detail.html?trip=' + trip.id);   // 새로고침하면 저장된 일정을 불러오도록
    msg.innerHTML = '저장했어요! <a href="trip.html?trip=' + trip.id + '">여행 정보·준비물 보러 가기 →</a>';
  } catch (e) {
    msg.textContent = '';
    showError(/leg_mode|back_modes/.test(e.message || '')
      ? { message: '걷기/대중교통 선택을 저장하려면 Supabase에서 sql/add_leg_mode.sql을 먼저 실행해 주세요.' } : e);
  }
  btn.disabled = false;
});

window.addEventListener('beforeunload', function (e) {
  if (dirty) { e.preventDefault(); e.returnValue = ''; }
});

start();
