// TripMate 추천 알고리즘 — 계산만 하고 화면은 그리지 않음 (result·plans·detail 화면이 함께 사용)
// 입력: trip(조건 입력값 = trips 테이블 한 행), data/regions.json, 지역별 장소 파일 data/places/지역.json
// 출력: rankRegions → 여행지 순위 / buildPlans → 일정안 A·B·C / computeTimeline → 시간표·비용·이동거리

// ---------- 0. 기준값 ----------
// 템포: 하루 방문 곳 수(식사 제외)와 하루 활동 시간 — 둘 중 먼저 닿는 쪽에서 그날 마감 (이재훈 결정)
const TEMPO = {
  여유롭게: { count: 2, hours: 6 },
  균형있게: { count: 4, hours: 8 },
  알차게:   { count: 6, hours: 10 }
};
// 여행지 안 장소 사이 이동: 직선거리 ÷ 평균 속도 (계획서 값)
const LOCAL_KMH = { 대중교통: 20, 자동차: 40 };
// 출발지 ↔ 여행지 이동: 길찾기 결과에 맞춘 근사식 (Claude 추정값)
//   분 = baseMin + 직선거리 × road ÷ kmh × 60
//   맞춰 본 실제 값: 동서울→속초 고속버스 2:16, 동서울→전주 고속버스 3:28, 서울→강릉 KTX 1:54
const INTERCITY = {
  대중교통: { baseMin: 45, road: 1.0, kmh: 90 },   // 45분 = 역·터미널까지 가는 시간과 대기
  자동차:   { baseMin: 20, road: 1.25, kmh: 100 }  // 1.25 = 도로가 직선보다 굽은 정도
};
// 예산 배분 (계획서): 숙박 40% · 식비 30% · 교통 20% · 입장료·기타 10%
const BUDGET_SHARE = { lodging: 0.4, food: 0.3, transport: 0.2, etc: 0.1 };
// 교통비 추정 (Claude 추정값)
const CAR_WON_PER_KM = 140;       // 휘발유 약 1,700원/L ÷ 연비 약 12km/L, 차 1대 기준
const TRANSIT_WON_PER_KM = 110;   // 출발지↔여행지 KTX·고속버스 요금 ÷ 도로거리 대략값, 1인 기준
const LOCAL_FARE = 1500;          // 여행지 안 버스 1회 요금, 1인 기준 (1km 미만은 걸어서 0원)
// 시간표
const DAY_START = 9 * 60;         // 09:00 시작
const LUNCH = { from: 11 * 60 + 30, until: 14 * 60 };   // 점심을 넣는 시간대
const DINNER_FROM = 17 * 60 + 30;
const MEAL_STAY = 60;
// 흔한 체인점(프랜차이즈) 이름 — 이름에 들어 있으면 추천에서 제외 (이재훈 결정: 브랜드 이름 목록 방식)
const CHAIN_BRANDS = ['스타벅스', '투썸플레이스', '이디야', '메가커피', '메가MGC', '컴포즈커피', '빽다방', '할리스',
  '엔제리너스', '커피빈', '폴바셋', '파스쿠찌', '탐앤탐스', '카페베네', '공차', '설빙', '배스킨', '던킨',
  '파리바게뜨', '뚜레쥬르', '맥도날드', '버거킹', '롯데리아', '맘스터치', 'KFC', '서브웨이', '도미노피자',
  '피자헛', '교촌', 'BHC', 'bhc', 'BBQ', '본죽', '김밥천국', '홍콩반점', '새마을식당', '한신포차',
  '아웃백', '빕스', '애슐리'];

// ---------- 1. 작은 계산 도구 ----------

// 두 지점 사이 직선거리(km) — 지구를 구로 보는 하버사인 공식
function distanceKm(a, b) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// 이동 시간(분). intercity=true면 출발지↔여행지 구간 (가까우면 여행지 안 속도가 더 빠를 수 있어 작은 쪽)
function travelMin(km, transport, intercity) {
  const local = km / LOCAL_KMH[transport] * 60;
  if (!intercity) return Math.round(local);
  const c = INTERCITY[transport];
  return Math.round(Math.min(local, c.baseMin + km * c.road / c.kmh * 60));
}

