// 여행 정보 파일로 저장 (여행 정보 화면 trip.html에서 사용)
// 입력: 여행(trips 행), 일정(plan), 시간표(computeTimeline 결과), 준비물(checklist 테이블)
// 출력: PDF — 브라우저 인쇄 창의 'PDF로 저장' (인쇄용 CSS가 버튼·입력칸을 숨기고 한 줄로 배치, 지도는 일차별로 따로)
//       엑셀 — 시트 4개(여행 정보·일정·일일 경비·준비물)가 든 .xlsx 파일 (SheetJS 라이브러리를 누를 때 불러옴)

const SHEETJS_URL = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';

function exportFileName(trip) {
  return 'TripMate_' + (trip.region || '여행') + '_' + trip.start_date + '~' + trip.end_date.slice(5);
}

// PDF: 인쇄 창의 기본 파일 이름이 문서 제목(document.title)이므로 잠시 바꿔 두었다가 되돌림
// 인쇄 전에 일차별 지도(buildPrintMaps)를 그려 두고, 지도 그림이 다 불러와지면 인쇄 창을 엶
async function exportPdf(trip) {
  const btn = document.getElementById('pdf-btn');
  const label = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = '🗺️ 일차별 지도 준비 중…'; }
  try {
    await buildPrintMaps(trip);
  } catch (e) {
    console.warn('일차별 지도를 만들지 못했어요 (지도 없이 저장):', e);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = label; }
  }
  const old = document.title;
  document.title = exportFileName(trip);
  window.addEventListener('afterprint', function restore() {
    document.title = old;
    window.removeEventListener('afterprint', restore);
  });
  window.print();
}

// ---------- PDF용 일차별 지도 (2026-10-10 이재훈 요청) ----------
// 입력: 지금 일정의 시간표(current.timeline, trip.js) / 출력: #print-maps 칸에 '1일차', '2일차' … 지도를 하나씩 그림
//   화면 밖(왼쪽)에서 그린 뒤 각 날짜 일정 칸(.day-block) 안으로 옮김 → 인쇄할 때 '그날 일정 | 그날 지도'가 나란히 (2026-10-10 이재훈 요청)
//   화면에서는 날짜 칸 안의 인쇄용 지도를 숨김 (style.css)
//   큰 지도 하나는 인쇄할 때 크기가 바뀌면서 깨져 보여서, 인쇄 폭에 맞춘 고정 크기 지도를 날마다 따로 만듦
//   경로는 화면 지도에서 이미 받아 둔 것을 다시 씀(road-route.js가 기억) → 길찾기 서버를 또 부르지 않음
// 지도 크기는 그날 장소·길이 퍼진 모양에 맞춰 자동으로 (2026-10-10 이재훈 요청)
//   1) 장소·길의 가로세로 비율로 목표 칸(넓이 약 330×300)을 정해 그 안에 다 들어가게 확대 단계를 고름
//   2) 그 단계에서 장소·길이 실제로 차지하는 픽셀 범위 + 여백만 남기고 지도 칸을 잘라 냄
//   3) 카카오 지도는 확대가 2배씩 단계라 잘라 낸 크기가 들쭉날쭉 → 넓이가 목표와 비슷해지도록 지도 그림을 살짝 확대(최대 1.6배)
const PRINT_MAP_AREA = 330 * 300;          // 목표 넓이 (Claude 판단: 전 버전 크기)
const PRINT_MAP_MAX_W = 400, PRINT_MAP_MAX_H = 420, PRINT_MAP_MIN = 150;
const PRINT_MAP_PAD = 22;                  // 가장자리 핀이 잘리지 않을 만큼의 여백(px)

function waitOrTimeout(promise, ms) {
  return Promise.race([promise, new Promise(function (r) { setTimeout(r, ms); })]);
}

// 위도·경도 → 메르카토르 좌표 (가로세로 비율 계산용)
function mercY(lat) { return Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)); }

