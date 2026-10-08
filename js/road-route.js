// 지도 경로선을 실제 도로를 따라 그리기 (여행 정보·일정 상세 화면에서 사용)
// 입력: 카카오 지도, 방문 순서대로의 점들 [{ lat, lng }], 선 색 / 출력: 먼저 점선(직선)을 그리고,
//       서버 함수 /api/route(카카오모빌리티 길찾기)로 받은 도로 경로가 오면 실선으로 바꿈. 실패하면 직선 그대로 둠
//       같은 점들의 경로는 이 창(sessionStorage)에 기억해 두어 다시 그릴 때 또 부르지 않음

const routeMemo = {};

function routeKey(points) {
  return 'route:' + points.map(function (p) { return p.lat.toFixed(5) + ',' + p.lng.toFixed(5); }).join('|');
}

async function fetchRoadPath(points) {
  const key = routeKey(points);
  if (routeMemo[key]) return routeMemo[key];
  try { const saved = sessionStorage.getItem(key); if (saved) return (routeMemo[key] = JSON.parse(saved)); } catch (e) {}
  routeMemo[key] = fetch('/api/route', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ points: points.map(function (p) { return { lat: p.lat, lng: p.lng }; }) })
  }).then(function (r) {
    return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || r.status); return j; });
  }).then(function (j) {
    try { sessionStorage.setItem(key, JSON.stringify(j)); } catch (e) {}
    return j;
  }).catch(function (e) { delete routeMemo[key]; throw e; });
  return routeMemo[key];
}

// 반환: { line(지금 지도에 있는 선), remove() } — 화면을 다시 그릴 때 remove()로 지움
function drawRoute(map, points, color, onResult) {
  const straight = new kakao.maps.Polyline({
    path: points.map(function (p) { return new kakao.maps.LatLng(p.lat, p.lng); }),
    strokeWeight: 3, strokeColor: color, strokeOpacity: 0.6, strokeStyle: 'shortdash'
  });
  straight.setMap(map);
  const handle = { line: straight, removed: false, remove: function () { this.removed = true; this.line.setMap(null); } };
  if (points.length < 2) return handle;
  fetchRoadPath(points).then(function (j) {
    if (handle.removed || !j.path || j.path.length < 2) return;
    const road = new kakao.maps.Polyline({
      path: j.path.map(function (p) { return new kakao.maps.LatLng(p[0], p[1]); }),
      strokeWeight: 5, strokeColor: color, strokeOpacity: 0.85
    });
    straight.setMap(null);
    road.setMap(map);
    handle.line = road;
    if (onResult) onResult(true, j);
  }).catch(function (e) {
    console.warn('도로 경로를 불러오지 못해 직선으로 표시해요:', e.message);
    if (onResult) onResult(false, null);
  });
  return handle;
}

// 지도 아래 안내 문구 (대중교통 여행은 자동차 도로 기준이라는 점을 알림)
function routeNoteText(transport, ok, info) {
  if (!ok) return '점선 = 장소 사이 직선 (도로 경로를 불러오지 못했어요)';
  const km = info ? ' · 도로 ' + (info.distance / 1000).toFixed(1) + 'km' : '';
  return transport === '자동차'
    ? '실선 = 자동차 도로 경로 (카카오모빌리티)' + km
    : '실선 = 도로 경로(자동차 기준, 카카오모빌리티)' + km + ' · 버스 노선·환승은 장소 카드의 \'카카오맵 길찾기\'에서 확인하세요';
}
