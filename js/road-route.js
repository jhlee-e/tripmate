// 지도 경로선을 실제 길을 따라 그리기 (여행 정보·일정 상세 화면에서 사용)
// 입력: 카카오 지도, 방문 순서대로의 점들 [{ lat, lng }], 선 색, 이동 수단('자동차' | '대중교통')
// 출력: 먼저 점선(직선)을 그리고, 서버 함수가 경로를 돌려주면 바꿔 그림. 실패하면 직선 그대로 둠
//       자동차   → /api/route   (카카오모빌리티 길찾기): 도로를 따라 실선
//       대중교통 → /api/transit (카카오맵 대중교통 경로): 버스·지하철 구간은 실선, 걷는 구간은 회색 점선
//                  + 구간별 안내(🚌 102 → 🚇 2호선 · 25분 · 1,500원)를 legInfo에 모아 장소 카드에 보여 줌
//       같은 점들의 경로는 이 창(sessionStorage)에 기억해 두어 다시 그릴 때 또 부르지 않음

const routeMemo = {};

const legInfo = {};   // '위도,경도'(도착 장소) → 그 장소까지 오는 대중교통 구간 정보

function pointKey(p) { return p.lat.toFixed(5) + ',' + p.lng.toFixed(5); }

function routeKey(points, api) {
  return api + ':' + points.map(function (p) { return p.lat.toFixed(5) + ',' + p.lng.toFixed(5); }).join('|');
}

async function fetchRoadPath(points, api) {
  api = api || '/api/route';
  const key = routeKey(points, api);
  if (routeMemo[key]) return routeMemo[key];
  try { const saved = sessionStorage.getItem(key); if (saved) return (routeMemo[key] = JSON.parse(saved)); } catch (e) {}
  routeMemo[key] = fetch(api, {
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

// 반환: { remove() } — 화면을 다시 그릴 때 remove()로 지움
function drawRoute(map, points, color, onResult, transport) {
  const lines = [];
  function line(path, opt) {
    const l = new kakao.maps.Polyline(Object.assign({ path: path.map(function (p) { return new kakao.maps.LatLng(p[0], p[1]); }) }, opt));
    l.setMap(map);
    lines.push(l);
  }
  line(points.map(function (p) { return [p.lat, p.lng]; }), { strokeWeight: 3, strokeColor: color, strokeOpacity: 0.6, strokeStyle: 'shortdash' });
  const handle = { removed: false, remove: function () { this.removed = true; lines.forEach(function (l) { l.setMap(null); }); } };
  if (points.length < 2) return handle;
  function clear() { lines.splice(0).forEach(function (l) { l.setMap(null); }); }

  if (transport === '대중교통') {
    fetchRoadPath(points, '/api/transit').then(function (j) {
      if (handle.removed || !j.legs || !j.legs.length) return;
      clear();
      j.legs.forEach(function (leg, i) {
        legInfo[pointKey(points[i + 1])] = leg;
        leg.steps.forEach(function (st) {
          if (st.path.length < 2) return;
          if (st.type === 'WALKING') line(st.path, { strokeWeight: 3, strokeColor: '#888', strokeOpacity: 0.8, strokeStyle: 'shortdot' });
          else line(st.path, { strokeWeight: st.type === 'SUBWAY' ? 6 : 5, strokeColor: color, strokeOpacity: 0.85 });
        });
      });
      if (onResult) onResult(true, j);
    }).catch(function (e) {
      console.warn('대중교통 경로를 불러오지 못해 직선으로 표시해요:', e.message);
      if (onResult) onResult(false, null);
    });
    return handle;
  }

  fetchRoadPath(points).then(function (j) {
    if (handle.removed || !j.path || j.path.length < 2) return;
    clear();
    line(j.path, { strokeWeight: 5, strokeColor: color, strokeOpacity: 0.85 });
    if (onResult) onResult(true, j);
  }).catch(function (e) {
    console.warn('도로 경로를 불러오지 못해 직선으로 표시해요:', e.message);
    if (onResult) onResult(false, null);
  });
  return handle;
}

// 장소 카드에 붙일 '앞 장소에서 오는 길' (대중교통 여행에서 경로를 받아 온 뒤에만)
function legInfoHtml(p) {
  const leg = legInfo[pointKey(p)];
  if (!leg) return '';
  return '<p class="helper-text leg-info">앞 장소에서 오는 길: ' + esc(leg.summary) +
    ' · 약 ' + Math.max(1, Math.round(leg.time / 60)) + '분' + (leg.fare ? ' · 1인 ' + won(leg.fare) : '') +
    (leg.transfers ? ' · 환승 ' + leg.transfers + '번' : '') + '</p>';
}

// 지도 아래 안내 문구 (대중교통 여행은 자동차 도로 기준이라는 점을 알림)
function routeNoteText(transport, ok, info) {
  if (!ok) return '점선 = 장소 사이 직선 (경로를 불러오지 못했어요)';
  if (transport === '대중교통') {
    return '실선 = 버스·지하철, 회색 점선 = 걷기 (카카오맵 대중교통 경로) · 장소를 누르면 타는 노선이 나와요';
  }
  const km = info && info.distance ? ' · 도로 ' + (info.distance / 1000).toFixed(1) + 'km' : '';
  return '실선 = 자동차 도로 경로 (카카오모빌리티)' + km;
}