async function buildPrintMaps(trip) {
  const box = document.getElementById('print-maps');
  const t = current.timeline;
  if (!box || !t || typeof kakao === 'undefined' || !kakao.maps || !kakao.maps.Map) return;
  box.innerHTML = '';
  document.querySelectorAll('#schedule .print-day-map').forEach(function (x) { x.remove(); });   // 지난번에 옮겨 둔 지도
  const sections = [];
  const waits = t.days.map(async function (day, di) {
    const color = DAY_COLORS[di % DAY_COLORS.length];
    const sec = document.createElement('section');
    sec.className = 'print-day-map';
    sections.push(sec);
    const frame = document.createElement('div');   // 인쇄에 보이는 칸 (확대 후 크기)
    frame.className = 'print-map';
    const el = document.createElement('div');      // 실제 카카오 지도 (잘라 낸 크기)
    el.className = 'print-map-inner';
    frame.appendChild(el);
    sec.appendChild(frame);
    box.appendChild(sec);

    // 장소 핀과 경로 점 (화면 지도 renderMap과 같은 규칙: 숙소 '숙', 장소 '일차-번호', 식당 🍴)
    const stops = [], pts = [], modes = [];
    let n = 0;
    function addStop(p, label, dark) { stops.push({ p: p, label: label, dark: dark }); }
    function pushPt(p, mode) { if (pts.length) modes.push(mode || null); pts.push({ lat: p.lat, lng: p.lng }); }
    if (!day.startPoint.isHome) { addStop(day.startPoint, '숙', true); pushPt(day.startPoint); }
    day.items.forEach(function (it) { addStop(it.stop.p, it.stop.meal ? '🍴' : (di + 1) + '-' + (++n), false); pushPt(it.stop.p, it.moveMode); });
    if (!day.endPoint.isHome) { addStop(day.endPoint, '숙', true); pushPt(day.endPoint, day.backMode); }
    if (!stops.length) { sec.remove(); return; }

    // 1) 처음 칸: 장소들의 가로세로 비율에 맞춘 목표 크기
    function sizeFor(latlngs) {
      const xs = latlngs.map(function (q) { return q.getLng() * Math.PI / 180; });
      const ys = latlngs.map(function (q) { return mercY(q.getLat()); });
      const dx = Math.max(Math.max.apply(null, xs) - Math.min.apply(null, xs), 1e-5);
      const dy = Math.max(Math.max.apply(null, ys) - Math.min.apply(null, ys), 1e-5);
      const r = Math.min(3, Math.max(1 / 3, dx / dy));   // 너무 길쭉한 경우는 1:3까지만
      let w = Math.sqrt(PRINT_MAP_AREA * r), h = Math.sqrt(PRINT_MAP_AREA / r);
      if (w > PRINT_MAP_MAX_W) { h *= PRINT_MAP_MAX_W / w; w = PRINT_MAP_MAX_W; }
      if (h > PRINT_MAP_MAX_H) { w *= PRINT_MAP_MAX_H / h; h = PRINT_MAP_MAX_H; }
      return { w: Math.round(w), h: Math.round(h) };
    }
    const stopLL = stops.map(function (s) { return new kakao.maps.LatLng(s.p.lat, s.p.lng); });
    let size = sizeFor(stopLL);
    el.style.width = size.w + 'px'; el.style.height = size.h + 'px';
    const m = new kakao.maps.Map(el, { center: stopLL[0], level: 7, draggable: false });
    stops.forEach(function (s, i) {
      const pe = document.createElement('div');
      pe.className = 'map-pin';
      pe.style.background = s.dark ? '#333' : color;
      pe.textContent = s.label;
      new kakao.maps.CustomOverlay({ position: stopLL[i], content: pe, yAnchor: 0.5 }).setMap(m);
    });

    // 경로선을 다 그릴 때까지 기다림 (화면 지도에서 받아 둔 경로라 보통 바로 옴, 최대 5초)
    let route = null;
    await waitOrTimeout(new Promise(function (resolve) { route = drawRoute(m, pts, color, function () { resolve(); }, trip.transport, modes); }), 5000);
    await new Promise(function (r) { setTimeout(r, 300); });   // 걷는 길처럼 조금 늦게 그려지는 선

    // 장소 + 길 전부
    const all = stopLL.concat(route && route.points ? route.points() : []);
    const bounds = new kakao.maps.LatLngBounds();
    all.forEach(function (q) { bounds.extend(q); });
    size = sizeFor(all);
    el.style.width = size.w + 'px'; el.style.height = size.h + 'px';
    m.relayout();
    m.setBounds(bounds, PRINT_MAP_PAD, PRINT_MAP_PAD, PRINT_MAP_PAD, PRINT_MAP_PAD);

    // 2) 이 확대 단계에서 장소·길이 차지하는 픽셀 범위만큼만 남기고 잘라 냄
    const proj = m.getProjection();
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    all.forEach(function (q) {
      const pt = proj.containerPointFromCoords(q);
      minX = Math.min(minX, pt.x); maxX = Math.max(maxX, pt.x);
      minY = Math.min(minY, pt.y); maxY = Math.max(maxY, pt.y);
    });
    const cw = Math.max(PRINT_MAP_MIN, Math.ceil(maxX - minX) + 2 * PRINT_MAP_PAD);
    const ch = Math.max(PRINT_MAP_MIN, Math.ceil(maxY - minY) + 2 * PRINT_MAP_PAD);
    const center = proj.coordsFromContainerPoint(new kakao.maps.Point((minX + maxX) / 2, (minY + maxY) / 2));
    el.style.width = cw + 'px'; el.style.height = ch + 'px';
    m.relayout();
    m.setCenter(center);

    // 3) 넓이를 목표와 비슷하게: 지도 그림을 확대해서 보여 줌 (1~1.6배, 최대 폭·높이 안에서)
    let s = Math.sqrt(PRINT_MAP_AREA / (cw * ch));
    s = Math.min(s, 1.6, PRINT_MAP_MAX_W / cw, PRINT_MAP_MAX_H / ch);
    s = Math.max(s, Math.min(1, PRINT_MAP_MAX_W / cw, PRINT_MAP_MAX_H / ch));
    el.style.transform = 'scale(' + s.toFixed(3) + ')';
    frame.style.width = Math.round(cw * s) + 'px';
    frame.style.height = Math.round(ch * s) + 'px';

    // 지도 그림(타일)이 다 불러와질 때까지 (최대 4초)
    await waitOrTimeout(new Promise(function (resolve) { kakao.maps.event.addListener(m, 'tilesloaded', resolve); }), 4000);
  });
  await Promise.all(waits);
  // 다 그린 지도를 그 날짜 일정 칸 안으로 옮김
  const blocks = document.querySelectorAll('#schedule .day-block');
  sections.forEach(function (sec, di) { if (blocks[di] && sec.isConnected) blocks[di].appendChild(sec); });
}

