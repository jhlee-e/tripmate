// 함께 정하기 화면 (7차시)
// 입력: 주소의 ?trip=여행번호(&region=지역&direct=1), 로그인 정보, 사람들이 고른 취향 태그
// 출력: trip_prefs 표에 사람별 취향 저장(자기 것 / 대신 입력), 모인 취향 목록 표시,
//       만든 사람이 '추천받기'를 누르면 여행지 추천(result.html) 또는 고른 지역의 일정안 비교(plans.html)로 이동
//       점수 계산은 js/recommend.js의 regionTagScore·placeTagScore·groupFirstTags

const TAGS = [['힐링', '🌿 힐링·자연'], ['역사', '🏯 역사·문화'], ['액티브', '🏄 액티브·체험'], ['미식', '🍜 미식'], ['쇼핑', '🛍️ 쇼핑']];
const TAG_NAME = {};
TAGS.forEach(function (t) { TAG_NAME[t[0]] = t[1]; });

let trip = null, role = null, me = null;

// 태그 고르기 버튼 묶음 (condition.html과 같은 방식: 누른 순서 = 순위)
// 입력: 버튼을 넣을 칸, 처음 선택 / 출력: { get(): 선택 배열, set(배열) }
function makeTagPicker(box, initial) {
  let picked = (initial || []).slice();
  box.innerHTML = '';
  TAGS.forEach(function (t) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'chip'; b.dataset.value = t[0]; b.textContent = t[1];
    b.addEventListener('click', function () {
      const i = picked.indexOf(t[0]);
      if (i === -1) picked.push(t[0]); else picked.splice(i, 1);
      draw();
    });
    box.appendChild(b);
  });
  function draw() {
    box.querySelectorAll('.chip').forEach(function (b) {
      const o = picked.indexOf(b.dataset.value);
      const old = b.querySelector('.order-badge');
      if (old) old.remove();
      b.classList.toggle('selected', o !== -1);
      b.classList.toggle('first', o === 0);
      if (o !== -1) { const s = document.createElement('span'); s.className = 'order-badge'; s.textContent = o + 1; b.prepend(s); }
    });
  }
  draw();
  return { get: function () { return picked.slice(); }, set: function (a) { picked = a.slice(); draw(); } };
}

function tagText(tags) {
  if (!tags || !tags.length) return '<span class="muted">아직 안 골랐어요</span>';
  return tags.map(function (t, i) { return (i === 0 ? '①' : '') + esc(TAG_NAME[t] || t); }).join(' ');
}

async function start() {
  trip = await loadTripFromUrl();
  const status = document.getElementById('status');
  if (!trip) { status.textContent = '여행 정보를 찾을 수 없어요.'; return; }
  if (!trip.together) {
    status.innerHTML = '함께 정하기로 만든 여행이 아니에요. <a href="trip.html?trip=' + trip.id + '">여행 정보로 가기</a>';
    return;
  }
  role = await tripRole(trip);
  const { data } = await sb.auth.getSession();
  me = data.session.user.id;
  document.getElementById('trip-summary').textContent = tripSummary(trip);
  rememberRegion();
  status.textContent = '';
  document.getElementById('together-body').hidden = false;

  setupInvite();
  await setupMine();
  if (role === 'owner' || role === 'editor') setupProxy();
  setupGo();
  await refresh();
  // 친구가 들어오는 걸 보려고 10초마다 목록을 새로 읽음 (화면을 보고 있을 때만)
  setInterval(function () { if (!document.hidden) refresh(); }, 10000);
}

// 지역을 직접 고른 함께 정하기: 이 화면을 다시 열어도 지역이 남아 있게 브라우저에 기억 (Claude 판단)
function rememberRegion() {
  const key = 'tripmate-together-region-' + trip.id;
  try {
    if (param('direct') && param('region')) localStorage.setItem(key, param('region'));
    trip._directRegion = param('region') || localStorage.getItem(key);
  } catch (e) { trip._directRegion = param('region'); }
}

