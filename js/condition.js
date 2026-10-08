// 조건 입력 화면 스크립트
// 입력: 사용자가 폼에 넣은 날짜·예산·나이대별 인원(유아·어린이·청소년·성인)·출발 위치(departure.js)·이동수단·취향 태그(선택 순서 포함)·템포
//       + 여행지 정하는 방식(추천받기 / 지역 직접 선택, region-pick.js)
// 출력: 검사를 통과하면 하나의 객체(condition)로 묶어 Supabase trips 테이블에 저장한 뒤
//       추천받기 → 여행지 추천 화면(result.html), 지역 직접 선택 → 그 지역의 일정안 비교 화면(plans.html)으로 이동

// ---------- 0. 날짜 제한 ----------
// 시작일은 오늘부터, 종료일은 시작일부터 고를 수 있게 min 값을 정함
// (달력에서 그 이전 날짜는 회색으로 비활성화됨. 키보드로 직접 입력하면 경고 문구 표시)

// 오늘 날짜를 'YYYY-MM-DD' 문자열로 (한국 시간 기준, toISOString은 UTC라 쓰지 않음)
function todayString() {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return now.getFullYear() + '-' + mm + '-' + dd;
}

const startInput = document.getElementById('start-date');
const endInput = document.getElementById('end-date');

// 날짜 칸 아래 경고 문구를 확인하고, 문제가 있으면 문장을 돌려줌
function checkDates() {
  const today = todayString();
  let startMsg = '';
  let endMsg = '';

  if (startInput.value && startInput.value < today) {
    startMsg = '오늘 이전 날짜는 선택할 수 없어요.';
  }
  if (endInput.value && endInput.value < today) {
    endMsg = '오늘 이전 날짜는 선택할 수 없어요.';
  } else if (startInput.value && endInput.value && endInput.value < startInput.value) {
    endMsg = '종료일은 시작일과 같거나 이후여야 해요.';
  }

  document.getElementById('start-date-warning').textContent = startMsg;
  document.getElementById('end-date-warning').textContent = endMsg;
  return startMsg || endMsg;
}

function setupDateLimits() {
  const today = todayString();
  startInput.min = today;
  endInput.min = today;

  startInput.addEventListener('input', function () {
    // 종료일 달력은 시작일부터 열리도록
    endInput.min = (startInput.value && startInput.value >= today) ? startInput.value : today;
    checkDates();
  });
  endInput.addEventListener('input', checkDates);
}

// ---------- 1. 버튼 그룹 동작 ----------

// 단일 선택 그룹: 하나를 누르면 나머지는 선택 해제
function setupSingleSelect(groupId) {
  const group = document.getElementById(groupId);
  const buttons = group.querySelectorAll('.chip');

  buttons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      buttons.forEach(function (b) { b.classList.remove('selected'); });
      btn.classList.add('selected');
    });
  });
}

// 태그 다중 선택: 누른 순서를 배열에 기록 (배열의 0번 = 가중치 1.5배를 받을 1순위 태그)
const selectedTags = [];

function setupTagSelect() {
  const buttons = document.querySelectorAll('#tag-group .chip');

  buttons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      const value = btn.dataset.value;
      const index = selectedTags.indexOf(value);

      if (index === -1) {
        selectedTags.push(value);        // 새로 선택 → 맨 뒤에 추가
      } else {
        selectedTags.splice(index, 1);   // 다시 누름 → 해제, 뒤 순서가 한 칸씩 당겨짐
      }
      renderTagOrder();
    });
  });
}

// 선택 순서를 버튼 위 번호 배지로 표시
function renderTagOrder() {
  const buttons = document.querySelectorAll('#tag-group .chip');

  buttons.forEach(function (btn) {
    const order = selectedTags.indexOf(btn.dataset.value);
    const oldBadge = btn.querySelector('.order-badge');
    if (oldBadge) oldBadge.remove();

    if (order === -1) {
      btn.classList.remove('selected', 'first');
    } else {
      btn.classList.add('selected');
      btn.classList.toggle('first', order === 0);

      const badge = document.createElement('span');
      badge.className = 'order-badge';
      badge.textContent = order + 1;
      btn.prepend(badge);
    }
  });
}

