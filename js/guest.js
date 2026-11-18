// 로그인 없이 일정 짜기 (피드백 반영 6차시, 엄기찬 댓글)
// 입력: 비로그인 상태에서 입력한 여행 조건·고른 일정 / 출력: 이 브라우저(localStorage)에 임시로 보관한 여행 한 건
//       여행 번호 대신 'guest'를 써서 조건 입력 → 여행지 추천 → 일정안 비교 → 일정 상세까지 DB 없이 진행
//       '저장'·준비물·공유처럼 DB가 필요한 기능은 로그인 화면으로 보내고, 로그인하면 짜던 여행을 DB로 옮김(moveGuestTrip)

const GUEST_ID = 'guest';
const GUEST_KEY = 'tripmate-guest';   // { trip: trips 행 모양, rows: trip_places 행 모양 배열 | null }

function isGuestTrip(tripOrId) {
  const id = tripOrId && typeof tripOrId === 'object' ? tripOrId.id : tripOrId;
  return String(id) === GUEST_ID;
}

function readGuest() {
  try { return JSON.parse(localStorage.getItem(GUEST_KEY) || 'null'); } catch (e) { return null; }
}

function writeGuest(data) {
  try { localStorage.setItem(GUEST_KEY, JSON.stringify(data)); return true; } catch (e) { console.warn(e); return false; }
}

// 조건 입력에서 만든 여행 → 임시 보관 (예전 임시 여행은 덮어씀: 비로그인 여행은 하나만 보관)
function saveGuestTrip(row) {
  const trip = Object.assign({}, row, { id: GUEST_ID, user_id: null, created_at: new Date().toISOString(),
    jitter_seed: 'g' + Date.now() });   // 추천 점수 ±10% 랜덤의 씨앗 (같은 여행은 고정, recommend.js regionJitter)
  writeGuest({ trip: trip, rows: null });
  return trip;
}

// 임시 여행의 일부 열만 바꾸기 (꼭 갈 명소, 고른 일정 등)
function updateGuestTrip(fields) {
  const g = readGuest();
  if (!g) return null;
  Object.assign(g.trip, fields);
  writeGuest(g);
  return g.trip;
}

function saveGuestRows(rows) {
  const g = readGuest();
  if (!g) return;
  g.rows = rows;
  writeGuest(g);
}

// 지금 로그인했는지 (화면을 막지 않고 확인만) / 출력: 사용자 객체 또는 null
async function currentUser() {
  const { data } = await sb.auth.getSession();
  return data.session ? data.session.user : null;
}

// 위쪽 메뉴: 비로그인이면 닉네임 자리에 '로그인 안 함'과 로그인 링크, 로그아웃 버튼은 숨김
function showGuestNav(nextUrl) {
  const el = document.getElementById('nav-user');
  if (el) el.innerHTML = '로그인 안 함 · <a href="index.html' + (nextUrl ? '?next=' + encodeURIComponent(nextUrl) : '') + '">로그인</a>';
  document.querySelectorAll('.top-nav [onclick="logout()"]').forEach(function (b) { b.hidden = true; });
  document.querySelectorAll('.top-nav a[href="record.html"]').forEach(function (a) { a.hidden = true; });
}

// 로그인이 필요한 기능을 눌렀을 때: 짜던 내용은 그대로 두고 로그인 화면으로
function askLogin(what) {
  if (confirm((what || '이 기능') + '은(는) 로그인해야 쓸 수 있어요.\n지금까지 짠 일정은 이 브라우저에 남아 있고, 로그인하면 내 여행으로 옮겨져요.\n로그인 화면으로 갈까요?')) {
    location.href = 'index.html?next=' + encodeURIComponent('guest');
  }
}

// 로그인 직후 호출: 임시 여행이 있으면 trips·trip_places에 저장하고 임시 보관을 지움
// 입력: 없음(localStorage) / 출력: 옮긴 여행으로 갈 주소 (옮길 게 없으면 null)
async function moveGuestTrip() {
  const g = readGuest();
  if (!g || !g.trip) return null;
  const row = Object.assign({}, g.trip);
  ['id', 'user_id', 'created_at', 'updated_at', 'jitter_seed', 'group'].forEach(function (k) { delete row[k]; });
  const ins = await sb.from('trips').insert(row).select().single();
  if (ins.error) { console.error('비로그인 여행을 옮기지 못했어요', ins.error); return null; }
  const id = ins.data.id;
  if (g.rows && g.rows.length) {
    const rows = g.rows.map(function (r) { return Object.assign({}, r, { trip_id: id }); });
    const res = await sb.from('trip_places').insert(rows);
    if (res.error) { console.error('비로그인 일정 장소를 옮기지 못했어요', res.error); return 'detail.html?trip=' + id; }
    try { localStorage.removeItem(GUEST_KEY); } catch (e) {}
    return 'trip.html?trip=' + id + '&moved=1';
  }
  try { localStorage.removeItem(GUEST_KEY); } catch (e) {}
  // 아직 일정을 고르지 않았으면 고르던 단계로
  return row.region ? 'plans.html?trip=' + id + '&region=' + encodeURIComponent(row.region) : 'result.html?trip=' + id;
}
