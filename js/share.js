// 함께 여행할 친구 — 초대 링크로 여행을 공유하고 함께 편집 (여행 정보 화면 trip.html에서 사용)
// 입력: 여행(trips 행), 내 권한('owner' | 'editor' | 'viewer'), 만든 사람이 누른 링크 만들기·끊기·권한 바꾸기·내보내기
// 출력: trips.invite_code·invite_role, trip_members 표를 고치고 '함께하는 사람' 목록을 그림
//       친구는 링크(join.html?code=…)를 열고 로그인하면 이 여행의 멤버가 됨 (sql/add_share.sql의 join_trip 함수)

const ROLE_NAME = { owner: '만든 사람', editor: '함께 편집', viewer: '보기만' };

// 추측하기 어려운 초대 코드 12자리 (영문 소문자 + 숫자)
function makeInviteCode() {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
  const buf = new Uint32Array(12);
  crypto.getRandomValues(buf);
  return Array.from(buf, function (n) { return chars[n % chars.length]; }).join('');
}

function inviteUrl(code) { return location.origin + '/join.html?code=' + code; }

async function setupTripShare(trip, role) {
  const card = document.getElementById('friends-card');
  const owner = role === 'owner';
  const linkBox = document.getElementById('invite-box');
  const msg = document.getElementById('invite-msg');
  card.hidden = false;

  // ---------- 함께하는 사람 목록 ----------
  async function loadMembers() {
    const res = await sb.from('trip_members').select('user_id,role,created_at').eq('trip_id', trip.id).order('created_at');
    if (res.error) {   // add_share.sql을 아직 실행하지 않았으면 trip_members 표가 없음
      card.querySelector('.friends-body').innerHTML = '<p class="helper-text muted">공유 기능을 쓰려면 Supabase에서 sql/add_share.sql을 먼저 실행해 주세요.</p>';
      console.warn(res.error);
      return;
    }
    const ids = [trip.user_id].concat(res.data.map(function (m) { return m.user_id; }));
    const u = await sb.from('users').select('id,nickname').in('id', ids);
    const names = {};
    (u.data || []).forEach(function (x) { names[x.id] = x.nickname; });
    const { data: auth } = await sb.auth.getUser();
    const me = auth.user.id;

    const list = document.getElementById('member-list');
    list.innerHTML = '';
    function row(userId, r) {
      const li = document.createElement('li');
      li.className = 'member-item';
      li.innerHTML = '<span class="mb-name"></span><span class="mb-role"></span>';
      li.querySelector('.mb-name').textContent = (names[userId] || '여행자') + (userId === me ? ' (나)' : '');
      const roleBox = li.querySelector('.mb-role');
      if (owner && r !== 'owner') {
        roleBox.innerHTML = '<select><option value="editor">함께 편집</option><option value="viewer">보기만</option></select>' +
                            '<button type="button" class="link-btn danger-link">내보내기</button>';
        const sel = roleBox.querySelector('select');
        sel.value = r;
        sel.addEventListener('change', async function () {
          const { error } = await sb.from('trip_members').update({ role: sel.value }).eq('trip_id', trip.id).eq('user_id', userId);
          if (error) { sel.value = r; return showError(error); }
          r = sel.value;
          msg.textContent = names[userId] + '님 권한을 \'' + ROLE_NAME[r] + '\'(으)로 바꿨어요.';
        });
        roleBox.querySelector('button').addEventListener('click', async function () {
          if (!confirm(names[userId] + '님을 이 여행에서 내보낼까요?')) return;
          const { error } = await sb.from('trip_members').delete().eq('trip_id', trip.id).eq('user_id', userId);
          if (error) return showError(error);
          loadMembers();
        });
      } else {
        roleBox.textContent = ROLE_NAME[r];
      }
      list.appendChild(li);
    }
    row(trip.user_id, 'owner');
    res.data.forEach(function (m) { row(m.user_id, m.role); });
    document.getElementById('member-empty').hidden = res.data.length > 0 || !owner;
  }

  // ---------- 초대 링크 (만든 사람만) ----------
  function renderLink() {
    if (!owner) {
      linkBox.innerHTML = '<p class="helper-text muted">' + (role === 'viewer'
        ? '보기만 할 수 있는 여행이에요. 일정·준비물을 고치려면 만든 사람에게 \'함께 편집\' 권한을 부탁하세요.'
        : '이 여행의 조건·일정·준비물을 함께 고칠 수 있어요. 고친 내용은 모두에게 바로 보여요.') + '</p>';
      return;
    }
    if (!trip.invite_code) {
      linkBox.innerHTML = '<div class="invite-row"><select id="invite-role"><option value="editor">함께 편집</option><option value="viewer">보기만</option></select>' +
        '<button type="button" class="small-btn" id="invite-make">초대 링크 만들기</button></div>';
      document.getElementById('invite-make').addEventListener('click', function () {
        saveLink(makeInviteCode(), document.getElementById('invite-role').value);
      });
      return;
    }
    linkBox.innerHTML = '<div class="invite-row"><input type="text" id="invite-url" readonly>' +
      '<button type="button" class="small-btn" id="invite-copy">복사</button></div>' +
      '<p class="helper-text muted">링크로 들어온 친구의 권한: <strong>' + ROLE_NAME[trip.invite_role || 'editor'] + '</strong> · ' +
      '<button type="button" class="link-btn" id="invite-reset">새 링크로 바꾸기</button> · ' +
      '<button type="button" class="link-btn danger-link" id="invite-off">링크 끊기</button></p>';
    const input = document.getElementById('invite-url');
    input.value = inviteUrl(trip.invite_code);
    input.addEventListener('focus', function () { input.select(); });
    document.getElementById('invite-copy').addEventListener('click', async function () {
      try { await navigator.clipboard.writeText(input.value); msg.textContent = '링크를 복사했어요. 같이 가는 친구에게 보내 주세요.'; }
      catch (e) { input.select(); msg.textContent = '자동 복사가 안 돼요. 선택된 링크를 Ctrl+C로 복사해 주세요.'; }
    });
    document.getElementById('invite-reset').addEventListener('click', function () {
      if (confirm('지금 링크는 더 이상 쓸 수 없게 되고 새 링크가 만들어져요. 이미 들어온 친구는 그대로예요.')) saveLink(makeInviteCode(), trip.invite_role);
    });
    document.getElementById('invite-off').addEventListener('click', function () {
      if (confirm('초대 링크를 끊을까요? 이미 들어온 친구는 그대로예요.')) saveLink(null, trip.invite_role);
    });
  }

  async function saveLink(code, r) {
    const { error } = await sb.from('trips').update({ invite_code: code, invite_role: r || 'editor' }).eq('id', trip.id);
    if (error) return showError(error.message.indexOf('invite_') !== -1
      ? { message: '공유 기능을 쓰려면 Supabase에서 sql/add_share.sql을 먼저 실행해 주세요.' } : error);
    trip.invite_code = code;
    trip.invite_role = r || 'editor';
    msg.textContent = code ? '초대 링크를 만들었어요.' : '초대 링크를 끊었어요.';
    renderLink();
  }

  renderLink();
  loadMembers();
}
