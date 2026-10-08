// 준비물 체크리스트 (여행 정보 화면 trip.html에서 사용)
// 입력: 여행 id, 내 다른 여행 목록, 사용자가 누른 체크·추가·삭제·불러오기
// 출력: checklist 테이블의 행을 화면에 그리고, 바뀐 내용을 곧바로 DB에 저장
//       (DB에 저장되므로 창이나 컴퓨터를 껐다 켜도 다시 로그인하면 그대로 불러와짐)
//       돌려주는 값: { loaded(처음 불러오기 Promise), add(이름), items()(지금 항목 이름들), onChange(바뀔 때 부를 함수 자리) }
//       → 추천 준비물(js/packing.js)이 이걸로 항목을 넣고, 이미 담은 것은 추천에서 빼서 보여 줌

function setupChecklist(tripId, otherTrips, readOnly) {
  const msg = document.getElementById('import-msg');
  let rows = [];
  const api = { onChange: null };

  async function load() {
    const { data, error } = await sb.from('checklist').select('*').eq('trip_id', tripId).order('id', { ascending: true });
    if (error) return showError(error);
    rows = data;
    const list = document.getElementById('check-list');
    list.innerHTML = '';
    data.forEach(function (row) {
      const li = document.createElement('li');
      li.className = 'check-item' + (row.checked ? ' done' : '');
      li.innerHTML = '<label><input type="checkbox"><span></span></label>' +
                     '<button type="button" class="link-btn">삭제</button>';
      const box = li.querySelector('input');
      box.checked = row.checked;
      li.querySelector('span').textContent = row.item;
      box.addEventListener('change', async function () {      // 체크하는 순간 DB에 저장
        const { error } = await sb.from('checklist').update({ checked: box.checked }).eq('id', row.id);
        if (error) { box.checked = !box.checked; return showError(error); }
        load();
      });
      li.querySelector('button').addEventListener('click', async function () {
        const { error } = await sb.from('checklist').delete().eq('id', row.id);
        if (error) return showError(error);
        load();
      });
      list.appendChild(li);
    });
    document.getElementById('clear-btn').hidden = data.length === 0;
    const done = data.filter(function (r) { return r.checked; }).length;
    document.getElementById('check-progress').textContent =
      data.length ? '챙긴 준비물 ' + done + ' / ' + data.length : '아직 준비물이 없어요.';
    if (readOnly) list.querySelectorAll('input, button').forEach(function (el) { el.disabled = true; });
    if (api.onChange) api.onChange();
    return data;
  }

  async function addItems(items) {
    const rows = items.map(function (item) { return { trip_id: tripId, item: item }; });
    const { error } = await sb.from('checklist').insert(rows);
    if (error) return showError(error);
    showError(null);
    return load();
  }

  document.getElementById('item-form').addEventListener('submit', function (e) {
    e.preventDefault();
    const input = document.getElementById('item-input');
    const item = input.value.trim();
    if (!item) return;
    input.value = '';
    addItems([item]);
  });

  // 전체 삭제: 이 여행의 준비물만 모두 지움
  document.getElementById('clear-btn').addEventListener('click', async function () {
    const count = document.querySelectorAll('#check-list .check-item').length;
    if (!confirm('이 여행의 준비물 ' + count + '개를 모두 삭제할까요? 되돌릴 수 없어요.')) return;
    const { error } = await sb.from('checklist').delete().eq('trip_id', tripId);
    if (error) return showError(error);
    msg.textContent = '준비물 ' + count + '개를 모두 삭제했어요.';
    load();
  });

  // 다른 여행에서 불러오기: 고른 여행의 준비물 이름을 이 여행에 새 행으로 추가 (이미 있는 이름은 건너뜀, 체크는 해제 상태)
  const select = document.getElementById('import-select');
  select.innerHTML = '<option value="">다른 여행에서 준비물 불러오기</option>' + otherTrips.map(function (t) {
    return '<option value="' + t.id + '">' + esc(tripTitle(t)) + '</option>';
  }).join('');
  select.disabled = otherTrips.length === 0;
  select.addEventListener('change', async function () {
    const sourceId = Number(select.value);
    if (!sourceId) return;
    const label = select.options[select.selectedIndex].textContent;
    select.value = '';
    const from = await sb.from('checklist').select('item').eq('trip_id', sourceId).order('id', { ascending: true });
    if (from.error) return showError(from.error);
    const mine = await sb.from('checklist').select('item').eq('trip_id', tripId);
    if (mine.error) return showError(mine.error);
    if (from.data.length === 0) { msg.textContent = label + '에는 준비물이 없어요.'; return; }
    const have = new Set(mine.data.map(function (r) { return r.item.trim(); }));
    const toAdd = [];
    from.data.forEach(function (r) {
      const name = r.item.trim();
      if (!have.has(name)) { have.add(name); toAdd.push(name); }
    });
    const skipped = from.data.length - toAdd.length;
    if (toAdd.length === 0) { msg.textContent = label + '의 준비물이 이미 모두 들어 있어요.'; return; }
    await addItems(toAdd);
    msg.textContent = label + '에서 준비물 ' + toAdd.length + '개를 가져왔어요' + (skipped ? ' (이미 있는 ' + skipped + '개는 건너뜀).' : '.');
  });

  if (readOnly) {   // 보기 전용으로 공유받은 여행: 추가·불러오기·삭제 막기
    document.querySelectorAll('#item-form input, #item-form button, #import-select').forEach(function (el) { el.disabled = true; });
  }

  api.loaded = load();
  api.add = function (item) {
    if (rows.some(function (r) { return r.item.trim() === item.trim(); })) return Promise.resolve();
    return addItems([item]);
  };
  api.items = function () { return rows.map(function (r) { return r.item; }); };
  return api;
}
