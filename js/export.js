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
//   화면에서는 보이지 않는 곳(화면 왼쪽 밖)에 두었다가 인쇄할 때만 일정 바로 아래에 나옴 (style.css @media print)
//   큰 지도 하나는 인쇄할 때 크기가 바뀌면서 깨져 보여서, 인쇄 폭에 맞춘 고정 크기 지도를 날마다 따로 만듦
//   경로는 화면 지도에서 이미 받아 둔 것을 다시 씀(road-route.js가 기억) → 길찾기 서버를 또 부르지 않음
const PRINT_MAP_W = 680, PRINT_MAP_H = 400;   // 인쇄 폭(A4 세로, 여백 제외 약 700px)에 맞춤 (Claude 판단)

async function buildPrintMaps(trip) {
  const box = document.getElementById('print-maps');
  const t = current.timeline;
  if (!box || !t || typeof kakao === 'undefined' || !kakao.maps || !kakao.maps.Map) return;
  box.innerHTML = '';
  const waits = t.days.map(function (day, di) {
    const color = DAY_COLORS[di % DAY_COLORS.length];
    const date = new Date(trip.start_date + 'T00:00:00');
    date.setDate(date.getDate() + di);
    const sec = document.createElement('section');
    sec.className = 'print-day-map';
    sec.innerHTML = '<h3>' + (di + 1) + '일차 지도 <small>' + (date.getMonth() + 1) + '/' + date.getDate() + ' (' + DOW[date.getDay()] + ')</small></h3>';
    const el = document.createElement('div');
    el.className = 'print-map';
    el.style.width = PRINT_MAP_W + 'px';
    el.style.height = PRINT_MAP_H + 'px';
    sec.appendChild(el);
    box.appendChild(sec);

    const m = new kakao.maps.Map(el, { center: new kakao.maps.LatLng(36.3, 127.8), level: 7, draggable: false });
    const bounds = new kakao.maps.LatLngBounds();
    const pts = [], modes = [];
    let n = 0;
    function pin(p, label, dark) {
      const pos = new kakao.maps.LatLng(p.lat, p.lng);
      bounds.extend(pos);
      const pe = document.createElement('div');
      pe.className = 'map-pin';
      pe.style.background = dark ? '#333' : color;
      pe.textContent = label;
      new kakao.maps.CustomOverlay({ position: pos, content: pe, yAnchor: 0.5 }).setMap(m);
    }
    function pushPt(p, mode) { if (pts.length) modes.push(mode || null); pts.push({ lat: p.lat, lng: p.lng }); }
    // 화면 지도(renderMap)와 같은 규칙: 숙소에서 출발하면 '숙', 장소는 '일차-번호', 식당은 🍴
    if (!day.startPoint.isHome) { pin(day.startPoint, '숙', true); pushPt(day.startPoint); }
    day.items.forEach(function (it) { pin(it.stop.p, it.stop.meal ? '🍴' : (di + 1) + '-' + (++n), false); pushPt(it.stop.p, it.moveMode); });
    if (!day.endPoint.isHome) { pin(day.endPoint, '숙', true); pushPt(day.endPoint, day.backMode); }
    if (!pts.length) { sec.remove(); return Promise.resolve(); }
    m.setBounds(bounds, 30, 30, 30, 30);

    // 지도 그림(타일)과 경로선이 다 그려질 때까지 기다림 — 오래 걸리면 6초에서 끊고 그대로 인쇄
    const tiles = new Promise(function (resolve) { kakao.maps.event.addListener(m, 'tilesloaded', resolve); });
    const route = new Promise(function (resolve) { drawRoute(m, pts, color, function () { resolve(); }, trip.transport, modes); });
    return Promise.race([Promise.all([tiles, route]), new Promise(function (r) { setTimeout(r, 6000); })]);
  });
  await Promise.all(waits);
  await new Promise(function (r) { setTimeout(r, 400); });   // 걷는 길 등 늦게 그려지는 선을 조금 더 기다림
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
