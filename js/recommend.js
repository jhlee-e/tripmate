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
const LOCAL_FARE = 1500;          // 여행지 안 버스 1회 요금, 1인 기준 (걷는 구간은 0원)
// 시간표
const DAY_START = 9 * 60;         // 09:00 시작
const LUNCH = { from: 11 * 60 + 30, until: 14 * 60 };   // 점심을 넣는 시간대
const DINNER_FROM = 17 * 60 + 30;
const LODGING_ARRIVE = 20 * 60;   // 숙소 도착 시각: 20:00 이후 (이재훈 결정, 상세 화면에서 바꿀 수 있음). 마지막 날 집 도착은 제한 없음
const MEAL_STAY = 60;
const DAY_END = 22 * 60;          // 명소 방문은 22:00 전에 끝나게 (2026-10-10 추가)
// 여행 시작일이 오늘이면 1일차 출발 시각 = 지금 + 준비 30분 (10분 단위 올림), 아니면 09:00 (2026-10-10 이재훈 요청)
// 입력: trip, 지금 시각(시험용, 없으면 현재) / 출력: 분 단위 시각
function firstDayStart(trip, now) {
  now = now || new Date();
  const pad = function (n) { return String(n).padStart(2, '0'); };
  const today = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
  if (trip.start_date !== today) return DAY_START;
  const m = Math.ceil((now.getHours() * 60 + now.getMinutes() + 30) / 10) * 10;
  return Math.min(Math.max(DAY_START, m), 23 * 60 + 50);
}
// 흔한 체인점(프랜차이즈) 이름 — 이름에 들어 있으면 추천에서 제외 (이재훈 결정: 브랜드 이름 목록 방식)
const CHAIN_BRANDS = ['스타벅스', '투썸플레이스', '이디야', '메가커피', '메가MGC', '컴포즈커피', '빽다방', '할리스',
  '엔제리너스', '커피빈', '폴바셋', '파스쿠찌', '탐앤탐스', '카페베네', '공차', '설빙', '배스킨', '던킨',
  '파리바게뜨', '뚜레쥬르', '맥도날드', '버거킹', '롯데리아', '맘스터치', 'KFC', '서브웨이', '도미노피자',
  '피자헛', '교촌', 'BHC', 'bhc', 'BBQ', '본죽', '김밥천국', '홍콩반점', '새마을식당', '한신포차',
  '아웃백', '빕스', '애슐리'];

// 배·비행기를 타야만 갈 수 있는 지역: 육지 이동 시간·비용 계산이 맞지 않아 추천에서 제외 (이재훈 결정, 데이터는 그대로 둠)
//   신안·완도·진도·거제·남해 등은 다리로 이어져 있어 포함
const SEA_REGIONS = ['제주', '서귀포', '울릉'];

// ---------- 1. 작은 계산 도구 ----------

// 두 지점 사이 직선거리(km) — 지구를 구로 보는 하버사인 공식
function distanceKm(a, b) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// 이동 시간(분). intercity=true면 출발지↔여행지 구간 (가까우면 여행지 안 속도가 더 빠를 수 있어 작은 쪽)
// 대중교통 여행의 여행지 안 구간: 걷기 또는 버스·지하철 (이재훈 결정 2026-10-09)
//   사용자가 고른 값(stop.legMode)이 있으면 그것, 없으면 400m 미만은 걷기, 그 이상은 대중교통
//   (대중교통 경로가 없는 구간은 화면에서 길찾기 결과를 받은 뒤 stop.autoWalk = true로 걷기 처리)
const WALK_KM = 0.4;
const WALK_KMH = 4;   // 계획서의 도보 평균 속도
function localMode(km, transport, intercity, stop) {
  if (transport !== '대중교통' || intercity) return null;
  if (stop && stop.legMode) return stop.legMode;
  if (stop && stop.autoWalk) return 'walk';
  return km < WALK_KM ? 'walk' : 'transit';
}

// 카카오 대중교통 경로에서 받아 온 실제 구간 정보 (이재훈 결정 2026-10-09: 대중교통 시간은 카카오가 알려 주는 대로)
//   키: '출발위도,경도>도착위도,경도' → { time(초), fare(원, 1인), noTransit }
//   js/road-route.js가 길찾기 결과를 받을 때 채우고, computeTimeline이 평균 속도 대신 이 값을 씀 (아직 없으면 평균 속도로 추정)
const transitLegs = {};
function legKey(a, b) { return a.lat.toFixed(5) + ',' + a.lng.toFixed(5) + '>' + b.lat.toFixed(5) + ',' + b.lng.toFixed(5); }

function travelMin(km, transport, intercity, mode) {
  if ((mode || localMode(km, transport, intercity)) === 'walk') return Math.round(km / WALK_KMH * 60);
  const local = km / LOCAL_KMH[transport] * 60;
  if (!intercity) return Math.round(local);
  const c = INTERCITY[transport];
  return Math.round(Math.min(local, c.baseMin + km * c.road / c.kmh * 60));
}

