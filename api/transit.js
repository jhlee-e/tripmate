// Vercel 서버 함수: 장소 사이 대중교통(버스·지하철) 경로 (카카오맵 대중교통 경로 조회 API를 대신 불러 줌)
// 입력: POST { points: [{ lat, lng }, ...] — 2~16개, 방문 순서대로,
//              modes: ['walk' | 'transit' | null, ...] — 구간마다 사용자가 고른 이동 방법(null = 자동) }
// 출력: { legs: [ { mode: 'transit' | 'walk', time(초), distance(미터), fare(원), transfers, summary,
//                  steps: [{ type: 'BUS' | 'SUBWAY' | 'WALKING', name, path: [[lat, lng], ...] }] } ] }
//       구간마다 카카오 API를 한 번씩 부름. 걷기로 고른 구간·400m 미만 구간은 부르지 않고 '걷기'로 둠,
//       대중교통 경로가 없는 구간도 '걷기'(noTransit: true) — 걷는 길 모양은 화면에서 따로 받아 그림(js/road-route.js)
// 키: Vercel 환경 변수 KAKAO_REST_KEY (자동차 경로 api/route.js와 같은 REST API 키)

const KAKAO_URL = 'https://dapi.kakao.com/v2/routing/publictraffic';
const ALLOWED_HOST = /^(tripmate-rouge\.vercel\.app|tripmate-[a-z0-9-]+\.vercel\.app|localhost(:\d+)?|127\.0\.0\.1(:\d+)?)$/;
const WALK_ONLY_KM = 0.4;   // 이재훈 결정 (2026-10-09): 400m 미만은 걷기
const ICON = { BUS: '🚌', SUBWAY: '🚇', WALKING: '🚶' };

function hostOf(url) { try { return new URL(url).host; } catch (e) { return ''; } }
function km(a, b) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
// 응답 필드가 step.properties.x 에 있기도 하고 step.x 에 있기도 해서 둘 다 확인
function prop(o, k) { return o && o.properties && o.properties[k] != null ? o.properties[k] : (o ? o[k] : undefined); }

function walkLeg(a, b, noTransit) {
  const d = km(a, b) * 1000;
  return { mode: 'walk', noTransit: !!noTransit, time: Math.round(d / (4000 / 3600)), distance: Math.round(d), fare: 0, transfers: 0,
           summary: noTransit ? '🚶 걸어서 (대중교통 경로 없음)' : '🚶 걸어서',
           steps: [{ type: 'WALKING', name: '', path: [[a.lat, a.lng], [b.lat, b.lng]] }] };
}

async function transitLeg(key, a, b, mode) {
  if (mode === 'walk' || (mode !== 'transit' && km(a, b) < WALK_ONLY_KM)) return walkLeg(a, b);
  const url = KAKAO_URL + '?start_x=' + a.lng + '&start_y=' + a.lat + '&end_x=' + b.lng + '&end_y=' + b.lat;
  const r = await fetch(url, { headers: { Authorization: 'KakaoAK ' + key } });
  const data = await r.json().catch(function () { return null; });
  if (!r.ok || !data) throw new Error('카카오 대중교통 API 오류 ' + r.status + (data && data.message ? ' ' + data.message : ''));
  if (data.status !== 'OK' || !data.routes || !data.routes.length) return walkLeg(a, b, true);   // 대중교통 경로 없음 → 걷기
  // 가장 빨리 도착하는 경로
  const route = data.routes.slice().sort(function (x, y) { return prop(x, 'totalTime') - prop(y, 'totalTime'); })[0];
  const steps = (route.steps || []).map(function (s) {
    const type = prop(s, 'type');
    const vehicles = prop(s, 'vehicles') || [];
    const pts = (s.path && s.path.points) || [];
    return { type: type, name: vehicles.map(function (v) { return v.name; }).join('/'),
             path: pts.map(function (p) { return [p[1], p[0]]; }) };
  });
  const rides = steps.filter(function (s) { return s.type !== 'WALKING' && s.name; });
  const fare = prop(route, 'fare') || {};
  return {
    mode: rides.length ? 'transit' : 'walk', noTransit: !rides.length,
    time: prop(route, 'totalTime'), distance: prop(route, 'totalDistance'),
    fare: fare.value != null ? fare.value : 0, transfers: prop(route, 'transfers') || 0,
    summary: rides.length ? rides.map(function (s) { return ICON[s.type] + ' ' + s.name; }).join(' → ') : '🚶 걸어서',
    steps: steps
  };
}

module.exports = async function (req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 받아요' });
  if (!ALLOWED_HOST.test(hostOf(req.headers.origin || req.headers.referer || ''))) return res.status(403).json({ error: 'TripMate 화면에서만 쓸 수 있어요' });
  const key = process.env.KAKAO_REST_KEY;
  if (!key) return res.status(500).json({ error: 'KAKAO_REST_KEY 환경 변수가 없어요' });
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  const pts = (body && Array.isArray(body.points) ? body.points : []).map(function (p) { return { lat: Number(p.lat), lng: Number(p.lng) }; })
    .filter(function (p) { return p.lat > 32 && p.lat < 39.5 && p.lng > 124 && p.lng < 132; });
  if (pts.length < 2) return res.status(200).json({ legs: [] });
  if (pts.length > 16) return res.status(400).json({ error: '점은 16개까지만 돼요' });
  const modes = body && Array.isArray(body.modes) ? body.modes : [];
  try {
    const legs = [];
    for (let i = 0; i + 1 < pts.length; i++) legs.push(await transitLeg(key, pts[i], pts[i + 1], modes[i]));   // 순서대로 (한꺼번에 많이 부르지 않게)
    res.setHeader('Cache-Control', 's-maxage=21600');
    return res.status(200).json({ legs: legs });
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }
};
