// 지도 경로선을 실제 길을 따라 그리기 (여행 정보·일정 상세 화면에서 사용)
// 입력: 카카오 지도, 방문 순서대로의 점들 [{ lat, lng }], 선 색, 이동 수단('자동차' | '대중교통')
// 출력: 먼저 점선(직선)을 그리고, 서버 함수가 경로를 돌려주면 바꿔 그림. 실패하면 직선 그대로 둠
//       자동차   → /api/route   (카카오모빌리티 길찾기): 도로를 따라 실선
//       대중교통 → /api/transit (카카오맵 대중교통 경로): 버스·지하철 구간은 실선, 걷는 구간은 회색 점선
//                  + 구간별 안내(🚌 102 → 🚇 2호선 · 25분 · 1,500원)를 legInfo에 모아 장소 카드에 보여 줌
//                  걷기 구간(400m 미만·사용자가 걷기로 고름·대중교통 없음)은 걷는 길을 따로 받아 그림:
//                  FOSSGIS 도보 경로 서버(OpenStreetMap 자료, 무료·키 없음, 1초에 1번까지) — 이 창에서 차례로 1초 간격으로 부름
//       같은 점들의 경로는 이 창(sessionStorage)에 기억해 두어 다시 그릴 때 또 부르지 않음

const routeMemo = {};

const legInfo = {};   // '위도,경도'(도착 장소) → 그 장소까지 오는 대중교통 구간 정보

function pointKey(p) { return p.lat.toFixed(5) + ',' + p.lng.toFixed(5); }

function routeKey(points, api) {
  return api + ':' + points.map(function (p) { return p.lat.toFixed(5) + ',' + p.lng.toFixed(5); }).join('|');
}

async function fetchRoadPath(points, api, modes) {
  api = api || '/api/route';
  const key = routeKey(points, api) + (modes ? '|' + modes.join(',') : '');
  if (routeMemo[key]) return routeMemo[key];
  try { const saved = sessionStorage.getItem(key); if (saved) return (routeMemo[key] = JSON.parse(saved)); } catch (e) {}
  routeMemo[key] = fetch(api, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ points: points.map(function (p) { return { lat: p.lat, lng: p.lng }; }), modes: modes || [] })
  }).then(function (r) {
    return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || r.status); return j; });
  }).then(function (j) {
    try { sessionStorage.setItem(key, JSON.stringify(j)); } catch (e) {}
    return j;
  }).catch(function (e) { delete routeMemo[key]; throw e; });
  return routeMemo[key];
}

// ---------- 걷는 길 (FOSSGIS OSRM 도보 경로) ----------
// 입력: 출발·도착 { lat, lng } / 출력: [[lat, lng], ...] 걷는 길 좌표 (실패하면 null)
const walkQueue = [];
let walkBusy = false;
function fetchWalkPath(a, b) {
  const key = 'walk:' + pointKey(a) + '>' + pointKey(b);
  if (routeMemo[key]) return routeMemo[key];
  try { const saved = sessionStorage.getItem(key); if (saved) return (routeMemo[key] = Promise.resolve(JSON.parse(saved))); } catch (e) {}
  routeMemo[key] = new Promise(function (resolve) {
    walkQueue.push(function () {
      const url = 'https://routing.openstreetmap.de/routed-foot/route/v1/foot/' + a.lng + ',' + a.lat + ';' + b.lng + ',' + b.lat +
                  '?overview=full&geometries=geojson';
      return fetch(url).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
        const coords = j && j.routes && j.routes[0] && j.routes[0].geometry.coordinates;
        const path = coords ? coords.map(function (c) { return [c[1], c[0]]; }) : null;
        if (path) { try { sessionStorage.setItem(key, JSON.stringify(path)); } catch (e) {} }
        resolve(path);
      }).catch(function () { resolve(null); });
    });
    runWalkQueue();
  });
  return routeMemo[key];
}
function runWalkQueue() {   // 서버 이용 규칙: 1초에 1번까지 → 하나 끝나면 1초 쉬고 다음
  if (walkBusy || !walkQueue.length) return;
  walkBusy = true;
  walkQueue.shift()().then(function () {
    setTimeout(function () { walkBusy = false; runWalkQueue(); }, 1000);
  });
}

