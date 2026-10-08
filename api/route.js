// Vercel 서버 함수: 지도에 그릴 실제 도로 경로 (카카오모빌리티 다중 경유지 길찾기 API를 대신 불러 줌)
// 입력: POST { points: [{ lat, lng }, ...] } — 2~32개, 방문 순서대로 (출발 → 경유지들 → 도착)
// 출력: { path: [[lat, lng], ...], distance(미터), duration(초), legs: [{ distance, duration }] } 또는 { error }
// 왜 서버 함수인가: 카카오 REST API 키는 화면 코드(브라우저)에 넣으면 누구나 보고 가져다 쓸 수 있어서,
//                   Vercel 환경 변수 KAKAO_REST_KEY에 숨겨 두고 이 함수만 사용함

const KAKAO_URL = 'https://apis-navi.kakaomobility.com/v1/waypoints/directions';
const ALLOWED_HOST = /^(tripmate-rouge\.vercel\.app|tripmate-[a-z0-9-]+\.vercel\.app|localhost(:\d+)?|127\.0\.0\.1(:\d+)?)$/;

function hostOf(url) { try { return new URL(url).host; } catch (e) { return ''; } }

// 지도에 그릴 점이 너무 많으면 고르게 덜어 냄 (모양은 거의 그대로, 응답 크기는 작게)
function thin(path, max) {
  if (path.length <= max) return path;
  const step = path.length / max, out = [];
  for (let i = 0; i < max; i++) out.push(path[Math.floor(i * step)]);
  out.push(path[path.length - 1]);
  return out;
}

module.exports = async function (req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 받아요' });
  const host = hostOf(req.headers.origin || req.headers.referer || '');
  if (!ALLOWED_HOST.test(host)) return res.status(403).json({ error: 'TripMate 화면에서만 쓸 수 있어요' });
  const key = process.env.KAKAO_REST_KEY;
  if (!key) return res.status(500).json({ error: 'KAKAO_REST_KEY 환경 변수가 없어요' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  const raw = body && Array.isArray(body.points) ? body.points : [];
  // 좌표 검사(대한민국 범위) + 바로 앞 점과 거의 같은 점(30m 안)은 빼기 — 카카오 API는 너무 가까운 두 점을 오류로 처리함
  const pts = [];
  raw.forEach(function (p) {
    const lat = Number(p.lat), lng = Number(p.lng);
    if (!(lat > 32 && lat < 39.5 && lng > 124 && lng < 132)) return;
    const prev = pts[pts.length - 1];
    if (prev && Math.abs(prev.lat - lat) < 0.0003 && Math.abs(prev.lng - lng) < 0.0003) return;
    pts.push({ lat: lat, lng: lng });
  });
  if (pts.length < 2) return res.status(200).json({ path: pts.map(function (p) { return [p.lat, p.lng]; }), distance: 0, duration: 0, legs: [] });
  if (pts.length > 32) return res.status(400).json({ error: '점은 32개까지만 돼요' });

  const xy = function (p) { return { x: p.lng, y: p.lat }; };
  const r = await fetch(KAKAO_URL, {
    method: 'POST',
    headers: { Authorization: 'KakaoAK ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ origin: xy(pts[0]), destination: xy(pts[pts.length - 1]),
                           waypoints: pts.slice(1, -1).map(xy), priority: 'RECOMMEND' })
  });
  const data = await r.json().catch(function () { return null; });
  const route = data && data.routes && data.routes[0];
  if (!r.ok || !route || route.result_code !== 0) {
    return res.status(502).json({ error: '길찾기 실패: ' + (route ? route.result_msg : (data && data.msg) || r.status) });
  }
  const path = [], legs = [];
  route.sections.forEach(function (sec) {
    legs.push({ distance: sec.distance, duration: sec.duration });
    sec.roads.forEach(function (road) {
      for (let i = 0; i + 1 < road.vertexes.length; i += 2) path.push([road.vertexes[i + 1], road.vertexes[i]]);
    });
  });
  res.setHeader('Cache-Control', 's-maxage=86400');
  return res.status(200).json({ path: thin(path, 4000), distance: route.summary.distance, duration: route.summary.duration, legs: legs });
};