// 한 구간 교통비(원)
function legCost(km, transport, intercity, payers, mode) {
  if (transport === '자동차') return Math.round(km * (intercity ? INTERCITY.자동차.road : 1) * CAR_WON_PER_KM);
  if (intercity) return Math.round(km * 1.25 * TRANSIT_WON_PER_KM) * payers;
  return (mode || localMode(km, transport, intercity)) === 'walk' ? 0 : LOCAL_FARE * payers;
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

// ---------- 함께 정하기 (7차시, 2026-10-10) ----------
// trip.group: [{ name, tags }] — 만든 사람 + 친구들 (loadTripFromUrl이 together 여행일 때 채움). 2명 미만이면 혼자 여행과 똑같이 계산
// 여행지 만족도 = 이 지역의 그 사람 취향 점수 ÷ 그 사람에게 가장 잘 맞는 지역의 점수 → 0~1 (1 = 나한테 최고인 곳)
//   (처음엔 '÷ 만점'으로 했으나 지역 점수가 명소 평균이라 1~2점대여서 모두 14~38%가 나옴 → 2026-10-10 이재훈 결정으로 변경)
// 장소 만족도 = 그 사람이 고른 태그 점수 ÷ 만점(모든 태그 5점일 때)
// 여행지: 평균 만족도, 단 누군가 40% 미만이면 × (최저 만족도 ÷ 0.4) (이재훈 결정: 평균 + 최소 보장, 기준 40%)
// 장소: 평균 만족도만 (최소 보장은 '매일 각자의 1순위 취향 장소 1곳씩'으로 대신 — buildPlan)
// 점수 크기는 만든 사람의 만점에 맞춰 곱함 → 혼자 여행의 점수와 같은 범위
const GROUP_MIN_SAT = 0.4;
const GROUP_TAG_MIN = 4;   // 장소의 그 태그 점수가 4점 이상이면 '그 취향 장소'로 봄 (Claude 판단)

function tagMax(userTags) { return userTags.length ? 5 * (userTags.length + 0.5) : 1; }
function isGroup(trip) { return !!(trip.group && trip.group.length >= 2); }

function satisfactions(tags, trip, best) {
  return trip.group.map(function (m, i) { return tagScore(tags, m.tags) / (best ? (best[i] || 1) : tagMax(m.tags)); });
}

// 여행지용 — 입력: 지역 태그 평균, trip, best(사람별 최고 지역 점수) / 출력: { score, sats(사람별 만족도 배열 또는 null) }
function regionTagScore(tags, trip, best) {
  if (!isGroup(trip)) return { score: tagScore(tags, trip.tags), sats: null };
  const sats = satisfactions(tags, trip, best);
  const avg = sats.reduce(function (a, b) { return a + b; }, 0) / sats.length;
  const low = Math.min.apply(null, sats);
  const guard = low < GROUP_MIN_SAT ? low / GROUP_MIN_SAT : 1;
  return { score: avg * guard * tagMax(trip.tags), sats: sats };
}

// 장소용 — 출력: 점수 하나
function placeTagScore(tags, trip) {
  if (!isGroup(trip)) return tagScore(tags, trip.tags);
  const sats = satisfactions(tags, trip);
  return sats.reduce(function (a, b) { return a + b; }, 0) / sats.length * tagMax(trip.tags);
}

// 각자의 1순위 태그 (겹치면 하나로) — 출력: [{ tag, names: [...] }]
function groupFirstTags(trip) {
  if (!isGroup(trip)) return [];
  const out = [];
  trip.group.forEach(function (m) {
    if (!m.tags.length) return;
    const t = m.tags[0];
    let e = out.find(function (x) { return x.tag === t; });
    if (!e) { e = { tag: t, names: [] }; out.push(e); }
    e.names.push(m.name);
  });
  return out;
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
  function eligible(r) {
    if (SEA_REGIONS.indexOf(r.region) !== -1) return false;     // 배·비행기로 가야 하는 섬 제외
    if (trip.days > 1 && (r.counts['숙소'] || 0) === 0) return false;   // 숙소 없는 지역은 당일치기만 (이재훈 결정)
    return (r.counts['명소'] || 0) >= tempo.count;
  }
  // 함께 정하기: 사람마다 갈 수 있는 지역 중 취향 점수 최고값 (만족도의 기준)
  const best = isGroup(trip) ? trip.group.map(function (m) {
    return regions.reduce(function (mx, r) { return eligible(r) ? Math.max(mx, tagScore(r.tagAvg, m.tags)) : mx; }, 0);
  }) : null;

  regions.forEach(function (r) {
    if (!eligible(r)) return;
    const distKm = distanceKm(dep, r);
    const oneWayMin = travelMin(distKm, trip.transport, true);
    const ratio = 2 * oneWayMin / totalActive;
    const taste = regionTagScore(r.tagAvg, trip, best);          // 함께 정하기면 평균 + 최소 보장
    const base = withPopularity(taste.score, r.popTop10);
    const jitter = regionJitter(trip.id, round || 0, r.region);
    // 예산: 이 지역에 가면 최소 얼마 드는지 추정해, 최대 예산을 넘으면 (예산 ÷ 최소 비용)² 만큼 깎음 (Claude 설계)
    //   → 예산이 빠듯하면 가깝고 싼 지역이 위로 올라옴. 예산 안이면 깎지 않음
    const estCost = estimateMinCost(trip, r, distKm);
    const budgetFactor = estCost > trip.budget_max ? Math.pow(trip.budget_max / estCost, 2) : 1;
    const score = base * (1 - ratio) * budgetFactor * jitter;
    if (score <= 0) return;
    out.push({ region: r.region, score: score, jitter: jitter, oneWayMin: oneWayMin, distKm: distKm, info: r,
               estCost: estCost, budgetFactor: budgetFactor, sats: taste.sats });
  });
  return out.sort(function (a, b) { return b.score - a.score; });
}

// ---------- 숙박비: 객실·날짜별 요금 (2026-10-10 이재훈 요청) ----------
// p.rooms (tools/merge_rooms.py가 TourAPI 객실 정보·웹 검색으로 채움):
//   [{ name, base(기준 인원), max(최대 인원), off: [주중, 주말], peak: [주중, 주말], src }]  요금은 방 1개 1박(원), 0 = 모름
// 객실 정보가 없는 숙소는 지금처럼 p.cost(종류별 추정값)를 씀
// 주말 = 그날 밤이 금·토요일, 성수기 = 7/15~8/20·12/24~12/31 (이재훈 결정)
function nightInfo(trip, n) {   // n = 0부터, n번째 밤
  const d = new Date(trip.start_date + 'T00:00:00');
  d.setDate(d.getDate() + n);
  const md = (d.getMonth() + 1) * 100 + d.getDate();
  return { weekend: d.getDay() === 5 || d.getDay() === 6,
           peak: (md >= 715 && md <= 820) || md >= 1224 };
}

// 방 하나에 자야 하는 인원 = 유아를 뺀 인원 ÷ 방 수 (올림) — 유아는 보통 추가 요금 없이 함께 잠 (Claude 판단)
function perRoomPeople(trip) {
  return Math.ceil(Math.max(1, trip.people - (trip.infants || 0)) / (trip.rooms || 1));
}

// 객실 하나의 그날 밤 요금: 정확한 칸이 비어 있으면 가까운 칸으로 대신 (비수기 같은 요일 → 성수기 같은 요일 → 비수기 주중)
function roomFee(r, night) {
  const k = night.weekend ? 1 : 0;
  const order = night.peak ? [r.peak && r.peak[k], r.off && r.off[k], r.peak && r.peak[1 - k], r.off && r.off[1 - k]]
                           : [r.off && r.off[k], r.off && r.off[1 - k], r.peak && r.peak[k], r.peak && r.peak[1 - k]];
  for (const v of order) if (v > 0) return v;
  return 0;
}

// 이 여행에 쓸 객실: 최대 인원이 방 하나 인원 이상인 객실 중 여행 전체 요금이 가장 싼 것
//   맞는 객실이 없으면 가장 큰 객실 (출력: 객실 또는 null)
function roomFor(p, trip) {
  if (!p || !p.rooms || !p.rooms.length) return null;
  const key = trip.start_date + '|' + trip.days + '|' + perRoomPeople(trip);
  if (p._roomKey === key) return p._room;
  const need = perRoomPeople(trip), nights = Math.max(1, trip.days - 1);
  const priced = p.rooms.filter(function (r) { return roomFee(r, { weekend: false, peak: false }) > 0; });
  let best = null, bestCost = Infinity;
  priced.forEach(function (r) {
    if ((r.max || r.base || 2) < need) return;
    let c = 0;
    for (let n = 0; n < nights; n++) c += roomFee(r, nightInfo(trip, n));
    if (isPerBed(r)) c *= need;   // 침대당 요금
    if (c < bestCost) { bestCost = c; best = r; }
  });
  if (!best && priced.length) best = priced.slice().sort(function (a, b) { return (b.max || 0) - (a.max || 0); })[0];
  p._roomKey = key; p._room = best;
  return best;
}

// 도미토리·다인실은 요금이 '침대 1개(1명)' 기준 → 방 하나 인원만큼 곱함 (시험 중 부산 도미토리 8인 21,000원이 방값으로 잡혀 발견)
function isPerBed(r) { return /도미토리|dorm|다인실/i.test(r.name || ''); }

// n번째 밤 숙박비 (방 수 포함)
function lodgingNightCost(p, trip, n) {
  if (!p) return 0;
  const r = roomFor(p, trip);
  const one = r ? roomFee(r, nightInfo(trip, n)) * (isPerBed(r) ? perRoomPeople(trip) : 1) : (p.cost || 0);
  return one * (trip.rooms || 1);
}

// 여행 전체 숙박비
function lodgingTripCost(p, trip) {
  let c = 0;
  for (let n = 0; n < trip.days - 1; n++) c += lodgingNightCost(p, trip, n);
  return c;
}

// 방 1개 1박 평균 (예산 상한과 비교·정렬용)
function lodgingAvgRoomNight(p, trip) {
  const nights = Math.max(1, trip.days - 1);
  if (trip.days - 1 <= 0) return p.cost || 0;
  return lodgingTripCost(p, trip) / (nights * (trip.rooms || 1));
}

// 화면 표시용: '디럭스 더블(최대 2명) · 1박 평균 120,000원'
function lodgingLabel(p, trip) {
  const r = roomFor(p, trip);
  const avg = lodgingAvgRoomNight(p, trip);
  return (r ? r.name + (isPerBed(r) ? '(침대 ' + perRoomPeople(trip) + '개)' : r.max ? '(최대 ' + r.max + '명)' : '') + ' · ' : '') + '1박 ' +
         (trip.days > 2 ? '평균 ' : '') + Math.round(avg).toLocaleString('ko-KR') + '원' +
         (r ? (r.src === 'search' ? ' (검색 추정)' : '') : (p.costCheck === '추정' ? ' (추정)' : ''));
}

// ---------- 3. 예산 상한과 후보 거르기 ----------

// 일정안 총비용이 최대 예산을 넘어도 되는 한도: 최대 20%까지만 (2026-10-10 이재훈 결정)
//   이보다 비싼 일정안·여행지는 보여 주지 않고, 하나도 없으면 '없다'고 안내
const BUDGET_OVER_LIMIT = 1.2;
function withinBudgetLimit(trip, total) { return total <= trip.budget_max * BUDGET_OVER_LIMIT; }

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

// ---------- 후기·영업시간 조사 정보 (p.info — tools/review_record.py, 2026-10-09 이재훈 요청 1~8번) ----------
// p.info: { q: 품질 등급 A~D, solo, minPeople, group, waitMin, issues, parking, kids, pet, closed: ['월'..], open, close, break }
const DOW = ['일', '월', '화', '수', '목', '금', '토'];
// 쉬는 시간은 '15:00-17:00' 글자가 기본이지만 일부 장소는 ['15:00', '17:00'] 배열로 저장돼 있어 둘 다 받음
function breakRange(b) { return Array.isArray(b) ? b : String(b).split('-'); }
function hm(t) { const a = String(t).split(':'); return Number(a[0]) * 60 + Number(a[1] || 0); }
// 여행 d일차(1부터)의 요일 이름
function dowOf(trip, d) { const x = new Date(trip.start_date + 'T00:00:00'); x.setDate(x.getDate() + d - 1); return DOW[x.getDay()]; }
// 그 요일·시각(분)에 문을 여는지: 휴무 요일·영업시간·브레이크타임을 봄. 정보가 없으면 연다고 봄
function openAt(p, dow, minute) {
  const i = p.info;
  if (!i) return true;
  if (i.closed && i.closed.indexOf(dow) !== -1) return false;
  if (minute == null) return true;
  if (i.open && i.close) {
    const o = hm(i.open), c = hm(i.close) <= o ? hm(i.close) + 24 * 60 : hm(i.close);
    if (minute < o || minute >= c) return false;
  }
  if (i.break) {
    const b = breakRange(i.break);
    if (minute >= hm(b[0]) && minute < hm(b[1])) return false;
  }
  return true;
}
// 영업시간 문제를 글로: 일정 시각(begin~end)에 문을 닫았으면 이유, 괜찮으면 ''
function hoursIssue(p, dow, begin, end) {
  const i = p.info;
  if (!i) return '';
  if (i.closed && i.closed.indexOf(dow) !== -1) return dow + '요일 휴무';
  if (!openAt(p, dow, begin)) return '영업시간 아님 (' + (i.open || '?') + '~' + (i.close || '?') + (i.break ? ', 쉬는 시간 ' + breakRange(i.break).join('-') : '') + ')';
  if (end != null && i.close && end > hm(i.close) && hm(i.close) > hm(i.open || '00:00')) return i.close + ' 영업 종료 전에 나와야 해요';
  return '';
}
// 주차 정보 하나로 맞추기: 조사 때 true/false 또는 '넓음'·'협소'·'골목 주차' 같은 글로 적혀 있음
// 입력: p.info / 출력: true(주차 가능) · false(주차 어려움) · null(정보 없음)
function parkingOf(i) {
  const v = i && i.parking;
  if (v === true || v === false) return v;
  if (typeof v !== 'string' || !v) return null;
  return /없음|협소|골목|어려|불편|도로변/.test(v) ? false : true;
}

// 조사 메모(issues) 한 줄을 세 종류로 나눔 — '오션뷰'·'조식 제공'처럼 좋은 점도 섞여 있어서 (분류 기준은 Claude 판단)
// 입력: 글 한 줄 / 출력: 'unverified'(후기 부족) · 'caution'(주의할 점) · 'note'(참고·장점)
const UNVERIFIED_RE = /후기.{0,5}(없음|적음|부실)/;
const INFO_GAP_RE = /정보 없음|영업시간 확인 필요|표기\(확인 필요\)|확인 필요\)$/;
const PLUS_RE = /저렴|가성비 (좋|평 좋)|호평|넉넉|넓음|무료|가능|제공|오션뷰|바다 전망|전망|친절 평|인기/;
const CAUTION_RE = /불만|불친절|노후|비쌈|비싼|가격|위생|청결|혼잡|대기|줄 서|소음|방음|엇갈|실망|늦게|좁|어려|불편|부족|적다|적음|짜다|간 센|비린|냄새|외풍|무뚝뚝|지적|없음|주의|멂|외진|조기 마감|소진|휴무|만 영업|분부터|필요|추움|파손|벌레|곰팡이|낡|작다|달다|오래된|거부|환불|맵|매운맛|강풍|협소|불가|호객|품절|추가 요금|화장실 외부|공용 화장실|다는 후기/;
function issueKind(text) {
  if (UNVERIFIED_RE.test(text)) return 'unverified';
  if (INFO_GAP_RE.test(text)) return 'note';
  if (PLUS_RE.test(text) && !/불만|엇갈|비싼|비쌈/.test(text)) return 'note';
  if (CAUTION_RE.test(text)) return 'caution';
  return 'note';
}

