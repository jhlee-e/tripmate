// 추천 준비물 (여행 정보 화면 trip.html의 준비물 체크리스트 옆에 표시)
// 입력: 여행 조건(날짜·인원 나이대·이동 수단·취향·숙박 여부), 일정 장소들의 분류, 여행 기간 날씨 예보(있으면)
// 출력: [{ item: '모자', why: ['자외선 지수 8(매우 높음)'], group: '날씨' }] — 규칙 하나하나가 '왜 추천했는지'를 함께 남김
//       날씨 예보: Open-Meteo 무료 예보 API (키 필요 없음, 오늘부터 16일 안의 여행만). 그보다 먼 여행은 달(月) 기준 규칙만 사용

const WEATHER_DAYS = 16;

// ---------- 1. 날씨 예보 ----------
// 입력: 여행지 좌표, 시작일·종료일('YYYY-MM-DD') / 출력: 날짜별 [{ date, tmax, tmin, rain, uv }] 또는 null(범위 밖·실패)
async function fetchForecast(lat, lng, start, end) {
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

// ---------- 2. 규칙 ----------
function recommendPacking(trip, plan, forecast) {
  const out = {}, order = [];
  function add(item, why, group) {
    if (!out[item]) { out[item] = { item: item, why: [], group: group }; order.push(item); }
    if (out[item].why.indexOf(why) === -1) out[item].why.push(why);
  }
  const month = Number(trip.start_date.slice(5, 7));
  const nights = trip.days - 1;
  const stops = [];
  if (plan) plan.days.forEach(function (d) { d.stops.forEach(function (s) { if (!s.meal) stops.push(s.p); }); });
  const cats = stops.map(function (p) { return (p.categoryName || '') + ' ' + p.name; });
  function visits(re) { return cats.filter(function (c) { return re.test(c); }).length > 0; }
  const summer = month >= 6 && month <= 9, winter = month === 12 || month <= 2;

  // 기본
  add('신분증', '기본 준비물', '기본');
  add('휴대폰 충전기', '기본 준비물', '기본');
  add('보조배터리', '지도·사진을 많이 써서 배터리가 빨리 닳아요', '기본');
  // 숙박
  if (nights > 0) {
    add('세면도구', nights + '박 숙박', '숙박');
    add('갈아입을 옷 ' + nights + '벌', nights + '박 숙박', '숙박');
    add('잠옷', nights + '박 숙박', '숙박');
    add('상비약', nights + '박 숙박', '숙박');
    if (nights >= 3) add('빨래 봉투', nights + '박 이상 긴 여행', '숙박');
  }
  // 이동 수단
  if (trip.transport === '자동차') {
    add('운전면허증', '자동차로 이동', '이동');
    add('차량용 충전기', '자동차로 이동', '이동');
    add('하이패스 카드', '자동차로 이동 (고속도로)', '이동');
  } else {
    add('교통카드', '대중교통으로 이동', '이동');
    add('기차·버스 승차권(모바일)', '대중교통으로 이동', '이동');
  }
  // 취향·템포·장소
  if (trip.tags.indexOf('액티브') !== -1 || visits(/레저스포츠|체험관광|레포츠|래프팅|카약|승마|카트|짚라인/)) {
    add('편한 바지', trip.tags.indexOf('액티브') !== -1 ? '#액티브 취향' : '체험·레저 장소 방문', '활동');
    add('운동화', trip.tags.indexOf('액티브') !== -1 ? '#액티브 취향' : '체험·레저 장소 방문', '활동');
    add('여벌 양말', '체험·레저 활동', '활동');
  }
  if (trip.tempo === '알차게') add('편한 신발', '알차게 템포: 하루에 많이 걸어요', '활동');
  if (visits(/자연경관\(산\)|국립공원|도립공원|둘레길|오름|봉우리|등산/)) {
    add('등산화', '산·둘레길 일정', '활동');
    add('물병', '산·둘레길 일정', '활동');
    add('바람막이', '산 위는 바람이 차요', '활동');
  }
  if (visits(/해변|해수욕장|해안|섬|항구|포구/)) {
    if (summer) {
      add('수영복', '해변 일정 (' + month + '월)', '물놀이');
      add('비치타월', '해변 일정 (' + month + '월)', '물놀이');
      add('아쿠아슈즈', '해변 일정 (' + month + '월)', '물놀이');
      add('방수팩', '해변 일정 (' + month + '월)', '물놀이');
    } else {
      add('바람막이', '바닷가는 바람이 세요', '활동');
    }
  }
  if (summer && visits(/계곡|폭포|워터파크|수영/)) {
    add('아쿠아슈즈', '계곡·물놀이 일정', '물놀이');
    add('갈아입을 옷', '계곡·물놀이 일정', '물놀이');
  }
  if (visits(/온천|사우나|스파|찜질/)) add('수건', '온천·스파 일정', '활동');
  if (visits(/스키|스노보드|썰매/)) { add('방수 장갑', '스키·썰매 일정', '활동'); add('여벌 양말', '스키·썰매 일정', '활동'); }
  if (visits(/일반야영장|오토캠핑|글램핑|카라반|자연휴양림/) || (plan && plan.lodging && /캠핑|글램핑|카라반/.test(plan.lodging.categoryName || ''))) {
    add('모기 기피제', '캠핑·숲 일정', '활동');
    add('손전등', '캠핑·숲 일정', '활동');
  }
  if (visits(/종교성지|사찰|사당/)) add('단정한 옷', '사찰·종교 시설 방문', '활동');
  if (trip.tags.indexOf('쇼핑') !== -1) add('장바구니(접이식)', '#쇼핑 취향', '활동');
  if (trip.tags.indexOf('미식') !== -1) add('소화제', '#미식 취향: 많이 먹는 여행', '활동');
  // 함께 가는 사람
  if (trip.infants) { ['기저귀', '물티슈', '유아 간식', '유모차·아기띠'].forEach(function (x) { add(x, '유아 ' + trip.infants + '명 동반', '동반'); }); }
  if (trip.children) { add('어린이 상비약', '어린이 ' + trip.children + '명 동반', '동반'); add('간식', '어린이 ' + trip.children + '명 동반', '동반'); }

  // 날씨: 예보가 있으면 예보로, 없으면 달 기준
  if (forecast && forecast.length) {
    const maxRain = Math.max.apply(null, forecast.map(function (f) { return f.rain || 0; }));
    const maxUv = Math.max.apply(null, forecast.map(function (f) { return f.uv || 0; }));
    const maxT = Math.max.apply(null, forecast.map(function (f) { return f.tmax; }));
    const minT = Math.min.apply(null, forecast.map(function (f) { return f.tmin; }));
    const gap = Math.max.apply(null, forecast.map(function (f) { return f.tmax - f.tmin; }));
    const rainDay = forecast.filter(function (f) { return f.rain >= 50; }).map(function (f) { return f.date.slice(5).replace('-', '/'); });
    if (rainDay.length) { add('우산', '비 올 확률 50% 이상: ' + rainDay.join(', ') + ' (최대 ' + maxRain + '%)', '날씨'); add('여벌 양말', '비 예보', '날씨'); }
    else if (maxRain >= 30) add('접이식 우산', '비 올 확률 최대 ' + maxRain + '%', '날씨');
    if (maxUv >= 6) {
      const why = '자외선 지수 최대 ' + maxUv.toFixed(0) + (maxUv >= 8 ? ' (매우 높음)' : ' (높음)');
      add('모자', why, '날씨'); add('선크림', why, '날씨'); add('선글라스', why, '날씨');
    } else if (maxUv >= 3) add('선크림', '자외선 지수 최대 ' + maxUv.toFixed(0) + ' (보통)', '날씨');
    if (maxT >= 28) { add('휴대용 선풍기', '낮 최고 ' + maxT.toFixed(0) + '℃', '날씨'); add('물병', '낮 최고 ' + maxT.toFixed(0) + '℃', '날씨'); }
    if (minT <= 5) { add('두꺼운 외투', '아침 최저 ' + minT.toFixed(0) + '℃', '날씨'); add('핫팩', '아침 최저 ' + minT.toFixed(0) + '℃', '날씨'); }
    if (minT <= 0) add('장갑', '아침 최저 ' + minT.toFixed(0) + '℃', '날씨');
    if (gap >= 10 && minT > 5) add('얇은 겉옷', '일교차 ' + gap.toFixed(0) + '℃', '날씨');
  } else {
    const m = month + '월 여행';
    if (month >= 5 && month <= 9) { add('모자', m + ' (햇빛이 강한 계절)', '날씨'); add('선크림', m + ' (햇빛이 강한 계절)', '날씨'); }
    if (month >= 6 && month <= 8) { add('휴대용 선풍기', m + ' (더운 계절)', '날씨'); add('물병', m + ' (더운 계절)', '날씨'); }
    if (month === 7 || (month === 6 && Number(trip.start_date.slice(8)) >= 20)) add('우산', '장마철', '날씨');
    else add('접이식 우산', '예보가 아직 없어요 (여행 16일 전부터 예보 반영)', '날씨');
    if (winter) { add('두꺼운 외투', m + ' (추운 계절)', '날씨'); add('장갑', m, '날씨'); add('핫팩', m, '날씨'); }
    if ([3, 4, 10, 11].indexOf(month) !== -1) add('얇은 겉옷', m + ' (일교차가 큰 계절)', '날씨');
  }
  return order.map(function (k) { return out[k]; });
}

// ---------- 3. 화면: 추천 목록 → 끌어서(또는 ＋) 체크리스트에 추가 ----------
// 입력: 여행, 일정, 체크리스트에 항목을 넣는 함수 addItem(이름), 지금 체크리스트 이름들을 돌려주는 함수
async function setupPackingSuggestions(trip, plan, addItem, currentItems) {
  const box = document.getElementById('suggest-list');
  const line = document.getElementById('weather-line');
  const drop = document.getElementById('check-drop');
  let center = null;
  if (plan) {
    const all = [];
    plan.days.forEach(function (d) { d.stops.forEach(function (s) { all.push(s.p); }); });
    if (all.length) center = centroid(all);
  }
  if (!center && trip.region) {
    const regions = await loadRegions();
    const r = regions.find(function (x) { return x.region === trip.region; });
    if (r) center = { lat: r.lat, lng: r.lng };
  }
  line.textContent = '날씨 예보 확인 중…';
  const forecast = center ? await fetchForecast(center.lat, center.lng, trip.start_date, trip.end_date) : null;
  line.innerHTML = forecast
    ? '🌤 ' + esc(trip.region || '') + ' 예보 반영 (' + forecast.length + '일치, <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a>)'
    : (center ? '🗓 예보는 여행 16일 전부터 반영돼요. 지금은 계절 기준으로 추천해요.' : '🗓 여행지를 고르면 장소·날씨에 맞춰 더 추천해 드려요.');
  const list = recommendPacking(trip, plan, forecast);

  function norm(x) { return x.replace(/\s+/g, ''); }
  function render() {
    const have = new Set(currentItems().map(norm));
    box.innerHTML = '';
    let shown = 0;
    list.forEach(function (s) {
      if (have.has(norm(s.item))) return;
      shown++;
      const chip = document.createElement('div');
      chip.className = 'suggest-chip';
      chip.draggable = true;
      chip.title = s.why.join(' · ');
      chip.innerHTML = '<span class="sg-grip" aria-hidden="true">⠿</span><span class="sg-body"><strong></strong><small></small></span>' +
                       '<button type="button" aria-label="체크리스트에 추가">＋</button>';
      chip.querySelector('strong').textContent = s.item;
      chip.querySelector('small').textContent = s.why.join(' · ');
      chip.addEventListener('dragstart', function (e) {
        e.dataTransfer.setData('text/plain', s.item);
        e.dataTransfer.effectAllowed = 'copy';
        chip.classList.add('dragging');
        drop.classList.add('drop-ready');
      });
      chip.addEventListener('dragend', function () { chip.classList.remove('dragging'); drop.classList.remove('drop-ready', 'drop-over'); });
      chip.querySelector('button').addEventListener('click', function () { take(s.item); });
      box.appendChild(chip);
    });
    if (!shown) box.innerHTML = '<p class="helper-text muted">추천 준비물을 모두 담았어요.</p>';
  }
  async function take(item) {
    await addItem(item);
    render();
  }
  // 놓는 곳: 체크리스트 칸 전체
  drop.addEventListener('dragover', function (e) {
    if (!e.dataTransfer.types || Array.prototype.indexOf.call(e.dataTransfer.types, 'text/plain') === -1) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    drop.classList.add('drop-over');
  });
  drop.addEventListener('dragleave', function (e) { if (!drop.contains(e.relatedTarget)) drop.classList.remove('drop-over'); });
  drop.addEventListener('drop', function (e) {
    e.preventDefault();
    drop.classList.remove('drop-over', 'drop-ready');
    const item = e.dataTransfer.getData('text/plain').trim();
    if (item) take(item);
  });
  render();
  return { refresh: render };
}
