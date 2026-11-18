// N빵 정산 (피드백 반영 6차시, 조정인 8번 댓글) — 여행 정보 화면(trip.html)
// 입력: 함께 간 사람 이름, 지출(내용·금액·낸 사람·나눌 사람) / 출력: 사람별 낸 돈·내야 할 돈, "누가 누구에게 얼마" 송금 목록
//       저장: trips.settle (sql/add_settle.sql) — 고칠 때마다 1초 뒤 자동 저장, 보기만 권한이면 읽기 전용
//       '예상 비용 불러오기': 일정의 숙박·식비·교통·입장료 예상 금액을 지출 줄로 넣음 (낸 사람은 첫 번째 사람)

const SETTLE_UNIT = 10;   // 송금 금액을 10원 단위로 반올림 (Claude 판단)

// 송금 목록 계산 (가장 많이 받아야 할 사람 ↔ 가장 많이 내야 할 사람끼리 먼저 맞추는 방식 → 송금 횟수가 적음)
// 입력: { members, items } / 출력: { paid[], owe[], balance[], transfers: [{ from, to, amount }] } (순서 번호 기준)
function settleCompute(s) {
  const n = s.members.length;
  const paid = new Array(n).fill(0), owe = new Array(n).fill(0);
  s.items.forEach(function (it) {
    const amount = Number(it.amount) || 0;
    const split = (it.split || []).filter(function (k) { return k < n; });
    if (!amount || it.payer == null || it.payer >= n || !split.length) return;
    paid[it.payer] += amount;
    split.forEach(function (k) { owe[k] += amount / split.length; });
  });
  const balance = paid.map(function (p, k) { return p - owe[k]; });   // + 받을 돈, − 보낼 돈
  const give = [], take = [];
  balance.forEach(function (b, k) { if (b < -0.5) give.push({ k: k, v: -b }); else if (b > 0.5) take.push({ k: k, v: b }); });
  give.sort(function (a, b) { return b.v - a.v; });
  take.sort(function (a, b) { return b.v - a.v; });
  const transfers = [];
  let i = 0, j = 0;
  while (i < give.length && j < take.length) {
    const x = Math.min(give[i].v, take[j].v);
    const amt = Math.round(x / SETTLE_UNIT) * SETTLE_UNIT;
    if (amt > 0) transfers.push({ from: give[i].k, to: take[j].k, amount: amt });
    give[i].v -= x; take[j].v -= x;
    if (give[i].v < 0.5) i++;
    if (take[j].v < 0.5) j++;
  }
  return { paid: paid, owe: owe, balance: balance, transfers: transfers };
}

// 처음 열 때 사람 이름: 함께 정하기면 그 이름들, 아니면 '나' + '동행1, 동행2…' (인원 수만큼, 유아 제외)
function defaultMembers(trip) {
  if (trip.group && trip.group.length >= 2) return trip.group.map(function (m) { return m.name; });
  const n = Math.max(1, (trip.people || 1) - (trip.infants || 0));
  const out = ['나'];
  for (let k = 1; k < n; k++) out.push('동행' + k);
  return out;
}