// 후기 조사 결과를 점수 배수로 (이재훈 요청: 인기 말고 다른 요소도 판단에 넣기 — 배수 값은 Claude 판단)
// 입력: 장소 p, 여행 조건 trip / 출력: 취향 점수에 곱할 수 (1이면 그대로)
const QUALITY_MULT = { A: 1.15, B: 1.05, C: 0.95, D: 0.85 };
function infoMultiplier(p, trip) {
  const i = p.info;
  if (!i) return 1;
  let m = QUALITY_MULT[i.q] || 1;
  const park = parkingOf(i);
  if (trip.transport === '자동차' && park === true) m *= 1.05;
  if (trip.transport === '자동차' && park === false) m *= 0.9;
  if ((trip.infants || trip.children) && i.kids === true) m *= 1.05;
  if ((trip.infants || trip.children) && i.kids === false) m *= 0.85;
  if (trip.pet && i.pet === true) m *= 1.2;                     // 반려동물 동반 (2026-10-10 이재훈 결정으로 조건 추가)
  if (trip.pet && i.pet === false) m *= 0.7;
  if (trip.people >= 6 && i.group === true) m *= 1.05;          // 6명 이상이면 단체석 있는 곳
  if (trip.tempo === '알차게' && i.waitMin >= 40) m *= 0.9;      // 줄이 긴 곳은 바쁜 일정에서 덜 추천
  const kinds = (i.issues || []).map(issueKind);
  if (kinds.indexOf('unverified') !== -1) m *= 0.95;            // 후기가 없거나 적은 곳은 조금 낮춤 (이재훈 결정)
  const cautions = kinds.filter(function (k) { return k === 'caution'; }).length;
  m *= Math.max(0.88, Math.pow(0.97, cautions));                // 주의할 점 1개당 3%, 최대 12%까지만
  return m;
}

