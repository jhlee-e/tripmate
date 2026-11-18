// Vercel 서버 함수: 날씨 예보 (Open-Meteo 예보 API를 대신 불러 줌) — 피드백 반영 6차시
// 입력: GET ?lat=37.7,35.8&lng=128.9,129.2&start=YYYY-MM-DD&end=YYYY-MM-DD (좌표 여러 개는 쉼표로, 최대 40곳)
// 출력: Open-Meteo 응답 그대로 (좌표 1곳이면 객체, 여러 곳이면 배열) 또는 { error }
// 왜 서버 함수인가: 일부 네트워크(학교·앱 안 브라우저 등)에서 api.open-meteo.com에 바로 접속이 안 돼
//                   (2026-11-18 시험에서 시간 초과) 우리 사이트 주소를 거쳐 받도록 함. 같은 요청은 1시간 동안 Vercel이 기억함

const ALLOWED_HOST = /^(tripmate-rouge\.vercel\.app|tripmate-[a-z0-9-]+\.vercel\.app|localhost(:\d+)?|127\.0\.0\.1(:\d+)?)$/;
function hostOf(url) { try { return new URL(url).host; } catch (e) { return ''; } }
const NUMS = /^-?\d+(\.\d+)?(,-?\d+(\.\d+)?){0,39}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

module.exports = async function (req, res) {
  const host = hostOf(req.headers.origin || req.headers.referer || '');
  if (host && !ALLOWED_HOST.test(host)) return res.status(403).json({ error: 'TripMate 화면에서만 쓸 수 있어요' });
  const q = req.query || {};
  if (!NUMS.test(q.lat || '') || !NUMS.test(q.lng || '') || !DATE.test(q.start || '') || !DATE.test(q.end || '')) {
    return res.status(400).json({ error: 'lat·lng·start·end를 확인해 주세요' });
  }
  const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + q.lat + '&longitude=' + q.lng +
    '&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,uv_index_max' +
    '&timezone=Asia%2FSeoul&start_date=' + q.start + '&end_date=' + q.end;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(function () { ctrl.abort(); }, 8000);
    const r = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    const j = await r.json();
    if (!r.ok) return res.status(502).json({ error: 'Open-Meteo 오류', detail: j });
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=600');
    return res.status(200).json(j);
  } catch (e) {
    return res.status(504).json({ error: '예보 서버가 답하지 않아요' });
  }
};
