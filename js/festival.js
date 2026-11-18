// 지역 축제·행사 (피드백 반영 6차시, 최세민 2번 댓글)
// 입력: data/festivals.json (tools/fetch_festivals.py가 TourAPI 행사정보에서 받음), 여행 날짜, 지역 이름
// 출력: 여행 기간과 겹치는 그 지역 축제 목록, 일정에 넣을 수 있는 장소 모양({ id:'fe-…', type:'명소', festival:{start,end} })
//       여행지 추천: 축제가 있는 지역 점수 ×1.1 (recommend.js FESTIVAL_BONUS) + 카드에 표시
//       일정안 비교·일정 상세: 축제 목록과 '일정에 넣기' 버튼 (자동으로 넣지는 않음 — 사용자가 고름)

let festivalData = null;
const FESTIVAL_STAY = 90;   // 축제에 머무는 기본 시간(분) — 일정 상세에서 바꿀 수 있음 (Claude 판단)

async function loadFestivals() {
  if (festivalData) return festivalData;
  try { festivalData = await loadJSON('data/festivals.json'); }
  catch (e) { console.warn('축제 데이터가 없어요 (tools/fetch_festivals.py 실행 필요)', e); festivalData = { regions: {} }; }
  return festivalData;
}

// '서울 종로구' → 서울 목록 중 종로구 것만, '강릉' → 강릉 목록
function festivalsInRegion(data, region) {
  const parts = String(region).split(' ');
  const list = (data.regions || {})[parts[0]] || [];
  return parts[1] ? list.filter(function (f) { return f.district === parts[1]; }) : list;
}

// 여행 기간(시작일~종료일)과 하루라도 겹치는 축제
function festivalsForTrip(data, trip, region) {
  return festivalsInRegion(data, region).filter(function (f) { return f.start <= trip.end_date && f.end >= trip.start_date; });
}

// 지역별 겹치는 축제 수 → trip.festivalCounts (rankRegions가 점수에 반영)
function countFestivals(data, trip, regions) {
  const counts = {};
  regions.forEach(function (r) { const n = festivalsForTrip(data, trip, r.region).length; if (n) counts[r.region] = n; });
  return counts;
}

// 축제가 열리는 여행 날짜들 (1일차부터 센 번호)
function festivalDays(f, trip) {
  const out = [];
  for (let d = 1; d <= trip.days; d++) { const day = dayDate(trip, d); if (day >= f.start && day <= f.end) out.push(d); }
  return out;
}

function festivalDateText(f) {
  const md = function (s) { return Number(s.slice(5, 7)) + '.' + Number(s.slice(8)); };
  return f.start === f.end ? md(f.start) : md(f.start) + '~' + md(f.end);
}

// 일정에 넣을 장소 모양 (입장료는 모르므로 0원, '요금 확인 필요' 안내)
function festivalPlace(f, region) {
  return { id: f.id, name: f.title, type: '명소', category: 'FESTIVAL', categoryName: '축제·행사 (' + festivalDateText(f) + ')',
           region: region, lat: f.lat, lng: f.lng, cost: 0, stayMin: FESTIVAL_STAY, address: f.address, photo: f.photo,
           recommend: true, tags: {}, indoor: null, festival: { start: f.start, end: f.end },
           basis: '🎉 TourAPI 행사 정보 · 요금·시간은 축제 누리집에서 확인해 주세요' };
}