// 반환: { remove() } — 화면을 다시 그릴 때 remove()로 지움
function drawRoute(map, points, color, onResult, transport, modes) {
  const lines = [];
  function line(path, opt) {
    const l = new kakao.maps.Polyline(Object.assign({ path: path.map(function (p) { return new kakao.maps.LatLng(p[0], p[1]); }) }, opt));
    l.setMap(handle.hidden ? null : map);   // 숨긴 날이면 나중에 그려지는 선도 숨긴 채로
    lines.push(l);
    return l;
  }
  // 숨기기·보이기 (여행 정보 화면에서 한 날짜만 보기 — 2026-10-10)
  const handle = { removed: false, hidden: false,
    remove: function () { this.removed = true; lines.forEach(function (l) { l.setMap(null); }); },
    setVisible: function (v) { this.hidden = !v; lines.forEach(function (l) { l.setMap(v ? map : null); }); } };
  line(points.map(function (p) { return [p.lat, p.lng]; }), { strokeWeight: 3, strokeColor: color, strokeOpacity: 0.6, strokeStyle: 'shortdash' });
  if (points.length < 2) {   // 그릴 구간이 없어도 '끝났음'은 알려 줌 (여러 날을 기다리는 화면을 위해)
    if (onResult) setTimeout(function () { onResult(true, { distance: 0, legs: [] }); });
    return handle;
  }
  function clear() { lines.splice(0).forEach(function (l) { l.setMap(null); }); }
  const WALK_STYLE = { strokeWeight: 4, strokeColor: '#666', strokeOpacity: 0.85, strokeStyle: 'shortdot' };

  if (transport === '대중교통') {
    fetchRoadPath(points, '/api/transit', modes).then(function (j) {
      if (handle.removed || !j.legs || !j.legs.length) return;
      clear();
      let learned = 0;   // 이번에 새로 알게 된 실제 대중교통 구간 수 → 화면이 시간표를 다시 계산할지 판단
      j.legs.forEach(function (leg, i) {
        legInfo[pointKey(points[i + 1])] = leg;
        if (typeof transitLegs !== 'undefined' && (leg.mode === 'transit' || leg.noTransit)) {
          const k = legKey(points[i], points[i + 1]);
          if (!transitLegs[k]) learned++;
          transitLegs[k] = { time: leg.time, fare: leg.fare, noTransit: !!leg.noTransit };
        }
        if (leg.mode === 'walk') {
          // 걷기 구간: 먼저 직선 점선, 걷는 길을 받으면 그 길로 바꿈
          const tmp = line([[points[i].lat, points[i].lng], [points[i + 1].lat, points[i + 1].lng]], WALK_STYLE);
          fetchWalkPath(points[i], points[i + 1]).then(function (path) {
            if (handle.removed || !path || path.length < 2) return;
            tmp.setMap(null);
            if (lines.indexOf(tmp) !== -1) lines.splice(lines.indexOf(tmp), 1);   // 다시 보이기 할 때 직선이 살아나지 않게
            line(path, WALK_STYLE);
          });
          return;
        }
        leg.steps.forEach(function (st) {
          if (st.path.length < 2) return;
          if (st.type === 'WALKING') line(st.path, WALK_STYLE);
          else line(st.path, { strokeWeight: st.type === 'SUBWAY' ? 6 : 5, strokeColor: color, strokeOpacity: 0.85 });
        });
      });
      // 같은 결과(j)는 다음 그리기 때 재사용되므로 j에 직접 적지 않고 복사본에 learned를 담아 넘김
      if (onResult) onResult(true, Object.assign({}, j, { learned: learned }));
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
    return '실선 = 버스·지하철 (카카오맵 대중교통 경로), 회색 점선 = 걷기 (도보 경로 © OpenStreetMap 기여자, FOSSGIS) · 장소를 누르면 타는 노선이 나와요';
  }
  const km = info && info.distance ? ' · 도로 ' + (info.distance / 1000).toFixed(1) + 'km' : '';
  return '실선 = 자동차 도로 경로 (카카오모빌리티)' + km;
}
