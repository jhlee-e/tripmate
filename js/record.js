// 내 여행(기록·마이페이지) 화면 스크립트
// 입력: 로그인한 사용자의 trips·checklist 테이블 행, 사용자가 누른 여행 칸·버튼(삭제·체크·추가)
// 출력: 여행 목록과 준비물 체크리스트를 화면에 그리고, 바뀐 내용을 곧바로 DB에 저장
//       (DB에 저장되므로 창이나 컴퓨터를 껐다 켜도 다시 로그인하면 그대로 불러와짐)

const errorText = document.getElementById('error-text');
let currentTripId = null;   // 지금 체크리스트를 보고 있는 여행의 id

// 기본 준비물 (Claude가 임의로 정한 예시 목록 — 자유롭게 바꿔도 됨)
const DEFAULT_ITEMS = ['신분증', '휴대폰 충전기', '보조배터리', '세면도구', '상비약', '여벌 옷'];

function showError(error) {
  errorText.textContent = error ? '오류: ' + error.message : '';
  if (error) console.error(error);
}

// '2026-10-03' → '10.03'
function shortDate(d) {
  return d.slice(5).replace('-', '.');
}

// 12431231 → '12,431,231원' (세 자리마다 쉼표)
function won(n) {
  return Number(n).toLocaleString('ko-KR') + '원';
}

// ---------- 1. 여행 목록 ----------

async function loadTrips() {
  const { data, error } = await sb.from('trips')
    .select('*')
    .order('start_date', { ascending: true });
  if (error) return showError(error);

  const list = document.getElementById('trip-list');
  list.innerHTML = '';
  document.getElementById('trip-empty').hidden = data.length > 0;

  data.forEach(function (trip) {
    const li = document.createElement('li');
    li.className = 'trip-item';
    li.innerHTML =
      '<div class="trip-info">' +
        '<strong>' + shortDate(trip.start_date) + ' ~ ' + shortDate(trip.end_date) + ' (' + trip.days + '일)</strong>' +
        '<span>' + trip.people + '명 · ' + trip.transport + ' · ' + trip.tempo + ' · 예산 ' +
          won(trip.budget_min) + ' ~ ' + won(trip.budget_max) + '</span>' +
        '<span class="trip-tags">' + trip.tags.map(function (t) { return '#' + t; }).join(' ') + '</span>' +
        '<span class="trip-from"></span>' +
      '</div>' +
      '<div class="trip-actions">' +
        '<button type="button" class="small-btn danger">삭제</button>' +
      '</div>';
    // 주소는 사용자가 입력한 글자라 innerHTML 대신 textContent로 넣음
    li.querySelector('.trip-from').textContent = '출발: ' + (trip.departure_address || '-');

    // 여행 칸 전체를 누르면 그 여행의 준비물 체크리스트가 열림
    li.addEventListener('click', function () { openChecklist(trip); });
    li.querySelector('button').addEventListener('click', function (e) {
      e.stopPropagation();   // 삭제 버튼을 누를 때는 칸 클릭(체크리스트 열기)이 같이 일어나지 않게
      deleteTrip(trip.id);
    });
    if (trip.id === currentTripId) li.classList.add('active');
    list.appendChild(li);
  });
  return data;
}

async function deleteTrip(id) {
  if (!confirm('이 여행을 삭제할까요? 준비물 목록도 함께 지워집니다.')) return;
  const { error } = await sb.from('trips').delete().eq('id', id);
  if (error) return showError(error);
  if (id === currentTripId) {
    currentTripId = null;
    document.getElementById('checklist-card').hidden = true;
  }
  loadTrips();
}

// ---------- 2. 준비물 체크리스트 ----------

function openChecklist(trip) {
  currentTripId = trip.id;
  document.getElementById('checklist-trip').textContent =
    shortDate(trip.start_date) + ' ~ ' + shortDate(trip.end_date) + ' 여행';
  document.getElementById('checklist-card').hidden = false;
  document.querySelectorAll('.trip-item').forEach(function (el) { el.classList.remove('active'); });
  loadTrips();
  loadChecklist();
}

async function loadChecklist() {
  const { data, error } = await sb.from('checklist')
    .select('*')
    .eq('trip_id', currentTripId)
    .order('id', { ascending: true });
  if (error) return showError(error);

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

    // 체크하는 순간 DB에 저장
    box.addEventListener('change', async function () {
      const { error } = await sb.from('checklist').update({ checked: box.checked }).eq('id', row.id);
      if (error) { box.checked = !box.checked; return showError(error); }
      loadChecklist();
    });
    li.querySelector('button').addEventListener('click', async function () {
      const { error } = await sb.from('checklist').delete().eq('id', row.id);
      if (error) return showError(error);
      loadChecklist();
    });
    list.appendChild(li);
  });

  const done = data.filter(function (r) { return r.checked; }).length;
  document.getElementById('check-progress').textContent =
    data.length ? '챙긴 준비물 ' + done + ' / ' + data.length : '아직 준비물이 없어요.';
}

async function addItems(items) {
  const rows = items.map(function (item) { return { trip_id: currentTripId, item: item }; });
  const { error } = await sb.from('checklist').insert(rows);
  if (error) return showError(error);
  showError(null);
  loadChecklist();
}

document.getElementById('item-form').addEventListener('submit', function (e) {
  e.preventDefault();
  const input = document.getElementById('item-input');
  const item = input.value.trim();
  if (!item) return;
  input.value = '';
  addItems([item]);
});

document.getElementById('default-items-btn').addEventListener('click', function () {
  addItems(DEFAULT_ITEMS);
});

// ---------- 3. 시작 ----------

async function start() {
  const user = await requireLogin();
  if (!user) return;

  const { data } = await sb.from('users').select('nickname').eq('id', user.id).single();
  document.getElementById('nav-user').textContent = (data ? data.nickname : user.email) + '님';

  const trips = await loadTrips();

  // 조건 입력에서 막 저장하고 넘어온 경우 (주소 끝의 ?saved=여행id)
  const savedId = Number(new URLSearchParams(location.search).get('saved'));
  if (savedId && trips) {
    document.getElementById('notice').textContent = '여행 조건이 저장되었어요. 준비물도 챙겨 보세요!';
    const saved = trips.find(function (t) { return t.id === savedId; });
    if (saved) openChecklist(saved);
  }
}

start();