function loadScriptOnce(url) {
  if (!loadScriptOnce.cache) loadScriptOnce.cache = {};
  if (!loadScriptOnce.cache[url]) {
    loadScriptOnce.cache[url] = new Promise(function (resolve, reject) {
      const el = document.createElement('script');
      el.src = url;
      el.onload = resolve;
      el.onerror = function () { reject(new Error('엑셀 라이브러리를 불러오지 못했어요. 인터넷 연결을 확인해 주세요.')); };
      document.head.appendChild(el);
    });
  }
  return loadScriptOnce.cache[url];
}

async function exportXlsx(trip, plan, timeline) {
  await loadScriptOnce(SHEETJS_URL);
  const { data: items, error } = await sb.from('checklist').select('item,checked').eq('trip_id', trip.id).order('id');
  if (error) throw error;
  const wb = XLSX.utils.book_new();

  function addSheet(name, rows, widths) {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = widths.map(function (w) { return { wch: w }; });
    XLSX.utils.book_append_sheet(wb, ws, name);
  }

  // 1. 여행 정보
  addSheet('여행 정보', [
    ['항목', '내용'],
    ['여행지', trip.region ? trip.region + ' · ' + trip.plan_type + '안 ' + PLAN_INFO[trip.plan_type].name : '아직 안 고름'],
    ['날짜', trip.start_date + ' ~ ' + trip.end_date + ' (' + trip.days + '일)'],
    ['인원', peopleText(trip)],
    ['방 수', trip.days > 1 ? (trip.rooms || 1) : '-'],
    ['출발지', trip.departure_address || '-'],
    ['이동 수단', trip.transport],
    ['템포', trip.tempo],
    ['취향', trip.tags.map(function (t) { return '#' + t; }).join(' ')],
    ['예산(원)', trip.budget_min + ' ~ ' + trip.budget_max],
    ['예상 총비용(원)', timeline ? Math.round(timeline.cost.total) : '-'],
    ['숙소', plan && plan.lodging ? plan.lodging.name : '-']
  ], [16, 50]);

  if (plan && timeline) {
    // 2. 일정: 날짜별 시작 → 장소들 → 숙소/집 도착
    const rows = [['일차', '날짜', '시각', '구분', '장소', '체류(분)', '이동(분)', '비용(원)', '주소', '카카오맵']];
    timeline.days.forEach(function (day, di) {
      const date = new Date(trip.start_date);
      date.setDate(date.getDate() + di);
      const ds = (date.getMonth() + 1) + '/' + date.getDate();
      rows.push([di + 1, ds, hhmm(day.start), '출발', di === 0 || !plan.lodging ? '집 (' + (trip.departure_address || '출발지') + ')' : plan.lodging.name, '', '', '', '', '']);
      day.items.forEach(function (it) {
        const p = it.stop.p;
        rows.push([di + 1, ds, hhmm(it.begin), it.stop.meal || p.type, p.name, it.stop.stay, Math.round(it.moveMin),
                   Math.round(it.cost), p.address || '', p.link || '']);
      });
      rows.push([di + 1, ds, hhmm(day.endMin), day.endPoint.isHome ? '집 도착' : '숙소 도착',
                 day.endPoint.isHome ? '집' : plan.lodging.name, '', Math.round(day.backMin), '', '', '']);
    });
    addSheet('일정', rows, [6, 7, 7, 8, 28, 9, 9, 10, 36, 30]);

    // 3. 일일 경비
    const cost = [['일차', '날짜', '숙박', '식비', '교통', '입장료', '합계', '1인당']];
    timeline.days.forEach(function (d, i) {
      const c = d.cost, date = new Date(trip.start_date);
      date.setDate(date.getDate() + i);
      cost.push([i + 1, (date.getMonth() + 1) + '/' + date.getDate(), Math.round(c.lodging), Math.round(c.food), Math.round(c.transport),
                 Math.round(c.admission), Math.round(c.total), Math.round(c.total / trip.people)]);
    });
    const T = timeline.cost;
    cost.push(['합계', '', Math.round(T.lodging), Math.round(T.food), Math.round(T.transport), Math.round(T.admission), Math.round(T.total), Math.round(T.total / trip.people)]);
    addSheet('일일 경비', cost, [6, 7, 11, 11, 11, 11, 12, 11]);
  }

  // 4. 준비물
  addSheet('준비물', [['준비물', '챙김']].concat(items.map(function (r) { return [r.item, r.checked ? 'O' : '']; })), [24, 6]);

  XLSX.writeFile(wb, exportFileName(trip) + '.xlsx');
}