// ---------- 1. 초대 링크 (만든 사람만 만들 수 있음, 링크로 들어온 친구는 '함께 편집') ----------
async function setupInvite() {
  const box = document.getElementById('invite-box');
  const msg = document.getElementById('invite-msg');
  if (role !== 'owner') {
    box.innerHTML = '<p class="helper-text muted">아래에서 내 취향을 골라 저장해 주세요. 만든 사람이 \'추천받기\'를 누르면 일정이 정해져요.</p>';
    return;
  }
  if (!trip.invite_code) {
    const code = makeInviteCode();
    const { error } = await sb.from('trips').update({ invite_code: code, invite_role: 'editor' }).eq('id', trip.id);
    if (error) { box.innerHTML = '<p class="error-text">초대 링크를 만들지 못했어요: ' + esc(error.message) + '</p>'; return; }
    trip.invite_code = code; trip.invite_role = 'editor';
  }
  box.innerHTML = '<div class="invite-row"><input type="text" id="invite-url" readonly>' +
    '<button type="button" class="small-btn" id="invite-copy">복사</button></div>' +
    '<p class="helper-text muted">같이 가는 친구에게 보내면, 친구가 로그인한 뒤 이 화면에서 자기 취향을 고를 수 있어요. ' +
    '(링크로 들어온 친구의 권한: ' + ROLE_NAME[trip.invite_role || 'editor'] + ')</p>';
  const input = document.getElementById('invite-url');
  input.value = inviteUrl(trip.invite_code);
  input.addEventListener('focus', function () { input.select(); });
  document.getElementById('invite-copy').addEventListener('click', async function () {
    try { await navigator.clipboard.writeText(input.value); msg.textContent = '링크를 복사했어요.'; }
    catch (e) { input.select(); msg.textContent = '자동 복사가 안 돼요. 선택된 링크를 Ctrl+C로 복사해 주세요.'; }
  });
}

// ---------- 2. 내 취향 ----------
// 만든 사람: trips.tags를 고침 / 친구: trip_prefs에 내 줄을 넣거나 고침
async function setupMine() {
  let mine = trip.tags;
  if (role !== 'owner') {
    const res = await sb.from('trip_prefs').select('tags').eq('trip_id', trip.id).eq('user_id', me).maybeSingle();
    mine = res.data ? res.data.tags : [];
  }
  const picker = makeTagPicker(document.getElementById('my-tags'), mine);
  const msg = document.getElementById('my-msg');
  document.getElementById('my-save').addEventListener('click', async function () {
    const tags = picker.get();
    if (!tags.length) { msg.textContent = '취향을 한 개 이상 골라 주세요.'; return; }
    const res = role === 'owner'
      ? await sb.from('trips').update({ tags: tags }).eq('id', trip.id)
      : await sb.from('trip_prefs').upsert({ trip_id: trip.id, user_id: me, tags: tags }, { onConflict: 'trip_id,user_id' });
    if (res.error) return showError(res.error);
    if (role === 'owner') trip.tags = tags;
    msg.textContent = '저장했어요.';
    refresh();
  });
}

// ---------- 3. 대신 입력 ----------
function setupProxy() {
  document.getElementById('proxy-card').hidden = false;
  const picker = makeTagPicker(document.getElementById('proxy-tags'), []);
  const nameInput = document.getElementById('proxy-name');
  const msg = document.getElementById('proxy-msg');
  document.getElementById('proxy-add').addEventListener('click', async function () {
    const name = nameInput.value.trim();
    const tags = picker.get();
    if (!name) { msg.textContent = '친구 이름을 적어 주세요.'; return; }
    if (!tags.length) { msg.textContent = '취향을 한 개 이상 골라 주세요.'; return; }
    const { error } = await sb.from('trip_prefs').insert({ trip_id: trip.id, user_id: null, name: name, tags: tags });
    if (error) return showError(error);
    nameInput.value = ''; picker.set([]);
    msg.textContent = name + '님 취향을 넣었어요.';
    refresh();
  });
}

