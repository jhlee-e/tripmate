// 조건 입력 화면 스크립트
// 입력: 사용자가 폼에 넣은 날짜·예산·인원·출발 위치(departure.js)·이동수단·취향 태그(선택 순서 포함)·템포
// 출력: 검사를 통과하면 하나의 객체(tripCondition)로 묶어 콘솔에 출력 (4차시 추천 알고리즘의 입력이 됨)

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
    people: Number(document.getElementById('people').value),
    departure: departure,         // { address, lat, lng } — departure.js에서 만든 값
    transport: getSelectedValue('transport-group'),
    tags: selectedTags.slice(),   // 복사본 (선택 순서 유지)
    tempo: getSelectedValue('tempo-group')
  };
}

// ---------- 3. 입력값 검사 ----------
// 문제가 있으면 안내 문장을, 없으면 빈 문자열을 돌려줌

function validateCondition(c) {
  if (!c.startDate || !c.endDate) return '여행 시작일과 종료일을 모두 입력해 주세요.';
  const dateMsg = checkDates();
  if (dateMsg) return dateMsg;
  if (!c.budgetMin || !c.budgetMax) return '예산의 최소·최대 금액을 모두 입력해 주세요.';
  if (c.budgetMin > c.budgetMax) return '최소 예산이 최대 예산보다 클 수 없어요.';
  if (!c.people || c.people < 1) return '인원 수를 1명 이상 입력해 주세요.';
  if (!c.departure) return '출발 위치를 주소 검색이나 지도로 정해 주세요.';
  if (!c.transport) return '주 이동 수단을 선택해 주세요.';
  if (c.tags.length === 0) return '여행 취향을 한 개 이상 선택해 주세요.';
  if (!c.tempo) return '여행 템포를 선택해 주세요.';
  return '';
}

// ---------- 4. 추천받기 버튼 ----------

function handleSubmit(event) {
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
  console.table(condition);
}

// ---------- 5. 시작 ----------

setupDateLimits();
setupSingleSelect('transport-group');
setupSingleSelect('tempo-group');
setupTagSelect();
document.getElementById('trip-form').addEventListener('submit', handleSubmit);