// 한 구간 교통비(원)
function legCost(km, transport, intercity, payers) {
  if (transport === '자동차') return Math.round(km * (intercity ? INTERCITY.자동차.road : 1) * CAR_WON_PER_KM);
  if (intercity) return Math.round(km * 1.25 * TRANSIT_WON_PER_KM) * payers;
  return km < 1 ? 0 : LOCAL_FARE * payers;
}

// 돈을 내는 인원 (유아 0~6세는 입장료·식비·교통비 0원으로 봄 — Claude 가정)
function payersOf(trip) {
  return Math.max(1, trip.people - (trip.infants || 0));
}

// 취향 점수: 사용자가 고른 태그 점수만 더함, 1순위 태그는 1.5배 (계획서)
function tagScore(tags, userTags) {
  let s = 0;
  userTags.forEach(function (t, i) { s += (tags[t] || 0) * (i === 0 ? 1.5 : 1); });
  return s;
}

// 인기도 반영: 최종 점수 = 점수 × (1 + 인기도/5) → 인기도 5점이면 2배 (이재훈 결정)
function withPopularity(score, popularity) {
  return score * (1 + (popularity || 0) / 5);
}

function isChain(name) {
  return CHAIN_BRANDS.some(function (b) { return name.indexOf(b) !== -1; });
}

