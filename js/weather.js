// 날씨 예보 (피드백 반영 6차시, 이승재 댓글 — 원래 js/packing.js에 있던 함수를 일정에도 쓰도록 옮김)
// 입력: 여행지 좌표, 여행 시작일·종료일 / 출력: 날짜별 예보 [{ date, tmax, tmin, rain(비 올 확률 %), uv }] 또는 null
//       Open-Meteo 무료 예보 API (키 필요 없음, 오늘부터 16일 안의 여행만, api/weather.js를 거쳐 받음). 같은 창에서는 sessionStorage에 기억해 두고 다시 안 부름
//       일정 만들기(recommend.js buildPlan)는 trip.weather를 보고 비 오는 날 야외 명소를 맑은 날로 미룸

const WEATHER_DAYS = 16;

const WEATHER_TIMEOUT = 10000;  // 예보가 10초 안에 답하지 않으면 날씨 없이 진행 (2026-11-18: 응답이 없을 때 지역마다 수십 초씩 멈추던 문제)
let weatherDown = false;        // 한 번 실패하면 이 화면에서는 다시 부르지 않음
const wxMemo = {};              // 지역 이름 → 예보 (이 화면 안에서만)

// 예보 범위(오늘~15일 뒤)와 여행 기간이 겹치는 부분 / 출력: { s, e } 또는 null(이미 지난 여행·범위 밖)
function forecastRange(start, end) {
  const t0 = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });   // 오늘(한국 시간) 'YYYY-MM-DD'
  const last = new Date(t0 + 'T00:00:00Z');
  last.setUTCDate(last.getUTCDate() + WEATHER_DAYS - 1);
  const t1 = last.toISOString().slice(0, 10);
  if (end < t0 || start > t1) return null;
  return { s: start < t0 ? t0 : start, e: end > t1 ? t1 : end };
}

// Open-Meteo 한 번 부르기 — 좌표 여러 개를 쉼표로 이어 한꺼번에 받을 수 있음
// 입력: [{ lat, lng }], 날짜 범위 / 출력: 좌표 순서대로 예보 배열의 배열, 실패하면 null
async function fetchForecastMany(points, range) {
  if (weatherDown || !points.length || !range) return null;
  // 우리 서버 함수(api/weather.js)를 거쳐 받음 — Open-Meteo에 바로 접속이 안 되는 네트워크가 있어서
  const url = '/api/weather?lat=' + points.map(function (p) { return p.lat.toFixed(3); }).join(',') +
    '&lng=' + points.map(function (p) { return p.lng.toFixed(3); }).join(',') + '&start=' + range.s + '&end=' + range.e;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(function () { ctrl.abort(); }, WEATHER_TIMEOUT);
    const r = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    let j = await r.json();
    if (!Array.isArray(j)) j = [j];
    return j.map(function (one) {
      const d = one.daily;
      return d.time.map(function (date, i) {
        return { date: date, tmax: d.temperature_2m_max[i], tmin: d.temperature_2m_min[i],
                 rain: d.precipitation_probability_max[i], uv: d.uv_index_max[i] };
      });
    });
  } catch (err) {
    weatherDown = true;
    console.warn('날씨 예보를 불러오지 못했어요 — 이 화면에서는 날씨 없이 계산해요', err);
    return null;
  }
}

// 좌표 한 곳 (준비물 추천 js/packing.js에서 사용) / 출력: 날짜별 [{ date, tmax, tmin, rain, uv }] 또는 null
async function fetchForecast(lat, lng, start, end) {
  const key = 'wx|' + lat.toFixed(2) + ',' + lng.toFixed(2) + '|' + start + '|' + end + '|' + new Date().toISOString().slice(0, 13);   // 1시간마다 새로
  try { const saved = sessionStorage.getItem(key); if (saved) return JSON.parse(saved); } catch (e) {}
  const many = await fetchForecastMany([{ lat: lat, lng: lng }], forecastRange(start, end));
  const f = many ? many[0] : null;
  if (f) { try { sessionStorage.setItem(key, JSON.stringify(f)); } catch (e) {} }
  return f;
}

// 지역 중심 좌표: data/regions.json 값 (여행지 추천·일정안 비교·일정 상세가 같은 좌표를 써서 같은 예보 → 같은 일정이 나오게)
async function regionPoint(region) {
  const list = await loadRegions();
  const r = list.find(function (x) { return x.region === region; });
  return r ? { lat: r.lat, lng: r.lng } : null;
}

// 여행지 추천 화면: 확인할 지역들의 예보를 한 번에 미리 받아 둠
async function prefetchWeather(trip, regionNames) {
  const range = forecastRange(trip.start_date, trip.end_date);
  if (!range) return;
  const names = [], points = [];
  for (const n of regionNames) {
    if (wxMemo[n] !== undefined) continue;
    const pt = await regionPoint(n);
    if (pt) { names.push(n); points.push(pt); }
  }
  const many = await fetchForecastMany(points, range);
  names.forEach(function (n, i) { wxMemo[n] = many ? many[i] : null; });
}

// 여행에 그 지역 예보를 붙임 (trip.weather) — DB에는 저장하지 않음
// 입력: trip, 지역 이름 / 출력: 예보 배열 또는 null
async function attachWeather(trip, region) {
  if (wxMemo[region] === undefined) {
    const pt = await regionPoint(region);
    wxMemo[region] = pt ? await fetchForecast(pt.lat, pt.lng, trip.start_date, trip.end_date) : null;
  }
  trip.weather = wxMemo[region];
  return trip.weather;
}

// 날씨 아이콘·한 줄 요약 (예보가 없으면 '')
function weatherIcon(w) {
  if (!w) return '';
  return w.rain >= 70 ? '🌧' : w.rain >= RAIN_PROB ? '🌦' : w.rain >= 30 ? '⛅' : '☀️';
}
function weatherText(w) {
  if (!w) return '';
  return weatherIcon(w) + ' 비 ' + Math.round(w.rain) + '% · ' + Math.round(w.tmin) + '~' + Math.round(w.tmax) + '℃';
}
// 일정안 비교·상세 위쪽 안내: 비 오는 날 목록 / 예보 범위 밖이면 안내
function weatherNote(trip) {
  if (!trip.weather) return forecastRange(trip.start_date, trip.end_date)
    ? '🌤 지금은 날씨 예보를 불러오지 못해서 날씨 없이 일정을 짰어요. 잠시 뒤 새로고침해 보세요.'
    : '🌤 날씨 예보는 여행 16일 전부터 일정에 반영돼요. (지금은 예보 범위 밖이라 날씨를 고려하지 않았어요)';
  const rainy = [];
  for (let d = 1; d <= trip.days; d++) if (isRainyDay(trip, d)) rainy.push(d + '일차(' + Math.round(dayWeather(trip, d).rain) + '%)');
  return rainy.length
    ? '☔ 비 예보: ' + rainy.join(', ') + ' — 비 올 확률 ' + RAIN_PROB + '% 이상인 날은 야외 명소를 맑은 날로 미루고 실내 명소를 먼저 넣었어요.'
    : '☀️ 여행 기간에 비 올 확률 ' + RAIN_PROB + '% 이상인 날이 없어요. (Open-Meteo 예보)';
}