// 단일 선택 그룹에서 선택된 값 읽기 (없으면 null)
function getSelectedValue(groupId) {
  const selected = document.querySelector('#' + groupId + ' .chip.selected');
  return selected ? selected.dataset.value : null;
}

// ---------- 1-2. 나이대별 인원 ----------
// 입력: 유아·어린이·청소년·성인 칸의 숫자 / 출력: { infants, children, teens, adults, total } (빈칸은 0명으로 봄)
const PEOPLE_IDS = { infants: 'people-infants', children: 'people-children', teens: 'people-teens', adults: 'people-adults' };

function readPeople() {
  const counts = {};
  Object.keys(PEOPLE_IDS).forEach(function (key) {
    counts[key] = Number(document.getElementById(PEOPLE_IDS[key]).value) || 0;
  });
  counts.total = counts.infants + counts.children + counts.teens + counts.adults;
  return counts;
}

// 칸을 바꿀 때마다 아래에 '총 N명' 표시
function setupPeopleInputs() {
  Object.values(PEOPLE_IDS).forEach(function (id) {
    document.getElementById(id).addEventListener('input', function () {
      document.getElementById('people-total').textContent = '총 ' + readPeople().total + '명';
    });
  });
}

// ---------- 2. 입력값 모으기 ----------

function collectCondition() {
  const startDate = document.getElementById('start-date').value;
  const endDate = document.getElementById('end-date').value;

  // 여행 일수 = (종료일 - 시작일) + 1  (당일치기 = 1일)
  let days = null;
  if (startDate && endDate) {
    const msPerDay = 1000 * 60 * 60 * 24;
    days = Math.round((new Date(endDate) - new Date(startDate)) / msPerDay) + 1;
  }

  return {
    startDate: startDate,
    endDate: endDate,
    days: days,
    budgetMin: Number(document.getElementById('budget-min').value),
    budgetMax: Number(document.getElementById('budget-max').value),
    people: readPeople(),         // { infants, children, teens, adults, total }
    rooms: Number(document.getElementById('rooms').value),
    departure: departure,         // { address, lat, lng } — departure.js에서 만든 값
    transport: getSelectedValue('transport-group'),
    tags: selectedTags.slice(),   // 복사본 (선택 순서 유지)
    tempo: getSelectedValue('tempo-group'),
    mode: getSelectedValue('mode-group'),   // 'recommend' | 'direct'
    region: pickedRegion                    // 직접 고른 지역 이름 (region-pick.js), 추천받기면 쓰지 않음
  };
}

// ---------- 3. 입력값 검사 ----------
// 문제가 있으면 안내 문장을, 없으면 빈 문자열을 돌려줌

function validateCondition(c) {
  if (c.mode === 'direct' && !c.region) return '가고 싶은 지역을 검색해서 목록에서 골라 주세요.';
  if (!c.startDate || !c.endDate) return '여행 시작일과 종료일을 모두 입력해 주세요.';
  const dateMsg = checkDates();
  if (dateMsg) return dateMsg;
  if (!c.budgetMin || !c.budgetMax) return '예산의 최소·최대 금액을 모두 입력해 주세요.';
  if (c.budgetMin > c.budgetMax) return '최소 예산이 최대 예산보다 클 수 없어요.';
  const p = c.people;
  if ([p.infants, p.children, p.teens, p.adults].some(function (n) { return n < 0 || !Number.isInteger(n); })) {
    return '인원 수는 0 이상의 정수로 입력해 주세요.';
  }
  if (p.total < 1) return '인원 수를 1명 이상 입력해 주세요.';
  if (p.teens + p.adults === 0) return '유아·어린이만으로는 여행할 수 없어요. 청소년이나 성인을 1명 이상 넣어 주세요.';
  if (!Number.isInteger(c.rooms) || c.rooms < 1) return '숙소 방 수는 1 이상의 정수로 입력해 주세요.';
  if (c.rooms > p.total) return '방 수가 인원 수보다 많아요.';
  if (!c.departure) return '출발 위치를 주소 검색이나 지도로 정해 주세요.';
  if (!c.transport) return '주 이동 수단을 선택해 주세요.';
  if (c.tags.length === 0) return '여행 취향을 한 개 이상 선택해 주세요.';
  if (!c.tempo) return '여행 템포를 선택해 주세요.';
  return '';
}