function hhmm(min) {
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

function departureOf(trip) {
  return { name: '출발지', lat: trip.departure_lat, lng: trip.departure_lng, isHome: true };
}

// ---------- 2. 여행지(지역) 순위 ----------
// 입력: trip, regions.json 배열 / 출력: 점수 높은 순 [{ region, score, oneWayMin, distKm, info }]
// 지역 점수 = 취향 점수(지역 명소 태그 평균) × (1 + 인기 상위 10곳 평균/5) × (1 − 왕복 이동 시간 ÷ 전체 활동 시간)
//   → 오가는 데 여행 시간의 큰 몫을 쓰는 곳일수록, 여행이 짧을수록 많이 깎임 (감점 방식은 Claude 제안)
function rankRegions(trip, regions) {
  const tempo = TEMPO[trip.tempo];
  const dep = departureOf(trip);
  const totalActive = trip.days * tempo.hours * 60;
  const out = [];

  regions.forEach(function (r) {
    const lodgings = r.counts['숙소'] || 0;
    if (trip.days > 1 && lodgings === 0) return;          // 숙소 없는 지역은 당일치기만 (이재훈 결정)
    if ((r.counts['명소'] || 0) < tempo.count) return;
    const distKm = distanceKm(dep, r);
    const oneWayMin = travelMin(distKm, trip.transport, true);
    const ratio = 2 * oneWayMin / totalActive;
    const base = withPopularity(tagScore(r.tagAvg, trip.tags), r.popTop10);
    const score = base * (1 - ratio);
    if (score <= 0) return;
    out.push({ region: r.region, score: score, oneWayMin: oneWayMin, distKm: distKm, info: r });
  });
  return out.sort(function (a, b) { return b.score - a.score; });
}

// ---------- 3. 예산 상한과 후보 거르기 ----------

// 항목별 상한가: 최대 예산(budgetMax) 기준 (이재훈 결정)
function budgetCaps(trip) {
  const max = trip.budget_max, nights = trip.days - 1, rooms = trip.rooms || 1;
  const pay = payersOf(trip), count = TEMPO[trip.tempo].count;
  return {
    lodging: nights > 0 ? max * BUDGET_SHARE.lodging / (nights * rooms) : Infinity,  // 방 1개 1박
    meal: max * BUDGET_SHARE.food / (pay * trip.days * 2),                          // 1인 1끼 (하루 2끼)
    admission: max * BUDGET_SHARE.etc / (pay * trip.days * count)                   // 1인 1곳 입장료
  };
}

// 여행에 넣을 수 있는 장소인지 (예산과 상관없는 조건)
function usable(p, trip) {
  if (!p.recommend || isChain(p.name)) return false;
  if (p.audience === '10대' && !trip.teens) return false;    // 청소년 전용 공간은 청소년이 있을 때만
  if (p.type === '명소' && !(p.stayMin > 0)) return false;   // 체류 시간 0 = 야영장 등 숙박 시설
  if (p.type === '숙소' && !(p.cost > 0)) return false;      // 가격 모르는 숙소 제외
  return true;
}

// 예산 상한 이하 후보만 고름. 부족하면 상한을 10%씩 올려 다시 (최대 50%까지 — Claude 제안)
// 출력: { attractions, restaurants, lodgings, relax } 또는 null(예산 조정 필요)
function preparePool(trip, places) {
  const caps = budgetCaps(trip);
  const tempo = TEMPO[trip.tempo];
  const nights = trip.days - 1;
  const base = places.filter(function (p) { return usable(p, trip); });
  base.forEach(function (p) { p._s = withPopularity(tagScore(p.tags, trip.tags), p.popularity); });

  for (let step = 0; step <= 5; step++) {
    const relax = 1 + step * 0.1;
    const pool = { attractions: [], restaurants: [], lodgings: [], relax: relax };
    base.forEach(function (p) {
      if (p.type === '명소' && p.cost <= caps.admission * relax) pool.attractions.push(p);
      else if (p.type === '식당' && p.cost <= caps.meal * relax) pool.restaurants.push(p);
      else if (p.type === '숙소' && p.cost <= caps.lodging * relax) pool.lodgings.push(p);
    });
    const enough = pool.attractions.length >= tempo.count * trip.days &&
                   pool.restaurants.length >= 2 * trip.days &&
                   (nights === 0 || pool.lodgings.length > 0);
    if (enough) return pool;
  }
  return null;
}

// ---------- 4. 일정안 A·B·C 만들기 ----------
// A: 취향 점수 우선 / B: 이동 거리 최소 / C: 최저 비용 (계획서)
const PLAN_INFO = {
  A: { name: '취향 우선', desc: '고른 취향에 가장 잘 맞는 곳 위주' },
  B: { name: '동선 최소', desc: '숙소 가까운 곳 위주로 이동을 줄임' },
  C: { name: '비용 최저', desc: '저렴한 숙소·장소 위주' }
};

function centroid(list) {
  const n = list.length || 1;
  return {
    lat: list.reduce(function (s, p) { return s + p.lat; }, 0) / n,
    lng: list.reduce(function (s, p) { return s + p.lng; }, 0) / n
  };
}

function byDesc(key) { return function (a, b) { return key(b) - key(a); }; }

// 일정안별 숙소 고르기
function pickLodging(type, pool, center) {
  if (pool.lodgings.length === 0) return null;
  const list = pool.lodgings.slice();
  if (type === 'A') list.sort(function (a, b) { return (b._s - a._s) || (a.cost - b.cost); });
  if (type === 'B') list.sort(function (a, b) { return distanceKm(center, a) - distanceKm(center, b); });
  if (type === 'C') list.sort(function (a, b) { return (a.cost - b.cost) || (b._s - a._s); });
  return list[0];
}

// 일정안별 명소 우선순위 점수
function attractionKey(type, anchor) {
  if (type === 'A') return function (p) { return p._s; };
  if (type === 'B') return function (p) { return p._s / (1 + distanceKm(anchor, p) / 2); };
  return function (p) { return p._s / (1 + p.cost / 10000); };
}

// 지금 위치 근처 식당 고르기 (가까울수록 유리, 일정안 성격 반영)
function pickRestaurant(type, pool, pos, used) {
  let best = null, bestVal = -1;
  pool.restaurants.forEach(function (r) {
    if (used.has(r.id)) return;
    const d = distanceKm(pos, r);
    let val;
    if (type === 'A') val = (r._s + 1) / (1 + d);
    else if (type === 'B') val = (r._s + 1) / (1 + 3 * d);
    else val = (r._s + 1) / ((1 + d) * (1 + r.cost / 5000));
    if (val > bestVal) { bestVal = val; best = r; }
  });
  return best;
}

// 최근접 이웃: start에서 가장 가까운 곳 → 거기서 가장 가까운 곳 … 순서로 정렬 (계획서)
function nearestNeighbor(start, list) {
  const rest = list.slice(), out = [];
  let pos = start;
  while (rest.length) {
    let bi = 0, bd = Infinity;
    rest.forEach(function (p, i) { const d = distanceKm(pos, p); if (d < bd) { bd = d; bi = i; } });
    pos = rest[bi];
    out.push(rest.splice(bi, 1)[0]);
  }
  return out;
}

function makeStop(p, kind) {
  if (kind === 'lunch') return { p: p, stay: MEAL_STAY, notBefore: LUNCH.from, meal: '점심' };
  if (kind === 'dinner') return { p: p, stay: MEAL_STAY, notBefore: DINNER_FROM, meal: '저녁' };
  return { p: p, stay: p.stayMin };
}

// 일정안 하나 만들기
// 출력: { type, region, lodging, days: [{ start, stops: [{ p, stay, notBefore?, meal? }] }], relax }
function buildPlan(type, trip, pool) {
  const tempo = TEMPO[trip.tempo];
  const dep = departureOf(trip);
  const limit = tempo.hours * 60;
  const topCenter = centroid(pool.attractions.slice().sort(byDesc(function (p) { return p._s; })).slice(0, 30));
  const lodging = trip.days > 1 ? pickLodging(type, pool, topCenter) : null;
  const anchor = lodging || topCenter;
  const ranked = pool.attractions.slice().sort(byDesc(attractionKey(type, anchor)));
  const used = new Set();
  let next = 0, carry = [];
  const days = [];
  let mealMove = 0;

  for (let d = 1; d <= trip.days; d++) {
    const lastDay = d === trip.days;
    // 오늘 갈 후보: 어제 못 간 곳(이월) + 순위표에서 다음 곳들
    const picks = carry.slice();
    while (picks.length < tempo.count && next < ranked.length) {
      const p = ranked[next++];
      if (!used.has(p.id)) picks.push(p);
    }
    let pos = d === 1 ? dep : lodging;
    const ordered = nearestNeighbor(d === 1 ? anchor : pos, picks);
    const stops = [];
    let clock = DAY_START, active = 0, lunch = false, dinner = false, visited = 0;
    carry = [];
    mealMove = 0;

    for (let i = 0; i < ordered.length; i++) {
      const p = ordered[i];
      // 점심·저녁 시간이 되면 지금 위치 근처 식당을 먼저 넣음
      if (!lunch && clock >= LUNCH.from && visited > 0) {
        lunch = true;
        if (clock <= LUNCH.until) clock = addMeal(stops, 'lunch', pos, clock);
      }
      if (!dinner && clock >= DINNER_FROM && visited > 0) {
        dinner = true;
        clock = addMeal(stops, 'dinner', pos, clock);
      }
      const intercity = !!pos.isHome;
      const move = travelMin(distanceKm(pos, p), trip.transport, intercity);
      // 그날 끝에 숙소(마지막 날은 집)로 돌아갈 시간도 활동 시간 안에 남겨 둠
      const back = lastDay || !lodging ? travelMin(distanceKm(p, dep), trip.transport, true)
                                       : travelMin(distanceKm(p, lodging), trip.transport, false);
      // 활동 시간을 넘으면 그날 마감, 남은 곳은 다음 날로 이월 (단, 하루 최소 1곳)
      if (visited > 0 && active + mealMove + move + p.stayMin + back > limit) {
        carry = ordered.slice(i);
        break;
      }
      stops.push(makeStop(p, 'visit'));
      used.add(p.id);
      clock += move + p.stayMin;
      active += move + p.stayMin;
      visited++;
      pos = p;
    }
    if (!lunch && clock <= LUNCH.until) clock = addMeal(stops, 'lunch', pos, clock);
    if (!dinner && (!lastDay || clock >= DINNER_FROM)) clock = addMeal(stops, 'dinner', pos, clock);
    days.push({ start: DAY_START, stops: stops });
  }
  return { type: type, region: pool.region, lodging: lodging, days: days, relax: pool.relax };

  // 식당을 일정에 넣고, 식사가 끝나는 시각을 돌려줌
  function addMeal(stops, kind, pos, clock) {
    const r = pickRestaurant(type, pool, pos.isHome ? anchor : pos, used);
    if (!r) return clock;
    used.add(r.id);
    stops.push(makeStop(r, kind));
    const move = travelMin(distanceKm(pos.isHome ? anchor : pos, r), trip.transport, !!pos.isHome);
    mealMove += move;   // 식당까지 가는 시간은 활동 시간에 포함 (식사 시간은 제외)
    const at = Math.max(clock + move, kind === 'lunch' ? LUNCH.from : DINNER_FROM);
    return at + MEAL_STAY;
  }
}

// 입력: trip, 지역 이름, 그 지역 장소 배열 / 출력: { A, B, C } 또는 null(예산 안에서 후보 부족)
function buildPlans(trip, region, places) {
  const pool = preparePool(trip, places);
  if (!pool) return null;
  pool.region = region;
  return { A: buildPlan('A', trip, pool), B: buildPlan('B', trip, pool), C: buildPlan('C', trip, pool) };
}

// ---------- 5. 시간표·비용 계산 (일정 수정 후에도 이 함수로 다시 계산) ----------
// 입력: trip, plan / 출력: { days: [{ items, endMin, activeMin, over }], cost: {...}, distanceKm, visits }
function computeTimeline(trip, plan) {
  const dep = departureOf(trip);
  const limit = TEMPO[trip.tempo].hours * 60;
  const pay = payersOf(trip);
  const nights = trip.days - 1;
  const cost = { lodging: 0, food: 0, admission: 0, transport: 0, total: 0 };
  let distance = 0, visits = 0;

  if (plan.lodging) cost.lodging = plan.lodging.cost * (trip.rooms || 1) * nights;

  const days = plan.days.map(function (day, idx) {
    const d = idx + 1, lastDay = d === plan.days.length;
    const startPoint = d === 1 || !plan.lodging ? dep : plan.lodging;
    const endPoint = lastDay || !plan.lodging ? dep : plan.lodging;
    let pos = startPoint, clock = day.start, active = 0;
    const items = [];

    function leg(to) {
      const intercity = !!(pos.isHome || to.isHome);
      const km = distanceKm(pos, to);
      const min = travelMin(km, trip.transport, intercity);
      distance += intercity && trip.transport === '자동차' ? km * INTERCITY.자동차.road : km;
      cost.transport += legCost(km, trip.transport, intercity, pay);
      return { km: km, min: min };
    }

    day.stops.forEach(function (stop, i) {
      const mv = leg(stop.p);
      const arrive = clock + mv.min;
      const begin = Math.max(arrive, stop.notBefore || 0);
      const end = begin + stop.stay;
      const c = stop.p.type === '숙소' ? 0 : (stop.p.cost || 0) * pay;
      if (stop.p.type === '식당') cost.food += c; else cost.admission += c;
      if (!stop.meal) { active += mv.min + stop.stay; visits++; } else active += mv.min;
      items.push({ stop: stop, index: i, moveMin: mv.min, moveKm: mv.km, arrive: arrive, begin: begin, end: end, cost: c });
      clock = end;
      pos = stop.p;
    });
    const back = leg(endPoint);
    active += back.min;
    const endMin = clock + back.min;
    return { start: day.start, startPoint: startPoint, endPoint: endPoint, items: items,
             backMin: back.min, backKm: back.km, endMin: endMin, activeMin: active, over: active > limit };
  });

  cost.total = cost.lodging + cost.food + cost.admission + cost.transport;
  return { days: days, cost: cost, distanceKm: distance, visits: visits, visitsPerDay: visits / plan.days.length };
}

// ---------- 6. 데이터 불러오기 ----------
const _fileCache = {};
async function loadJSON(path) {
  if (!_fileCache[path]) {
    _fileCache[path] = fetch(path).then(function (r) {
      if (!r.ok) throw new Error(path + ' 파일을 불러오지 못했어요 (' + r.status + ')');
      return r.json();
    });
  }
  return _fileCache[path];
}
function loadRegions() { return loadJSON('data/regions.json'); }
function loadPlaces(region) { return loadJSON('data/places/' + encodeURIComponent(region) + '.json'); }

// node로 시험할 때 쓰도록 내보내기 (브라우저에서는 무시됨)
if (typeof module !== 'undefined') {
  module.exports = { TEMPO, rankRegions, buildPlans, buildPlan, preparePool, computeTimeline, distanceKm,
    travelMin, budgetCaps, hhmm, PLAN_INFO, isChain };
}