function setupSettle(trip, role, getTimeline) {
  const card = document.getElementById('settle-card');
  if (!card) return;
  card.hidden = false;
  const readOnly = role === 'viewer';
  let s = trip.settle && trip.settle.members ? JSON.parse(JSON.stringify(trip.settle)) : { members: defaultMembers(trip), items: [] };
  const membersBox = document.getElementById('settle-members');
  const itemsBox = document.getElementById('settle-items');
  const resultBox = document.getElementById('settle-result');
  const msg = document.getElementById('settle-msg');
  let timer = null;

  function save() {
    if (readOnly) return;
    clearTimeout(timer);
    msg.textContent = '저장 중…';
    timer = setTimeout(async function () {
      const { error } = await sb.from('trips').update({ settle: s }).eq('id', trip.id);
      msg.textContent = error ? '저장 실패: ' + (error.message.indexOf('settle') !== -1
        ? 'N빵 정산을 쓰려면 Supabase에서 sql/add_settle.sql을 먼저 실행해 주세요.' : error.message) : '저장했어요.';
      if (error) console.error(error);
    }, 1000);
  }
  function changed() { render(); save(); }

  function render() {
    // 1) 사람
    membersBox.innerHTML = '';
    s.members.forEach(function (name, k) {
      const chip = document.createElement('span');
      chip.className = 'settle-member';
      chip.innerHTML = '<input type="text" maxlength="10" aria-label="이름">' + (readOnly || s.members.length <= 2 ? '' : '<button type="button" class="link-btn" title="빼기">✕</button>');
      const input = chip.querySelector('input');
      input.value = name;
      input.disabled = readOnly;
      input.addEventListener('change', function () { s.members[k] = input.value.trim() || ('동행' + k); changed(); });
      const del = chip.querySelector('button');
      if (del) del.addEventListener('click', function () {
        // 이 사람이 낸 지출이 있으면 막음, 나눌 사람 목록에서는 빼고 뒤 번호를 당김
        if (s.items.some(function (it) { return it.payer === k; })) { alert(name + '이(가) 낸 지출이 있어서 뺄 수 없어요. 그 지출의 낸 사람을 먼저 바꿔 주세요.'); return; }
        s.members.splice(k, 1);
        s.items.forEach(function (it) {
          if (it.payer > k) it.payer--;
          it.split = it.split.filter(function (x) { return x !== k; }).map(function (x) { return x > k ? x - 1 : x; });
        });
        changed();
      });
      membersBox.appendChild(chip);
    });
    document.getElementById('settle-add-member').hidden = readOnly;

    // 2) 지출 표
    itemsBox.innerHTML = '';
    s.items.forEach(function (it, i) {
      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td><input type="text" class="st-what" maxlength="30" placeholder="예: 저녁 회"></td>' +
        '<td><input type="text" class="st-amount money-input" inputmode="numeric" placeholder="0"></td>' +
        '<td><select class="st-payer">' + s.members.map(function (m, k) { return '<option value="' + k + '">' + esc(m) + '</option>'; }).join('') + '</select></td>' +
        '<td class="st-split">' + s.members.map(function (m, k) {
          return '<label><input type="checkbox" value="' + k + '"' + (it.split.indexOf(k) !== -1 ? ' checked' : '') + '>' + esc(m) + '</label>';
        }).join('') + '</td>' +
        '<td>' + (readOnly ? '' : '<button type="button" class="icon-btn danger" title="삭제">✕</button>') + '</td>';
      const what = tr.querySelector('.st-what'), amount = tr.querySelector('.st-amount'), payer = tr.querySelector('.st-payer');
      what.value = it.what || '';
      amount.value = it.amount ? Number(it.amount).toLocaleString('ko-KR') : '';
      payer.value = String(it.payer);
      tr.querySelectorAll('input, select').forEach(function (el) { el.disabled = readOnly; });
      what.addEventListener('change', function () { it.what = what.value.trim(); save(); });
      amount.addEventListener('change', function () { it.amount = Number(amount.value.replace(/[^0-9]/g, '')) || 0; changed(); });
      payer.addEventListener('change', function () { it.payer = Number(payer.value); changed(); });
      tr.querySelectorAll('.st-split input').forEach(function (cb) {
        cb.addEventListener('change', function () {
          const k = Number(cb.value);
          it.split = cb.checked ? it.split.concat([k]).sort(function (a, b) { return a - b; }) : it.split.filter(function (x) { return x !== k; });
          changed();
        });
      });
      const del = tr.querySelector('.danger');
      if (del) del.addEventListener('click', function () { s.items.splice(i, 1); changed(); });
      itemsBox.appendChild(tr);
    });
    document.getElementById('settle-empty').hidden = s.items.length > 0;
    document.getElementById('settle-tools').hidden = readOnly;

    // 3) 결과
    const r = settleCompute(s);
    const total = r.paid.reduce(function (a, b) { return a + b; }, 0);
    if (!total) { resultBox.innerHTML = '<p class="helper-text muted">지출을 넣으면 누가 누구에게 얼마를 보내면 되는지 계산해 드려요.</p>'; return; }
    const rows = s.members.map(function (m, k) {
      const b = r.balance[k];
      return '<tr><td>' + esc(m) + '</td><td>' + won(r.paid[k]) + '</td><td>' + won(r.owe[k]) + '</td>' +
        '<td class="' + (b > 0.5 ? 'plus' : b < -0.5 ? 'minus' : '') + '">' + (b > 0.5 ? '+' + won(b) + ' 받기' : b < -0.5 ? won(-b) + ' 보내기' : '정산 끝') + '</td></tr>';
    }).join('');
    const lines = r.transfers.map(function (t) { return s.members[t.from] + ' → ' + s.members[t.to] + ' ' + won(t.amount); });
    resultBox.innerHTML =
      '<p class="settle-total">총 지출 <strong>' + won(total) + '</strong> · 1인 평균 ' + won(total / s.members.length) + '</p>' +
      '<div class="table-scroll"><table class="settle-table"><tr><th>이름</th><th>낸 돈</th><th>내 몫</th><th>정산</th></tr>' + rows + '</table></div>' +
      (lines.length ? '<ul class="settle-transfers">' + lines.map(function (l) { return '<li>💸 ' + esc(l) + '</li>'; }).join('') + '</ul>' : '<p class="helper-text">보낼 돈이 없어요. 모두 똑같이 냈어요!</p>') +
      (lines.length ? '<button type="button" class="small-btn" id="settle-copy">결과 복사 (단톡방에 붙여 넣기)</button>' : '') +
      '<p class="helper-text muted">송금 금액은 ' + SETTLE_UNIT + '원 단위로 반올림했어요.</p>';
    const copy = document.getElementById('settle-copy');
    if (copy) copy.addEventListener('click', function () {
      const text = '[' + tripTitle(trip) + ' N빵 정산]\n총 ' + won(total) + '\n' + lines.join('\n');
      navigator.clipboard.writeText(text).then(function () { msg.textContent = '복사했어요.'; }, function () { prompt('복사해 주세요', text); });
    });
  }

  document.getElementById('settle-add-member').addEventListener('click', function () {
    s.members.push('동행' + s.members.length);
    s.items.forEach(function (it) { if (it.split.length === s.members.length - 1) it.split.push(s.members.length - 1); });   // '모두'로 나누던 지출엔 새 사람도
    changed();
  });
  document.getElementById('settle-add-item').addEventListener('click', function () {
    s.items.push({ what: '', amount: 0, payer: 0, split: s.members.map(function (m, k) { return k; }) });
    render();
    const inputs = itemsBox.querySelectorAll('.st-what');
    if (inputs.length) inputs[inputs.length - 1].focus();
  });
  document.getElementById('settle-import').addEventListener('click', function () {
    const t = getTimeline();
    if (!t) { msg.textContent = '저장된 일정이 없어서 예상 비용을 불러올 수 없어요.'; return; }
    const all = s.members.map(function (m, k) { return k; });
    [['숙박 (예상)', t.cost.lodging], ['식비 (예상)', t.cost.food], ['교통 (예상)', t.cost.transport], ['입장료 (예상)', t.cost.admission]].forEach(function (x) {
      if (x[1] > 0) s.items.push({ what: x[0], amount: Math.round(x[1]), payer: 0, split: all.slice() });
    });
    changed();
  });
  render();
}

if (typeof module !== 'undefined') module.exports = { settleCompute, defaultMembers };