// 검색 결과 상호·주소가 달랐던 곳 (폐업·이전 가능성) — 추천에서 제외 (2026-10-10 이재훈 결정)
function needsAddressCheck(p) {
  return !!(p.info && p.info.issues && p.info.issues.some(function (x) { return x.indexOf('주소 확인 필요') !== -1; }));
}

// ---------- 계절 (2026-10-10 이재훈 요청: 계절을 활동 추천에 반영 — 배수 값은 Claude 판단) ----------
// 입력: 장소 p, 여행 시작 월(1~12) / 출력: 점수에 곱할 수 (1이면 그대로, 0.05면 사실상 제외)
function tripMonth(trip) { return Number(String(trip.start_date || '').slice(5, 7)) || (new Date().getMonth() + 1); }
function seasonMultiplier(p, month) {
  if (p.type !== '명소') return 1;
  const c = p.category || '';
  const summer = month >= 6 && month <= 8, hot = month === 7 || month === 8;
  const winter = month === 12 || month <= 2;
  const spring = month === 4 || month === 5, autumn = month === 10 || month === 11;
  // 물놀이: 여름에만
  if (c === 'NA020900') return hot ? 1.15 : (month === 6 || month === 9 ? 0.9 : 0.6);                 // 해변·해수욕장 (경치 구경은 사계절 가능)
  if (['LS020100', 'LS020200', 'LS020400', 'LS020800', 'LS021300'].indexOf(c) !== -1) return summer ? 1.15 : (month === 5 || month === 9 ? 0.6 : 0.15);  // 제트스키·카약·스노클링·래프팅·패러세일
  if (c === 'VE020200') return summer ? 1.2 : 0.6;                                                    // 워터파크 (실내 워터파크도 있어 완전히 빼지 않음)
  if (c === 'NA010400') return summer ? 1.2 : (autumn ? 1.0 : (winter ? 0.6 : 0.9));                   // 계곡
  // 겨울 레저: 겨울에만
  if (c === 'LS010800') return winter ? 1.2 : (month === 11 || month === 3 ? 0.4 : 0.05);              // 스키·스노보드
  if (c === 'LS011000') return winter ? 1.15 : 0.3;                                                   // 썰매장
  if (c === 'LS010900') return winter ? 1.1 : 0.9;                                                    // 스케이트
  if (c === 'EX050100' || c === 'EX050200') return winter ? 1.15 : (hot ? 0.85 : 1);                   // 온천·찜질방
  // 꽃·단풍: 봄·가을
  if (c === 'NA040700') return spring || month === 10 ? 1.15 : (winter ? 0.8 : 1);                     // 수목원·정원
  if (['NA010100', 'NA010200', 'NA040600', 'NA040100', 'NA040200', 'NA040300'].indexOf(c) !== -1)      // 산·숲·휴양림·국립/도립/군립공원
    return autumn ? 1.15 : (spring ? 1.05 : (hot ? 0.95 : (winter ? 0.85 : 1)));
  // 그 밖: 한여름·한겨울엔 실내를 조금 더, 야외를 조금 덜
  if (hot) return p.indoor ? 1.05 : 0.95;
  if (winter) return p.indoor ? 1.08 : 0.9;
  return 1;
}

