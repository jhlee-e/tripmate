// 날씨 예보 (피드백 반영 6차시, 이승재 댓글 — 원래 js/packing.js에 있던 함수를 일정에도 쓰도록 옮김)
// 입력: 여행지 좌표, 여행 시작일·종료일 / 출력: 날짜별 예보 [{ date, tmax, tmin, rain(비 올 확률 %), uv }] 또는 null
//       Open-Meteo 무료 예보 API (키 필요 없음, 오늘부터 16일 안의 여행만). 같은 창에서는 sessionStorage에 기억해 두고 다시 안 부름
//       일정 만들기(recommend.js buildPlan)는 trip.weather를 보고 비 오는 날 야외 명소를 맑은 날로 미룸

const WEATHER_DAYS = 16;

// 입력: 여행지 좌표, 시작일·종료일('YYYY-MM-DD') / 출력: 날짜별 [{ date, tmax, tmin, rain, uv }] 또는 null(범위 밖·실패)
async function fetchForecastRaw(lat, lng, start, end) {
  const t0 = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });   // 오늘(한국 시간) 'YYYY-MM-DD'
  const last = new Date(t0 + 'T00:00:00Z');
  last.setUTCDate(last.getUTCDate() + WEATHER_DAYS - 1);
  const t1 = last.toISOString().slice(0, 10);
  if (end < t0 || start > t1) return null;            // 이미 지난 여행이거나 예보 범위 밖
  const s = start < t0 ? t0 : start, e = end > t1 ? t1 : end;
  const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + lat.toFixed(3) + '&longitude=' + lng.toFixed(3) +
    '&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,uv_index_max' +
    '&timezone=Asia%2FSeoul&start_date=' + s + '&end_date=' + e;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const d = (await r.json()).daily;
    return d.time.map(function (date, i) {
      return { date: date, tmax: d.temperature_2m_max[i], tmin: d.temperature_2m_min[i],
               rain: d.precipitation_probability_max[i], uv: d.uv_index_max[i] };
    });
  } catch (err) { console.warn('날씨 예보를 불러오지 못했어요', err); return null; }
}


async function fetchForecast(lat, lng, start, end) {
  const key = 'wx|' + lat.toFixed(2) + ',' + lng.toFixed(2) + '|' + start + '|' + end + '|' + new Date().toISOString().slice(0, 13);   // 1시간마다 새로
  try { const saved = sessionStorage.getItem(key); if (saved) return JSON.parse(saved); } catch (e) {}
  const f = await fetchForecastRaw(lat, lng, start, end);
  if (f) { try { sessionStorage.setItem(key, JSON.stringify(f)); } catch (e) {} }
  return f;
}

// 여행에 그 지역 예보를 붙임 (trip.weather) — DB에는 저장하지 않음
// 입력: trip, 그 지역 장소 배열 / 출력: 예보 배열 또는 null
async function attachWeather(trip, places) {
  const c = regionCenter(places);
  trip.weather = c ? await fetchForecast(c.lat, c.lng, trip.start_date, trip.end_date) : null;
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
  if (!trip.weather) return '🌤 날씨 예보는 여행 16일 전부터 일정에 반영돼요. (지금은 예보 범위 밖이라 날씨를 고려하지 않았어요)';
  const rainy = [];
  for (let d = 1; d <= trip.days; d++) if (isRainyDay(trip, d)) rainy.push(d + '일차(' + Math.round(dayWeather(trip, d).rain) + '%)');
  return rainy.length
    ? '☔ 비 예보: ' + rainy.join(', ') + ' — 비 올 확률 ' + RAIN_PROB + '% 이상인 날은 야외 명소를 맑은 날로 미루고 실내 명소를 먼저 넣었어요.'
    : '☀️ 여행 기간에 비 올 확률 ' + RAIN_PROB + '% 이상인 날이 없어요. (Open-Meteo 예보)';
}
