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
const LODGING_ARRIVE = 20 * 60;   // 숙소 도착 시각: 20:00 이후 (이재훈 결정, 상세 화면에서 바꿀 수 있음). 마지막 날 집 도착은 제한 없음
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

// ---------- 1-2. 식당 종류 (식사 / 디저트·카페 / 주점) 와 메뉴 종류 ----------
// TourAPI 분류: 카페·찻집·기타음료점·제과 = 디저트, 주점 = 식사 추천에서 제외
// 한식은 대부분 '관광식당' 한 분류라서 이름에 들어 있는 단어로 메뉴 종류를 나눔 (단어 목록은 Claude가 정한 규칙)
//   순서대로 검사해 처음 맞는 종류로 정함 (예: '돼지국밥'은 고기보다 국밥·탕이 먼저)
const DESSERT_CATS = ['FD050100', 'FD050200', 'FD050300', 'FD030100'];
const DESSERT_WORDS = /카페|커피|베이커리|제과|빵|디저트|케이크|도넛|젤라또|아이스크림|빙수|티하우스|찻집|다방|로스터/;
const BAR_CATS = ['FD040100', 'FD040200', 'FD040300', 'FD040400'];
const GROUPS = [
  ['회·해산물', /횟집|회센터|물회|수산|해물|조개|대게|킹크랩|게장|장어|복어|아구|아귀|생선|전복|굴|해녀|멍게|문어|낙지|쭈꾸미|주꾸미|꼬막|매생이|어시장/],
  ['국밥·탕', /국밥|해장|곰탕|설렁탕|추어|순대|매운탕|전골|찌개|탕$|탕\s|감자탕|삼계|닭볶음|짬뽕/],
  ['면', /국수|칼국수|막국수|냉면|우동|면옥|소바|밀면|라멘|쌀국수/],
  ['고기', /갈비|고기|한우|정육|숯불|삼겹|돼지|흑돼지|불고기|오리|닭갈비|막창|곱창|양꼬치|육회|떡갈비|구이/],
  ['한정식·백반', /한정식|백반|정식|밥상|쌈밥|비빔밥|보리밥|두부|순두부|한식뷔페|기사식당|솥밥|곤드레|산채/]
];
function foodKind(p) {
  if (BAR_CATS.indexOf(p.category) !== -1) return 'bar';
  if (DESSERT_CATS.indexOf(p.category) !== -1 || DESSERT_WORDS.test(p.name)) return 'dessert';
  return 'meal';
}
function cuisineOf(p) {
  if (p.category === 'BREAKFAST') return '숙소 조식';
  if (foodKind(p) === 'dessert') return '디저트·카페';
  const c = p.category || '';
  if (c === 'FD020100') return '중식';
  if (c === 'FD020200') return '일식';
  if (c === 'FD020300' || c === 'FD020400' || c === 'FD020500' || c === 'FD030200') return '양식·기타외국식';
  if (c === 'FD030400' || c === 'FD030300' || c === 'FD030500' || c === 'FD030600') return '분식·간편식';
  for (const [g, re] of GROUPS) if (re.test(p.name)) return g;
  return '한식(기타)';
}

// ---------- 1-3. 정해진 랜덤 (같은 여행·같은 회차면 항상 같은 값) ----------
// 지역 점수에 ±10% 랜덤을 곱함 (이재훈 결정) — 같은 여행은 새로고침해도 그대로, '다시 추천'을 누르면 회차가 바뀌어 달라짐
const REGION_JITTER = 0.10;