// ---------- 같은 종류 반복 줄이기 (2026-10-10 이재훈 요청: 해수욕장 4곳·같은 메뉴 반복 방지) ----------
// 명소 종류 = 관광 분류 코드(예: NA020900 해변). 같은 종류를 이미 고른 횟수 c에 따라 점수를 나눔: 1/(1+3c) → 2번째 ¼, 3번째 1/7
// 큰 분류(앞 4자리, 예: NA02 하천·해양)도 겹치면 조금 깎음: 1/(1+0.5c). 다른 종류 후보가 모자랄 때만 같은 종류가 다시 뽑힘 (배수는 Claude 판단)
function attractionKind(p) { return p.category || ('name:' + p.name); }
function attractionGroup(p) { return p.category ? p.category.slice(0, 4) : null; }
function varietyFactor(kindCount, groupCount, p) {
  const k = kindCount[attractionKind(p)] || 0, g = attractionGroup(p) ? (groupCount[attractionGroup(p)] || 0) : 0;
  return 1 / (1 + 3 * k) / (1 + 0.5 * Math.max(0, g - k));
}
// 대표 메뉴 이름 (식당 이름에서 찾음) — 같은 메뉴(순두부·막국수·물회 …)는 두 번째부터 크게 깎음
const DISH_WORDS = [['순두부', '순두부'], ['막국수', '막국수'], ['물회', '물회'], ['짬뽕', '짬뽕'], ['간장게장', '게장'], ['게장', '게장'], ['게국지', '게국지'],
  ['해장국', '해장국'], ['감자탕', '감자탕'], ['뼈해장', '해장국'], ['국밥', '국밥'], ['칼국수', '칼국수'], ['칼제비', '칼국수'], ['수제비', '수제비'], ['냉면', '냉면'], ['면옥', '냉면'], ['밀면', '밀면'],
  ['옹심이', '옹심이'], ['떡갈비', '떡갈비'], ['돼지갈비', '갈비'], ['갈비', '갈비'], ['삼겹', '삼겹살'], ['한우', '한우'], ['정육', '한우'], ['닭갈비', '닭갈비'], ['곱창', '곱창'], ['막창', '곱창'],
  ['오리', '오리'], ['장어', '장어'], ['아구', '아귀'], ['아귀', '아귀'], ['대게', '대게'], ['홍게', '대게'], ['꼬막', '꼬막'], ['조개구이', '조개구이'], ['전복', '전복'], ['굴', '굴'],
  ['횟집', '회'], ['회센터', '회'], ['수산', '회'], ['초밥', '초밥'], ['스시', '초밥'], ['돈가스', '돈가스'], ['돈까스', '돈가스'], ['곰탕', '곰탕'], ['설렁탕', '설렁탕'], ['추어탕', '추어탕'],
  ['삼계탕', '삼계탕'], ['백숙', '백숙'], ['쌈밥', '쌈밥'], ['비빔밥', '비빔밥'], ['보리밥', '보리밥'], ['한정식', '한정식'], ['백반', '백반'], ['순대', '순대'], ['족발', '족발'], ['보쌈', '보쌈'],
  ['짜장', '짜장'], ['반점', '중식'], ['피자', '피자'], ['버거', '버거'], ['파스타', '파스타'], ['만두', '만두'], ['국수', '국수'], ['생선구이', '생선구이'], ['두부', '두부'], ['치킨', '치킨'], ['찜닭', '찜닭']];
function dishOf(r) {
  const n = r.name || '';
  for (const [w, d] of DISH_WORDS) if (n.indexOf(w) !== -1) return d;
  return null;
}
// 이름에 든 메뉴 전부 (예: '동해막국수&순두부칼국수' → 순두부·막국수·칼국수)
function dishesOf(r) {
  const n = r.name || '', out = [];
  for (const [w, d] of DISH_WORDS) if (n.indexOf(w) !== -1 && out.indexOf(d) === -1) out.push(d);
  return out;
}

// 지역 대표 먹거리·할거리 (data/signature.json — 지역마다 웹 검색으로 조사, 2026-10-10 Claude)
// 이재훈 결정: 일정안마다 대표 먹거리 1곳 + 대표 할거리 1곳은 꼭 넣음
// 찾는 방법: ① 장소 이름에 키워드가 들어 있거나 ② 그 메뉴를 판다고 웹 검색으로 확인한 식당 목록(restaurants)에 있음
//   (장소 데이터에 메뉴 정보가 없어서 — 2026-10-10 지역별 식당 조사 추가)
// 입력: 장소, 그 지역 대표 목록 { foods, spots } / 출력: 대표 항목 이름(예: '게국지') 또는 null
function signatureOf(p, sig) {
  if (!sig || !p || !p.name) return null;
  const list = p.type === '식당' ? sig.foods : p.type === '명소' ? sig.spots : null;
  if (!list) return null;
  for (const it of list) {
    if (it.restaurants && it.restaurants.indexOf(p.name) !== -1) return it.name;   // 그 메뉴를 판다고 검색으로 확인한 식당 (이름에 메뉴가 없어도)
    for (const k of (it.keywords || [])) if (k && p.name.indexOf(k) !== -1) return it.name;
  }
  return null;
}
// 화면 표시용 글자: '대표 먹거리 · 게국지' (대표가 아니면 '')
function signatureLabel(p, sig) {
  const n = signatureOf(p, sig);
  return n ? (p.type === '식당' ? '대표 먹거리' : '대표 할거리') + ' · ' + n : '';
}
const SIG_FOOD_KM = 12;   // 대표 먹거리 식당이 지금 위치에서 이 거리 안이면 그 끼니에 넣음 (Claude 판단)