// ---------- 4. 추천받기 버튼 ----------

async function handleSubmit(event) {
  event.preventDefault();   // 페이지 새로고침 막기

  const condition = collectCondition();
  const errorMessage = validateCondition(condition);
  const errorText = document.getElementById('error-text');

  if (errorMessage) {
    errorText.textContent = errorMessage;
    console.warn('입력 오류:', errorMessage);
    return;
  }

  errorText.textContent = '';
  console.log('입력된 여행 조건:', condition);

  // DB에 저장 (열 이름은 sql/schema.sql 의 trips 테이블과 같음, user_id는 DB가 자동으로 채움)
  const button = document.getElementById('submit-btn');
  button.disabled = true;
  // 코스 담기 모드면 여행지·일정안·시작 시각·원래 여행 번호도 함께 저장 (course-copy.js)
  const { data, error } = await sb.from('trips').insert(Object.assign({
    start_date: condition.startDate,
    end_date: condition.endDate,
    days: condition.days,
    budget_min: condition.budgetMin,
    budget_max: condition.budgetMax,
    people: condition.people.total,      // 합계 (예산 ÷ 인원 계산에 사용)
    infants: condition.people.infants,
    children: condition.people.children,
    teens: condition.people.teens,
    adults: condition.people.adults,
    rooms: condition.rooms,
    departure_address: condition.departure.address,
    departure_lat: condition.departure.lat,
    departure_lng: condition.departure.lng,
    transport: condition.transport,
    tags: condition.tags,
    tempo: condition.tempo
  }, copyTripFields())).select().single();
  button.disabled = false;

  if (error) {
    errorText.textContent = '저장 실패: ' + error.message;
    console.error(error);
    return;
  }
  console.log('저장된 여행:', data);
  if (copyCourse) {
    // 공개 코스 담기: 코스 일정을 복사한 뒤 일정 상세로 (course-copy.js)
    button.disabled = true;
    await finishCopy(data);
    button.disabled = false;
  } else if (condition.mode === 'direct') {
    // 지역을 직접 골랐으면 여행지 추천을 건너뛰고 그 지역의 일정안 비교로 바로 이동
    // (trips.region은 일정을 '저장'할 때 채워지므로 여기서는 주소로만 넘김)
    location.href = 'plans.html?trip=' + data.id + '&region=' + encodeURIComponent(condition.region) + '&direct=1';
  } else {
    location.href = 'result.html?trip=' + data.id;   // 5차시: 저장 후 여행지 추천 화면으로
  }
}

// 로그인 확인 후 닉네임을 위쪽 메뉴에 표시
async function showUser() {
  const user = await requireLogin();
  if (!user) return;
  const { data } = await sb.from('users').select('nickname').eq('id', user.id).single();
  document.getElementById('nav-user').textContent = (data ? data.nickname : user.email) + '님';
}

// ---------- 5. 시작 ----------

showUser();
setupDateLimits();
setupSingleSelect('transport-group');
setupModeSelect();      // region-pick.js
setupRegionSearch();    // region-pick.js
setupSingleSelect('tempo-group');
setupTagSelect();
setupPeopleInputs();
document.getElementById('trip-form').addEventListener('submit', handleSubmit);