// 글자 → 32비트 정수 (FNV-1a 해시)
function hashText(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
// 0 이상 1 미만 수 하나 (mulberry32 난수 한 번)
function seededRandom(seedText) {
  let t = (hashText(seedText) + 0x6D2B79F5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
// 입력: 여행 id, 회차, 지역 이름 / 출력: 0.9 ~ 1.1 사이 배수
function regionJitter(tripId, round, region) {
  return 1 + REGION_JITTER * (2 * seededRandom(tripId + '|' + round + '|' + region) - 1);
}

// ---------- 1-4. 지역 최소 비용 추정 (지역 파일을 열기 전, regions.json만으로) ----------
// 입력: trip, 지역 요약(costMin: 가장 싼 숙소 1박, 식사 식당 하위 25% 가격), 출발지와의 직선거리
// 출력: 원 — 왕복 교통비 + 가장 싼 숙소 × 방 수 × 박 수 + 하루 2끼 × 일수 × 인원 + 여행지 안 이동비 (입장료는 무료 명소가 많아 0으로 봄)
function estimateMinCost(trip, r, distKm) {
  const pay = payersOf(trip);
  const nights = trip.days - 1;
  const c = r.costMin || {};
  const transport = 2 * legCost(distKm, trip.transport, true, pay) +
    (trip.transport === '자동차' ? 30 * trip.days * CAR_WON_PER_KM               // 여행지 안 하루 약 30km (Claude 가정)
                                 : LOCAL_FARE * pay * (TEMPO[trip.tempo].count + 2) * trip.days);
  const lodging = nights > 0 ? (c.lodging || 0) * (trip.rooms || 1) * nights : 0;
  const food = (c.meal || 12000) * pay * (2 * trip.days + nights);   // 점심·저녁 + 숙박한 다음 날 아침
  return transport + lodging + food;
}

// ---------- 2. 여행지(지역) 순위 ----------
// 입력: trip, regions.json 배열 / 출력: 점수 높은 순 [{ region, score, oneWayMin, distKm, info }]
// 지역 점수 = 취향 점수(지역 명소 태그 평균) × (1 + 인기 상위 10곳 평균/5) × (1 − 왕복 이동 시간 ÷ 전체 활동 시간) × 예산 보정
//   → 오가는 데 여행 시간의 큰 몫을 쓰는 곳일수록, 여행이 짧을수록 많이 깎임 (감점 방식은 Claude 제안)
//   마지막에 × 랜덤 배수(0.9~1.1, round = 다시 추천 회차)
function rankRegions(trip, regions, round) {
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
    const jitter = regionJitter(trip.id, round || 0, r.region);
    // 예산: 이 지역에 가면 최소 얼마 드는지 추정해, 최대 예산을 넘으면 (예산 ÷ 최소 비용)² 만큼 깎음 (Claude 설계)
    //   → 예산이 빠듯하면 가깝고 싼 지역이 위로 올라옴. 예산 안이면 깎지 않음
    const estCost = estimateMinCost(trip, r, distKm);
    const budgetFactor = estCost > trip.budget_max ? Math.pow(trip.budget_max / estCost, 2) : 1;
    const score = base * (1 - ratio) * budgetFactor * jitter;
    if (score <= 0) return;
    out.push({ region: r.region, score: score, jitter: jitter, oneWayMin: oneWayMin, distKm: distKm, info: r,
               estCost: estCost, budgetFactor: budgetFactor });
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
    meal: max * BUDGET_SHARE.food / (pay * (trip.days * 2 + nights)),               // 1인 1끼 (점심·저녁 + 숙박한 다음 날 아침)
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

// 예산 상한 이하 후보만 고름. 부족하면 상한을 10%씩 올려 다시 (최대 3배까지 — 2026-10-07 변경, 예산이 빠듯해도 여행지 5곳을 보여 주기 위함)
// relax가 1보다 크면 화면에 '예산 상한을 올려서 찾음'을 표시하고, 총비용이 최대 예산을 넘으면 빨간색으로 경고
// 출력: { attractions, restaurants, lodgings, relax } 또는 null(예산 조정 필요)
function preparePool(trip, places) {
  const caps = budgetCaps(trip);
  const tempo = TEMPO[trip.tempo];
  const nights = trip.days - 1;
  const base = places.filter(function (p) { return usable(p, trip); });
  base.forEach(function (p) { p._s = withPopularity(tagScore(p.tags, trip.tags), p.popularity); });

  for (let step = 0; step <= 20; step++) {
    const relax = 1 + step * 0.1;
    const pool = { attractions: [], restaurants: [], lodgings: [], relax: relax };
    base.forEach(function (p) {
      if (p.type === '명소' && p.cost <= caps.admission * relax) pool.attractions.push(p);
      else if (p.type === '식당' && foodKind(p) === 'meal' && p.cost <= caps.meal * relax) pool.restaurants.push(p);   // 디저트·주점은 식사로 안 넣음
      else if (p.type === '숙소' && p.cost <= caps.lodging * relax) pool.lodgings.push(p);
    });
    const enough = pool.attractions.length >= tempo.count * trip.days &&
                   pool.restaurants.length >= 2 * trip.days &&
                   (nights === 0 || pool.lodgings.length > 0);
    if (enough) {
      // 예산 맞추기(fitBudget)에서 쓸, 상한 없이 쓸 수 있는 전체 후보
      pool.all = {
        attractions: base.filter(function (p) { return p.type === '명소'; }),
        restaurants: base.filter(function (p) { return p.type === '식당' && foodKind(p) === 'meal'; }),
        lodgings: base.filter(function (p) { return p.type === '숙소'; })
      };
      return pool;
    }
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
// 같은 메뉴 종류를 이미 먹었으면 점수를 나눠 깎고(1회 → ½, 2회 → ⅓), 바로 전 끼니와 같은 종류면 크게 깎음(×0.2)
//   → 국밥 다음엔 회·면·고기처럼 다른 종류가 먼저 뽑힘. 근처에 다른 종류가 전혀 없을 때만 같은 종류 허용
function pickRestaurant(type, list, pos, used, eaten, lastGroup) {
  let best = null, bestVal = -1;
  list.forEach(function (r) {
    if (used.has(r.id)) return;
    const d = distanceKm(pos, r);
    const s = (r._s || 0) + 1;
    let val;
    if (type === 'A') val = s / (1 + d);
    else if (type === 'B') val = s / (1 + 3 * d);
    else val = s / ((1 + d) * (1 + r.cost / 5000));
    const g = cuisineOf(r);
    val /= 1 + (eaten[g] || 0);
    if (g === lastGroup) val *= 0.2;
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
  const eaten = {};        // 메뉴 종류별 먹은 횟수 (여행 전체)
  let lastGroup = null;    // 바로 전 끼니의 메뉴 종류

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
      // 점심: 11:00이 지났고, 다음 장소까지 보면 13:00을 넘길 것 같으면 지금 먹음 (도착 시각이 14:00 이후인 첫날만 생략)
      if (!lunch && visited > 0 && clock >= 11 * 60 &&
          clock + travelMin(distanceKm(pos, p), trip.transport, !!pos.isHome) + p.stayMin > 13 * 60) {
        lunch = true;
        clock = addMeal(stops, 'lunch', pos, clock);
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
    if (!lunch && (visited > 0 || clock <= LUNCH.until)) clock = addMeal(stops, 'lunch', pos, clock);
    if (!dinner && (!lastDay || clock >= DINNER_FROM)) clock = addMeal(stops, 'dinner', pos, clock);   // 마지막 날은 늦게 끝날 때만 저녁
    days.push({ start: DAY_START, stops: stops });
  }
  return { type: type, region: pool.region, lodging: lodging, days: days, relax: pool.relax };

  // 식당을 일정에 넣고, 식사가 끝나는 시각을 돌려줌
  function addMeal(stops, kind, pos, clock) {
    const r = pickRestaurant(type, pool.restaurants, pos.isHome ? anchor : pos, used, eaten, lastGroup);
    if (!r) return clock;
    used.add(r.id);
    lastGroup = cuisineOf(r);
    eaten[lastGroup] = (eaten[lastGroup] || 0) + 1;
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
  const plans = {};
  ['A', 'B', 'C'].forEach(function (k) {
    plans[k] = fitBudget(trip, syncBreakfast(trip, buildPlan(k, trip, pool), pool.all.restaurants), pool);
  });
  return plans;
}

// ---------- 4-1. 아침 식사 ----------
// 첫날 아침은 집에서 먹고 출발(일정·비용에 넣지 않음, Claude 결정). 숙박한 다음 날부터는 08:00에 아침을 넣음
// 숙소 종류별 조식 (조식 가격은 숙소 데이터에 없어 아래 자료로 정한 값):
//   호텔: 1인 30,000원 — 신라스테이 전주 조식 현장 결제 성인 3만원 (trvlogue, 2026-05)
//         1박 25만원 이상 호텔은 68,500원 — 서울 5성급 호텔 조식 8곳(55,000~86,000원)의 중앙값 (여행픽, 2025-11)
//   리조트·콘도·레지던스: 1인 37,000원 — 한화리조트 설악 쏘라노 조식 성인 정상가 (CEO스코어데일리, 2024-06)
//   게스트하우스·유스호스텔: 무료 간단 조식(토스트·시리얼 등 셀프) — 나무위키 '게스트하우스'
//   펜션·한옥스테이·모텔·민박·홈스테이: 조식 자료가 없어 숙소 근처(3km) 식당에서 아침 (국밥·백반·분식·면 우선)
//   어린이(7~12세)는 성인의 50% (5성급 호텔 어린이 가격이 성인의 절반), 유아는 0원(앞의 가정과 같음)
const BREAKFAST = {
  hotel: 30000, luxuryHotel: 68500, luxuryRoom: 250000, resort: 37000, childRate: 0.5,
  start: 8 * 60, stay: 60
};
const BREAKFAST_GROUPS = ['국밥·탕', '한정식·백반', '분식·간편식', '면'];

// 입력: 숙소 / 출력: { kind: 'paid' | 'free' | 'none', price }
function lodgingBreakfast(l) {
  const c = l && l.category || '';
  if (c === 'AC010100') return { kind: 'paid', price: l.cost >= BREAKFAST.luxuryRoom ? BREAKFAST.luxuryHotel : BREAKFAST.hotel };
  if (c === 'AC020100' || c === 'AC020200' || c === 'VE050200') return { kind: 'paid', price: BREAKFAST.resort };
  if (c === 'AC060100' || c === 'AC060200') return { kind: 'free', price: 0 };
  return { kind: 'none', price: 0 };
}

// 숙소 조식을 일정의 한 장소처럼 쓰기 위한 가짜 장소 (id 'bf-숙소id', 위치 = 숙소)
function breakfastPlace(l) {
  const b = lodgingBreakfast(l);
  return { id: 'bf-' + l.id, name: l.name + ' 조식' + (b.kind === 'free' ? '(무료·간단)' : ''), type: '식당',
           category: 'BREAKFAST', categoryName: '숙소 조식', breakfastOf: l.id, cost: b.price, lat: l.lat, lng: l.lng,
           stayMin: BREAKFAST.stay, tags: {}, _s: 0, recommend: true };
}

// 숙소 근처 아침 식당 고르기: ① 3km 안 국밥·백반·분식·면 → ② 10km 안 같은 종류 → ③ 10km 안 한식(기타)
//   → ④ 3km 안 아무 식사 식당 → ⑤ 가장 가까운 식당 (아침에 어울리는 메뉴 순서는 Claude 판단)
function pickBreakfastRestaurant(lodging, restaurants, used) {
  const near = restaurants.filter(function (r) { return !used.has(r.id); })
    .map(function (r) { return { r: r, d: distanceKm(lodging, r), bf: BREAKFAST_GROUPS.indexOf(cuisineOf(r)) !== -1 }; })
    .sort(function (a, b) { return a.d - b.d; });
  const rules = [
    function (x) { return x.bf && x.d <= 3; },
    function (x) { return x.bf && x.d <= 10; },
    function (x) { return cuisineOf(x.r) === '한식(기타)' && x.d <= 10; },
    function (x) { return x.d <= 3; },
    function () { return true; }
  ];
  for (let k = 0; k < rules.length; k++) {
    const hit = near.find(rules[k]);
    if (hit) return hit.r;
  }
  return null;
}

// 일정의 2일차부터 맨 앞에 아침을 넣거나(없으면), 숙소가 바뀌었으면 맞게 고침
// 입력: trip, plan, 식사 식당 목록 / 출력: plan (days[].stops[0] = 아침, day.start = 08:00)
function syncBreakfast(trip, plan, restaurants) {
  if (!plan.lodging) return plan;
  const used = new Set();
  plan.days.forEach(function (d) { d.stops.forEach(function (st) { used.add(st.p.id); }); });
  const b = lodgingBreakfast(plan.lodging);
  plan.days.forEach(function (day, i) {
    if (i === 0) return;
    let stop = day.stops.find(function (st) { return st.meal === '아침'; });
    if (!stop) {
      stop = { p: null, stay: BREAKFAST.stay, notBefore: BREAKFAST.start, meal: '아침' };
      day.stops.unshift(stop);
      if (day.start === DAY_START) day.start = BREAKFAST.start;
    }
    if (b.kind !== 'none') {
      stop.p = breakfastPlace(plan.lodging);
    } else if (!stop.p || stop.p.breakfastOf != null) {   // 숙소 조식이 없는 숙소로 바뀜 → 근처 식당
      if (stop.p) used.delete(stop.p.id);
      const r = pickBreakfastRestaurant(plan.lodging, restaurants, used);
      if (r) { stop.p = r; used.add(r.id); } else day.stops.splice(day.stops.indexOf(stop), 1);
    }
  });
  return plan;
}

// ---------- 4-2. 예산 맞추기: 총비용이 최대 예산을 넘으면 더 싼 곳으로 하나씩 바꿈 ----------
// 입력: trip, 만든 일정안, 후보(pool.all) / 출력: 같은 일정안 (바꾼 장소 기록 plan.swaps, 예산 안인지 plan.fits)
// 방법(욕심쟁이 방식, Claude 설계): 총비용이 최대 예산 이하가 될 때까지 반복
//   ① 바꿀 수 있는 모든 경우를 만듦 — 숙소 → 더 싼 숙소 / 식사 → 근처(5km) 더 싼 식당 / 유료 명소 → 근처(10km) 더 싼 명소
//   ② 경우마다 '아끼는 돈 ÷ (1 + 잃는 것)'을 계산. 잃는 것 = 취향 점수가 떨어진 비율 + 멀어진 거리(km)/5
//   ③ 가장 큰 경우 하나를 적용하고 다시 계산 → 많이 아끼면서 덜 아쉬운 것부터 바뀜
// 출발지↔여행지 교통비처럼 줄일 수 없는 비용만으로 예산을 넘으면 더 바꿀 것이 없어 멈춤 (fits = false)
function fitBudget(trip, plan, pool) {
  const max = trip.budget_max;
  const pay = payersOf(trip);
  const nights = trip.days - 1;
  const rooms = trip.rooms || 1;
  plan.swaps = [];

  function loss(oldP, newP, km, kmScale) {
    const drop = Math.max(0, (oldP._s || 0) - (newP._s || 0)) / ((oldP._s || 0) + 1);
    return drop + km / kmScale;
  }

  for (let round = 0; round < 60; round++) {
    const total = computeTimeline(trip, plan).cost.total;
    if (total <= max) break;
    const used = new Set();
    plan.days.forEach(function (d) { d.stops.forEach(function (st) { used.add(st.p.id); }); });
    let best = null;

    function consider(saving, lost, apply, from, to) {
      if (saving <= 0) return;
      const value = saving / (1 + lost);
      if (!best || value > best.value) best = { value: value, apply: apply, from: from, to: to, saving: saving };
    }

    // 숙소
    if (plan.lodging && nights > 0) {
      const cur = plan.lodging;
      pool.all.lodgings.forEach(function (l) {
        if (l.cost >= cur.cost) return;
        const km = distanceKm(cur, l);
        consider((cur.cost - l.cost) * rooms * nights, loss(cur, l, km, 5),
                 function () { plan.lodging = l; syncBreakfast(trip, plan, pool.all.restaurants); }, cur, l);
      });
    }
    // 식사·명소
    plan.days.forEach(function (d) {
      d.stops.forEach(function (st) {
        const cur = st.p;
        if (!(cur.cost > 0)) return;
        const isFood = cur.type === '식당';
        const list = isFood ? pool.all.restaurants : pool.all.attractions;
        const range = isFood ? 5 : 10;
        list.forEach(function (c) {
          if (c.cost >= cur.cost || used.has(c.id)) return;
          const km = distanceKm(cur, c);
          if (km > range) return;
          consider((cur.cost - c.cost) * pay, loss(cur, c, km, isFood ? 2 : 5), function () {
            st.p = c;
            if (!st.meal) st.stay = c.stayMin;
          }, cur, c);
        });
      });
    });

    if (!best) break;
    best.apply();
    plan.swaps.push({ from: best.from.name, to: best.to.name, saving: best.saving });
  }
  plan.fits = computeTimeline(trip, plan).cost.total <= max;
  return plan;
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
      let c = stop.p.type === '숙소' ? 0 : (stop.p.cost || 0) * pay;
      if (stop.p.breakfastOf != null) {   // 숙소 조식: 어린이는 성인의 50%, 유아 0원
        c = (stop.p.cost || 0) * (pay - (trip.children || 0) * (1 - BREAKFAST.childRate));
      }
      if (stop.p.type === '식당') cost.food += c; else cost.admission += c;
      if (!stop.meal) { active += mv.min + stop.stay; visits++; } else active += mv.min;
      items.push({ stop: stop, index: i, moveMin: mv.min, moveKm: mv.km, arrive: arrive, begin: begin, end: end, cost: c });
      clock = end;
      pos = stop.p;
    });
    // 숙소로 가는 날: 숙소 도착이 20:00(바꿀 수 있음) 이후가 되도록 그 전까지 자유 시간 / 집으로 가는 날: 끝나는 대로 출발
    const back = leg(endPoint);
    active += back.min;
    let departMin = clock;
    if (!endPoint.isHome) departMin = Math.max(clock, (plan.lodgingArrive || LODGING_ARRIVE) - back.min);
    const endMin = departMin + back.min;
    return { start: day.start, startPoint: startPoint, endPoint: endPoint, items: items, departMin: departMin,
             freeMin: departMin - clock, backMin: back.min, backKm: back.km, endMin: endMin, activeMin: active, over: active > limit };
  });

  cost.total = cost.lodging + cost.food + cost.admission + cost.transport;
  return { days: days, cost: cost, distanceKm: distance, visits: visits, visitsPerDay: visits / plan.days.length };
}

// 장소 점수가 아직 없으면 계산해 붙임 (저장된 일정을 불러온 경우 등)
function ensureScores(places, trip) {
  places.forEach(function (p) {
    if (p._s == null) p._s = withPopularity(tagScore(p.tags || {}, trip.tags), p.popularity);
  });
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

// 저장된 trip_places 행 → plan 구조로 되돌리기
// 입력: trip(region·plan_type·day_starts), 그 지역 장소 배열 / 출력: plan (저장된 일정이 없으면 null)
async function loadSavedPlan(trip, places) {
  const { data, error } = await sb.from('trip_places').select('*').eq('trip_id', trip.id)
    .order('day_no').order('order_no');
  if (error) throw error;
  if (!data.length) return null;
  const byId = {};
  places.forEach(function (p) { byId[String(p.id)] = p; });
  const days = [];
  for (let d = 0; d < trip.days; d++) {
    days.push({ start: (trip.day_starts && trip.day_starts[d]) || DAY_START, stops: [] });
  }
  let lodging = null;
  data.forEach(function (row) {
    // 숙소 조식(id 'bf-숙소id')은 장소 파일에 없으므로 숙소 정보로 다시 만듦
    if (lodging && String(row.place_id).indexOf('bf-') === 0) {
      days[row.day_no - 1].stops.push({ p: breakfastPlace(lodging), stay: row.stay_min, meal: row.meal || '아침', notBefore: row.not_before || undefined });
      return;
    }
    const p = byId[row.place_id] || { id: row.place_id, name: row.name, type: row.type, lat: row.lat, lng: row.lng,
                                      cost: 0, stayMin: row.stay_min, tags: {} };
    if (row.day_no === 0) { lodging = p; return; }
    const stop = { p: p, stay: row.stay_min };
    if (row.meal) stop.meal = row.meal;
    if (row.not_before) stop.notBefore = row.not_before;
    if (days[row.day_no - 1]) days[row.day_no - 1].stops.push(stop);
  });
  const lodgingArrive = trip.day_starts && trip.day_starts.length > trip.days ? trip.day_starts[trip.days] : LODGING_ARRIVE;
  return { type: trip.plan_type, region: trip.region, lodging: lodging, days: days, relax: 1, lodgingArrive: lodgingArrive };
}

// node로 시험할 때 쓰도록 내보내기 (브라우저에서는 무시됨)
if (typeof module !== 'undefined') {
  module.exports = { TEMPO, rankRegions, buildPlans, buildPlan, preparePool, computeTimeline, distanceKm,
    travelMin, budgetCaps, hhmm, PLAN_INFO, isChain, LODGING_ARRIVE, foodKind, cuisineOf, pickRestaurant, ensureScores, estimateMinCost, fitBudget, syncBreakfast, breakfastPlace, lodgingBreakfast };
}