// 여행에 넣을 수 있는 장소인지 (예산과 상관없는 조건)
function usable(p, trip) {
  if (!p.recommend || isChain(p.name)) return false;
  if (needsAddressCheck(p)) return false;
  if (p.info && p.info.minPeople && trip.people < p.info.minPeople) return false;   // 2인분부터인 곳은 1명 여행에서 제외
  if (p.info && p.info.solo === false && trip.people === 1) return false;
  if (p.audience === '10대' && !trip.teens) return false;    // 청소년 전용 공간은 청소년이 있을 때만
  if (p.type === '명소' && !(p.stayMin > 0)) return false;   // 체류 시간 0 = 야영장 등 숙박 시설
  if (p.type === '숙소' && !(p.cost > 0) && !roomFor(p, trip)) return false;   // 가격 모르는 숙소 제외 (객실 요금이 있으면 사용)
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
  const month = tripMonth(trip);
  base.forEach(function (p) { p._s = withPopularity(placeTagScore(p.tags, trip), p.popularity) * infoMultiplier(p, trip) * seasonMultiplier(p, month); });

  for (let step = 0; step <= 20; step++) {
    const relax = 1 + step * 0.1;
    const pool = { attractions: [], restaurants: [], lodgings: [], relax: relax };
    base.forEach(function (p) {
      if (p.type === '명소' && p.cost <= caps.admission * relax) pool.attractions.push(p);
      else if (p.type === '식당' && foodKind(p) === 'meal' && p.cost <= caps.meal * relax) pool.restaurants.push(p);   // 디저트·주점은 식사로 안 넣음
      else if (p.type === '숙소' && lodgingAvgRoomNight(p, trip) <= caps.lodging * relax) pool.lodgings.push(p);   // 객실·날짜별 요금 평균
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
function pickLodging(type, pool, center, trip) {
  if (pool.lodgings.length === 0) return null;
  const list = pool.lodgings.slice();
  const price = function (p) { return lodgingAvgRoomNight(p, trip); };
  if (type === 'A') list.sort(function (a, b) { return (b._s - a._s) || (price(a) - price(b)); });
  if (type === 'B') list.sort(function (a, b) { return distanceKm(center, a) - distanceKm(center, b); });
  if (type === 'C') list.sort(function (a, b) { return (price(a) - price(b)) || (b._s - a._s); });
  return list[0];
}

// 일정안별 명소 우선순위 점수
function attractionKey(type, anchor) {
  if (type === 'A') return function (p) { return p._s; };
  if (type === 'B') return function (p) { return p._s / (1 + distanceKm(anchor, p) / 2); };
  return function (p) { return p._s / (1 + p.cost / 10000); };
}

// 지금 위치 근처 식당 고르기 (가까울수록 유리, 일정안 성격 반영)
// 같은 메뉴 종류를 이미 먹었으면 점수를 나눠 깎고(1회 → ¼, 2회 → 1/7), 바로 전 끼니와 같은 종류면 크게 깎음(×0.2)
// 같은 대표 메뉴(dishOf: 순두부·물회 …)는 ×0.1 (2026-10-10 강화)
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
    val /= 1 + (g === '한식(기타)' ? 1 : 3) * (eaten[g] || 0);   // 같은 메뉴 종류: 2번째부터 ¼ (넓은 '한식(기타)'만 ½)
    if (g === lastGroup) val *= 0.2;
    if (dishesOf(r).some(function (x) { return eaten['dish:' + x]; })) val *= 0.1;            // 같은 대표 메뉴(순두부·막국수 …)를 또 먹는 건 마지막 수단
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
  const lodging = trip.days > 1 ? pickLodging(type, pool, topCenter, trip) : null;
  const anchor = lodging || topCenter;
  const keyOf = attractionKey(type, anchor);
  const keyVal = new Map();
  pool.attractions.forEach(function (p) { keyVal.set(p.id, keyOf(p)); });
  const ranked = pool.attractions.slice().sort(function (a, b) { return keyVal.get(b.id) - keyVal.get(a.id); });
  const kindCount = {}, groupCount = {}, taken = new Set();   // 명소 종류별로 고른 횟수, 이미 후보로 꺼낸 곳
  // 대표 할거리: 일정안 점수 순으로 가장 앞선 곳을 맨 먼저 꺼냄 (제철이 아닌 곳 — 계절 배수 0.5 미만 — 은 제외)
  const sig = pool.signature || null;
  const month = tripMonth(trip);
  const sigSpots = sig ? ranked.filter(function (p) { return signatureOf(p, sig) && seasonMultiplier(p, month) >= 0.5; }) : [];
  // 대표 먹거리 식당: 예산 상한 안 → 없으면 상한을 넘는 곳까지
  let sigFoods = sig ? pool.restaurants.filter(function (r) { return signatureOf(r, sig); }) : [];
  if (sig && !sigFoods.length) sigFoods = pool.all.restaurants.filter(function (r) { return signatureOf(r, sig); });
  // 대표 먹거리가 여러 개면 signature.json에 적힌 순서(앞일수록 더 대표)대로: 첫 메뉴를 파는 식당이 있으면 그 메뉴만 후보로
  //   (예전: 메뉴 구분 없이 가까운 식당 → 대구에서 막창 대신 납작만두가 뽑힘, 2026-10-10 이재훈 지적)
  if (sigFoods.length) {
    const rankOf = function (r) { const n = signatureOf(r, sig); return sig.foods.findIndex(function (f) { return f.name === n; }); };
    const top = Math.min.apply(null, sigFoods.map(rankOf));
    sigFoods = sigFoods.filter(function (r) { return rankOf(r) === top; });
  }
  let sigSpotTaken = !sigSpots.length, sigFoodDone = !sigFoods.length;
  let curDay = 1;
  // 다음에 넣을 명소: 일정안 점수 × 종류 반복 감점(varietyFactor)이 가장 큰 곳
  // ranked가 점수 높은 순이라, 남은 곳의 점수가 지금 최고값보다 낮아지면 더 볼 필요 없음
  // 함께 정하기: 그 태그 점수가 GROUP_TAG_MIN 이상인 곳 중 일정안 점수가 가장 높은 곳 (오늘 문 연 곳만)
  const firstTags = groupFirstTags(trip);
  function takeForTag(tag, dow) {
    let best = null, bestVal = -Infinity;
    ranked.forEach(function (p) {
      if (used.has(p.id) || taken.has(p.id) || !openAt(p, dow)) return;
      if (((p.tags || {})[tag] || 0) < GROUP_TAG_MIN) return;
      const v = keyVal.get(p.id) * varietyFactor(kindCount, groupCount, p);
      if (v > bestVal) { bestVal = v; best = p; }
    });
    if (best) {
      taken.add(best.id);
      kindCount[attractionKind(best)] = (kindCount[attractionKind(best)] || 0) + 1;
      if (attractionGroup(best)) groupCount[attractionGroup(best)] = (groupCount[attractionGroup(best)] || 0) + 1;
    }
    return best;
  }
  function takeNextAttraction() {
    let best = null, bestVal = -Infinity;
    if (!sigSpotTaken) {
      sigSpotTaken = true;
      best = sigSpots.find(function (p) { return !used.has(p.id) && !taken.has(p.id); }) || null;
      if (best) bestVal = Infinity;
    }
    for (let i = 0; i < ranked.length && bestVal !== Infinity; i++) {
      const p = ranked[i], k = keyVal.get(p.id);
      if (k <= bestVal) break;
      if (used.has(p.id) || taken.has(p.id)) continue;
      const v = k * varietyFactor(kindCount, groupCount, p);
      if (v > bestVal) { bestVal = v; best = p; }
    }
    if (best) {
      taken.add(best.id);
      kindCount[attractionKind(best)] = (kindCount[attractionKind(best)] || 0) + 1;
      if (attractionGroup(best)) groupCount[attractionGroup(best)] = (groupCount[attractionGroup(best)] || 0) + 1;
    }
    return best;
  }
  const used = new Set();
  let carry = [], deferred = [];
  let today = null;   // 지금 만드는 날의 요일 (식당 영업시간 확인용)
  const days = [];
  let mealMove = 0;
  const eaten = {};        // 메뉴 종류별 먹은 횟수 (여행 전체)
  let lastGroup = null;    // 바로 전 끼니의 메뉴 종류

  for (let d = 1; d <= trip.days; d++) {
    const lastDay = d === trip.days;
    curDay = d;
    // 오늘 갈 후보: 어제 못 간 곳(이월) + 순위표에서 다음 곳들
    const dow = dowOf(trip, d);
    const picks = [];
    const later = [];   // 오늘 휴무라 다른 날로 미룬 곳
    carry.concat(deferred).forEach(function (p) { if (openAt(p, dow)) picks.push(p); else later.push(p); });
    deferred = later;
    // 함께 정하기: 매일 각자의 1순위 취향 장소를 1곳씩 먼저 넣음 (이재훈 결정)
    //   이미 오늘 후보에 그 취향 장소가 있으면 건너뜀. 하루 방문 수보다 1순위 취향 종류가 많으면 날마다 순서를 돌려 고루 넣음
    if (firstTags.length) {
      const need = firstTags.filter(function (f) {
        return !picks.some(function (p) { return ((p.tags || {})[f.tag] || 0) >= GROUP_TAG_MIN; });
      });
      for (let k = 0; k < need.length && picks.length < tempo.count; k++) {
        const f = need[(k + d - 1) % need.length];
        const p = takeForTag(f.tag, dow);
        if (p) picks.push(p);
      }
    }
    while (picks.length < tempo.count) {
      const p = takeNextAttraction();
      if (!p) break;
      if (openAt(p, dow)) picks.push(p); else deferred.push(p);
    }
    today = dow;
    let pos = d === 1 ? dep : lodging;
    const ordered = nearestNeighbor(d === 1 ? anchor : pos, picks);
    const stops = [];
    const dayStart = d === 1 ? firstDayStart(trip) : DAY_START;   // 오늘 출발이면 지금 시각 이후부터
    let clock = dayStart, active = 0, visited = 0;
    let lunch = dayStart > LUNCH.until, dinner = dayStart >= DAY_END - 60;   // 늦게 시작하면 이미 지난 끼니는 건너뜀
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
      // 밤 10시를 넘기는 곳도 다음 날로 (늦게 출발한 첫날은 0곳일 수 있음 — 2026-10-10 이재훈 결정)
      if (clock + move + p.stayMin > (p.indoor ? DAY_END : DAY_END - 60) ||   // 야외는 21:00까지
          (visited > 0 && active + mealMove + move + p.stayMin + back > limit)) {
        carry = ordered.slice(i);
        break;
      }
      const vs = makeStop(p, 'visit');
      if (signatureOf(p, sig)) vs.sig = signatureOf(p, sig);
      stops.push(vs);
      used.add(p.id);
      clock += move + p.stayMin;
      active += move + p.stayMin;
      visited++;
      pos = p;
    }
    if (!lunch && (visited > 0 || clock <= LUNCH.until)) clock = addMeal(stops, 'lunch', pos, clock);
    if (!dinner && (!lastDay || clock >= DINNER_FROM)) clock = addMeal(stops, 'dinner', pos, clock);   // 마지막 날은 늦게 끝날 때만 저녁
    days.push({ start: dayStart, stops: stops });
  }
  if (!sigFoodDone) forceSignatureFood();
  return { type: type, region: pool.region, lodging: lodging, days: days, relax: pool.relax };

  // 끝까지 대표 먹거리를 못 넣었으면: 대표 식당과 가장 가까운 끼니 하나를 바꿈 (그날 문 연 곳 우선)
  function forceSignatureFood() {
    let best = null;
    days.forEach(function (day, di) {
      const dow = dowOf(trip, di + 1);
      day.stops.forEach(function (st, si) {
        if (!st.meal) return;
        const prev = si > 0 ? day.stops[si - 1].p : (di === 0 ? anchor : (lodging || anchor));
        sigFoods.forEach(function (r) {
          if (used.has(r.id)) return;
          const km = distanceKm(prev, r) + (openAt(r, dow, st.meal === '점심' ? LUNCH.from + 30 : DINNER_FROM + 30) ? 0 : 1000);
          if (!best || km < best.km) best = { km: km, st: st, r: r };
        });
      });
    });
    if (!best) return;
    used.delete(best.st.p.id);
    used.add(best.r.id);
    best.st.p = best.r;
    best.st.sig = signatureOf(best.r, sig);
    sigFoodDone = true;
  }

  // 식당을 일정에 넣고, 식사가 끝나는 시각을 돌려줌
  function addMeal(stops, kind, pos, clock) {
    // 그 끼니 시각(점심 12:00·저녁 18:00 무렵)에 문을 여는 식당만 (휴무일·브레이크타임 제외)
    const mealAt = Math.max(clock, kind === 'lunch' ? LUNCH.from + 30 : DINNER_FROM + 30);
    const openList = pool.restaurants.filter(function (r) { return openAt(r, today, mealAt); });
    const from = pos.isHome ? anchor : pos;
    let r = null;
    if (!sigFoodDone) {
      // 대표 먹거리: 가까우면(12km 안) 이번 끼니에, 마지막 날(또는 전날 저녁)이면 거리와 상관없이
      const lastChance = curDay === trip.days || (kind === 'dinner' && curDay === trip.days - 1);
      const sr = pickRestaurant(type, sigFoods.filter(function (x) { return openAt(x, today, mealAt); }), from, used, eaten, lastGroup);
      if (sr && (lastChance || distanceKm(from, sr) <= SIG_FOOD_KM)) r = sr;
    }
    if (!r) r = pickRestaurant(type, openList.length ? openList : pool.restaurants, from, used, eaten, lastGroup);
    if (!r) return clock;
    used.add(r.id);
    lastGroup = cuisineOf(r);
    eaten[lastGroup] = (eaten[lastGroup] || 0) + 1;
    dishesOf(r).forEach(function (x) { eaten['dish:' + x] = (eaten['dish:' + x] || 0) + 1; });
    const ms = makeStop(r, kind);
    if (signatureOf(r, sig)) { ms.sig = signatureOf(r, sig); sigFoodDone = true; }
    stops.push(ms);
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
  pool.signature = places.signature || null;   // loadPlaces가 붙여 줌
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
// avoidDish: 이미 일정에 있는 대표 메뉴(dishOf) — 그 메뉴 식당은 다른 곳이 전혀 없을 때만 (2026-10-10, 막국수 점심 → 막국수 아침 같은 중복 방지)
function pickBreakfastRestaurant(lodging, restaurants, used, avoidDish) {
  if (avoidDish && avoidDish.size) {
    const r = pickBreakfastRestaurant(lodging, restaurants.filter(function (x) { return !dishesOf(x).some(function (k) { return avoidDish.has(k); }); }), used);
    if (r) return r;
  }
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
  const dishes = new Set();   // 일정에 이미 있는 대표 메뉴
  plan.days.forEach(function (d) { d.stops.forEach(function (st) { if (st.meal && st.p) dishesOf(st.p).forEach(function (k) { dishes.add(k); }); }); });
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
      const r = pickBreakfastRestaurant(plan.lodging, restaurants, used, dishes);
      if (r) { stop.p = r; used.add(r.id); dishesOf(r).forEach(function (k) { dishes.add(k); }); } else day.stops.splice(day.stops.indexOf(stop), 1);
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
      const cur = plan.lodging, curCost = lodgingTripCost(cur, trip);
      pool.all.lodgings.forEach(function (l) {
        const lCost = lodgingTripCost(l, trip);
        if (lCost >= curCost) return;
        const km = distanceKm(cur, l);
        consider(curCost - lCost, loss(cur, l, km, 5),
                 function () { plan.lodging = l; syncBreakfast(trip, plan, pool.all.restaurants); }, cur, l);
      });
    }
    // 식사·명소
    plan.days.forEach(function (d) {
      d.stops.forEach(function (st) {
        const cur = st.p;
        if (!(cur.cost > 0) || st.sig) return;   // 대표 먹거리·할거리는 예산 맞추기에서 바꾸지 않음
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

  if (plan.lodging) cost.lodging = lodgingTripCost(plan.lodging, trip);   // 객실·날짜별 요금 합 (nights박)

  const days = plan.days.map(function (day, idx) {
    const d = idx + 1, lastDay = d === plan.days.length;
    const startPoint = d === 1 || !plan.lodging ? dep : plan.lodging;
    const endPoint = lastDay || !plan.lodging ? dep : plan.lodging;
    let pos = startPoint, clock = day.start, active = 0;
    const items = [];
    // 일일 경비: 그날 밤 숙박비(마지막 날 제외) + 그날 식비·입장료·교통비
    const dc = { lodging: plan.lodging && !lastDay ? lodgingNightCost(plan.lodging, trip, idx) : 0, food: 0, admission: 0, transport: 0, total: 0 };

    function leg(to, stop) {
      const intercity = !!(pos.isHome || to.isHome);
      const km = distanceKm(pos, to);
      const mode = localMode(km, trip.transport, intercity, stop);   // 'walk' | 'transit' | null(자동차·지역 간 이동)
      let min = travelMin(km, trip.transport, intercity, mode);
      let fare = legCost(km, trip.transport, intercity, pay, mode);
      const real = mode === 'transit' ? transitLegs[legKey(pos, to)] : null;   // 카카오가 알려 준 실제 시간·요금
      if (real && !real.noTransit) {
        min = Math.round(real.time / 60);
        fare = (real.fare || LOCAL_FARE) * pay;
      }
      distance += intercity && trip.transport === '자동차' ? km * INTERCITY.자동차.road : km;
      cost.transport += fare;
      dc.transport += fare;
      return { km: km, min: min, mode: mode, real: !!(real && !real.noTransit) };
    }

    day.stops.forEach(function (stop, i) {
      const mv = leg(stop.p, stop);
      const arrive = clock + mv.min;
      const queue = (stop.p.info && stop.p.info.waitMin && stop.p.type !== '숙소') ? stop.p.info.waitMin : 0;   // 후기에 나온 줄 서는 시간
      const begin = Math.max(arrive, stop.notBefore || 0) + queue;
      const end = begin + stop.stay;
      const issue = hoursIssue(stop.p, dowOf(trip, d), begin - queue, end);
      let c = stop.p.type === '숙소' ? 0 : (stop.p.cost || 0) * pay;
      if (stop.p.breakfastOf != null) {   // 숙소 조식: 어린이는 성인의 50%, 유아 0원
        c = (stop.p.cost || 0) * (pay - (trip.children || 0) * (1 - BREAKFAST.childRate));
      }
      if (stop.p.type === '식당') { cost.food += c; dc.food += c; } else { cost.admission += c; dc.admission += c; }
      if (!stop.meal) { active += mv.min + stop.stay; visits++; } else active += mv.min;
      items.push({ queue: queue, hoursIssue: issue, stop: stop, index: i, moveMin: mv.min, moveKm: mv.km, moveMode: mv.mode, moveReal: mv.real, arrive: arrive, begin: begin, end: end, cost: c });
      clock = end;
      pos = stop.p;
    });
    // 숙소로 가는 날: 숙소 도착이 20:00(바꿀 수 있음) 이후가 되도록 그 전까지 자유 시간 / 집으로 가는 날: 끝나는 대로 출발
    const back = leg(endPoint, day.backStop);   // 숙소로 돌아가는 구간의 걷기/대중교통 선택은 day.backStop.legMode
    active += back.min;
    let departMin = clock;
    if (!endPoint.isHome) departMin = Math.max(clock, (plan.lodgingArrive || LODGING_ARRIVE) - back.min);
    const endMin = departMin + back.min;
    dc.total = dc.lodging + dc.food + dc.admission + dc.transport;
    return { cost: dc, start: day.start, startPoint: startPoint, endPoint: endPoint, items: items, departMin: departMin,
             freeMin: departMin - clock, backMin: back.min, backKm: back.km, backMode: back.mode, endMin: endMin, activeMin: active, over: active > limit };
  });

  cost.total = cost.lodging + cost.food + cost.admission + cost.transport;
  return { days: days, cost: cost, distanceKm: distance, visits: visits, visitsPerDay: visits / plan.days.length };
}

// 장소 점수가 아직 없으면 계산해 붙임 (저장된 일정을 불러온 경우 등)
function ensureScores(places, trip) {
  places.forEach(function (p) {
    if (p._s == null) p._s = withPopularity(placeTagScore(p.tags || {}, trip), p.popularity) * infoMultiplier(p, trip) * seasonMultiplier(p, tripMonth(trip));
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
// 장소 배열에 그 지역 대표 먹거리·할거리(places.signature)를 붙여서 돌려줌 (파일이 없어도 일정은 만들어짐)
async function loadPlaces(region) {
  const places = await loadJSON('data/places/' + encodeURIComponent(region) + '.json');
  if (places.signature === undefined) {
    let all = null;
    try { all = await loadJSON('data/signature.json'); } catch (e) { console.warn(e); }
    places.signature = (all && all[region]) || null;
  }
  return places;
}

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
    const back = trip.back_modes && trip.back_modes[d];
    days.push({ start: (trip.day_starts && trip.day_starts[d]) || DAY_START, stops: [], backStop: back ? { legMode: back } : {} });
  }
  let lodging = null;
  data.forEach(function (row) {
    // 숙소 조식(id 'bf-숙소id')은 장소 파일에 없으므로 숙소 정보로 다시 만듦
    if (lodging && String(row.place_id).indexOf('bf-') === 0) {
      days[row.day_no - 1].stops.push({ p: breakfastPlace(lodging), stay: row.stay_min, meal: row.meal || '아침', notBefore: row.not_before || undefined,
                                        legMode: row.leg_mode || undefined });
      return;
    }
    const p = byId[row.place_id] || { id: row.place_id, name: row.name, type: row.type, lat: row.lat, lng: row.lng,
                                      cost: 0, stayMin: row.stay_min, tags: {} };
    if (row.day_no === 0) { lodging = p; return; }
    const stop = { p: p, stay: row.stay_min };
    if (row.meal) stop.meal = row.meal;
    if (row.not_before) stop.notBefore = row.not_before;
    if (row.leg_mode) stop.legMode = row.leg_mode;
    if (days[row.day_no - 1]) days[row.day_no - 1].stops.push(stop);
  });
  const lodgingArrive = trip.day_starts && trip.day_starts.length > trip.days ? trip.day_starts[trip.days] : LODGING_ARRIVE;
  return { type: trip.plan_type, region: trip.region, lodging: lodging, days: days, relax: 1, lodgingArrive: lodgingArrive };
}

// node로 시험할 때 쓰도록 내보내기 (브라우저에서는 무시됨)
if (typeof module !== 'undefined') {
  module.exports = { signatureOf, signatureLabel, dishesOf, firstDayStart, seasonMultiplier, tripMonth, varietyFactor, attractionKind, dishOf, openAt, hoursIssue, dowOf, infoMultiplier, parkingOf, issueKind, needsAddressCheck, usable, transitLegs, legKey, localMode, WALK_KM, TEMPO, rankRegions, buildPlans, buildPlan, preparePool, computeTimeline, distanceKm,
    travelMin, budgetCaps, hhmm, PLAN_INFO, isChain, LODGING_ARRIVE, SEA_REGIONS, foodKind, cuisineOf, pickRestaurant, ensureScores, estimateMinCost, fitBudget, syncBreakfast, breakfastPlace, lodgingBreakfast };
}
