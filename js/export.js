// 여행 정보 파일로 저장 (여행 정보 화면 trip.html에서 사용)
// 입력: 여행(trips 행), 일정(plan), 시간표(computeTimeline 결과), 준비물(checklist 테이블)
// 출력: PDF — 브라우저 인쇄 창의 'PDF로 저장' (인쇄용 CSS가 버튼·입력칸을 숨기고 한 줄로 배치)
//       엑셀 — 시트 4개(여행 정보·일정·일일 경비·준비물)가 든 .xlsx 파일 (SheetJS 라이브러리를 누를 때 불러옴)

const SHEETJS_URL = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';

function exportFileName(trip) {
  return 'TripMate_' + (trip.region || '여행') + '_' + trip.start_date + '~' + trip.end_date.slice(5);
}

// PDF: 인쇄 창의 기본 파일 이름이 문서 제목(document.title)이므로 잠시 바꿔 두었다가 되돌림
function exportPdf(trip) {
  const old = document.title;
  document.title = exportFileName(trip);
  window.addEventListener('afterprint', function restore() {
    document.title = old;
    window.removeEventListener('afterprint', restore);
  });
  window.print();
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