// ---------- 모인 취향 목록 ----------
async function refresh() {
  const [prefs, members] = await Promise.all([
    sb.from('trip_prefs').select('id,user_id,name,tags,created_at').eq('trip_id', trip.id).order('created_at'),
    sb.from('trip_members').select('user_id,created_at').eq('trip_id', trip.id).order('created_at')
  ]);
  if (prefs.error) {
    document.getElementById('error-text').textContent = '함께 정하기를 쓰려면 Supabase에서 sql/add_together.sql을 먼저 실행해 주세요.';
    console.warn(prefs.error);
    return;
  }
  const t = await sb.from('trips').select('tags').eq('id', trip.id).single();   // 만든 사람이 취향을 바꿨을 수 있음
  if (t.data) trip.tags = t.data.tags;
  const memberIds = (members.data || []).map(function (m) { return m.user_id; });
  const ids = [trip.user_id].concat(memberIds);
  const u = await sb.from('users').select('id,nickname').in('id', ids);
  const names = {};
  (u.data || []).forEach(function (x) { names[x.id] = x.nickname; });
  const byUser = {};
  prefs.data.forEach(function (p) { if (p.user_id) byUser[p.user_id] = p; });

  const list = document.getElementById('pref-list');
  list.innerHTML = '';
  let ready = 0, total = 0;
  function row(name, tags, note, onDelete) {
    total++;
    if (tags && tags.length) ready++;
    const li = document.createElement('li');
    li.className = 'member-item';
    li.innerHTML = '<span class="mb-name"></span><span class="mb-role">' + tagText(tags) + '</span>';
    li.querySelector('.mb-name').textContent = name + (note ? ' ' + note : '');
    if (onDelete) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'link-btn danger-link'; b.textContent = '빼기';
      b.addEventListener('click', onDelete);
      li.querySelector('.mb-role').appendChild(b);
    }
    list.appendChild(li);
  }
  row(names[trip.user_id] || '만든 사람', trip.tags, '(만든 사람' + (trip.user_id === me ? ', 나)' : ')'));
  memberIds.forEach(function (id) {
    const p = byUser[id];
    row(names[id] || '친구', p ? p.tags : [], id === me ? '(나)' : '(링크)');
  });
  const canEdit = role === 'owner' || role === 'editor';
  prefs.data.filter(function (p) { return !p.user_id; }).forEach(function (p) {
    row(p.name || '친구', p.tags, '(대신 입력)', canEdit ? async function () {
      if (!confirm((p.name || '친구') + '님 취향을 뺄까요?')) return;
      const { error } = await sb.from('trip_prefs').delete().eq('id', p.id);
      if (error) return showError(error);
      refresh();
    } : null);
  });
  document.getElementById('count-text').textContent = total + '명 중 ' + ready + '명 입력';
  trip._ready = ready; trip._total = total;
}

// ---------- 추천받기 (만든 사람만) ----------
function setupGo() {
  if (role !== 'owner') {
    const w = document.getElementById('wait-text');
    w.hidden = false;
    w.innerHTML = '만든 사람이 추천받기를 누르면 일정이 정해져요. <a href="trip.html?trip=' + trip.id + '">여행 정보로 가기</a>';
    return;
  }
  const btn = document.getElementById('go-btn');
  btn.hidden = false;
  if (trip._directRegion) btn.textContent = '모두 모였어요 — ' + trip._directRegion + ' 일정 추천받기';
  btn.addEventListener('click', async function () {
    await refresh();
    if (trip._ready < 2 && !confirm('아직 취향을 입력한 사람이 ' + trip._ready + '명뿐이에요. 이대로 추천받을까요? (혼자 여행처럼 계산돼요)')) return;
    if (trip._ready < trip._total && trip._ready >= 2 &&
        !confirm('아직 취향을 안 고른 사람이 ' + (trip._total - trip._ready) + '명 있어요. 고른 사람들만으로 추천받을까요?')) return;
    location.href = trip._directRegion
      ? 'plans.html?trip=' + trip.id + '&region=' + encodeURIComponent(trip._directRegion) + '&direct=1'
      : 'result.html?trip=' + trip.id;
  });
}

start();
