// 조건 수정하기 (조건 입력 화면 condition.html?edit=여행번호[&region=지역&direct=1]에서 사용)
// 입력: 주소의 edit 번호 → 그 여행(trips 행)의 날짜·예산·인원·출발지·이동 수단·취향·템포 등
// 출력: 입력 칸을 저장된 값으로 미리 채움 (추천 결과가 없을 때 '조건 수정하기'로 와도 입력이 날아가지 않게 — 2026-10-10 이재훈 요청)
//       아직 여행지를 고르지 않은 여행이면 저장할 때 새 여행을 만들지 않고 그 여행을 고침 (editTripId, condition.js)

let editTrip = null;

async function setupEditMode() {
  const params = new URLSearchParams(location.search);
  const id = Number(params.get('edit'));
  if (!id) return;
  const { data, error } = await sb.from('trips').select('*').eq('id', id).maybeSingle();
  if (error || !data) { console.warn('고칠 여행을 찾지 못했어요', error); return; }
  editTrip = data;

  const banner = document.createElement('p');
  banner.className = 'copy-banner';
  banner.textContent = '✏️ 지난번에 입력한 조건을 불러왔어요. 바꾸고 싶은 부분만 고쳐서 다시 추천받으세요.';
  const form = document.getElementById('trip-form');
  form.parentNode.insertBefore(banner, form);

  // 날짜 (지난 날짜면 칸 아래에 경고가 뜸)
  startInput.value = data.start_date;
  endInput.value = data.end_date;
  endInput.min = data.start_date;
  checkDates();
  // 예산 (쉼표 넣어서)
  [['budget-min', data.budget_min], ['budget-max', data.budget_max]].forEach(function (b) {
    const el = document.getElementById(b[0]);
    el.value = b[1] != null ? String(b[1]) : '';
    formatMoneyInput(el);
  });
  // 인원·방·반려동물·함께 정하기
  document.getElementById('people-infants').value = data.infants || 0;
  document.getElementById('people-children').value = data.children || 0;
  document.getElementById('people-teens').value = data.teens || 0;
  document.getElementById('people-adults').value = data.adults != null ? data.adults
    : Math.max(0, data.people - (data.infants || 0) - (data.children || 0) - (data.teens || 0));
  document.getElementById('people-total').textContent = '총 ' + readPeople().total + '명';
  document.getElementById('rooms').value = data.rooms || 1;
  document.getElementById('with-pet').checked = !!data.pet;
  document.getElementById('together').checked = !!data.together;
  // 출발 위치
  if (data.departure_lat != null) {
    presetDeparture({ address: data.departure_address || '저장한 출발 위치', lat: data.departure_lat, lng: data.departure_lng });
  }
  // 이동 수단·템포 (버튼을 누른 것처럼)
  [['transport-group', data.transport], ['tempo-group', data.tempo]].forEach(function (g) {
    const chip = document.querySelector('#' + g[0] + ' .chip[data-value="' + g[1] + '"]');
    if (chip) chip.click();
  });
  // 취향 (선택 순서 그대로)
  selectedTags.length = 0;
  (data.tags || []).forEach(function (t) { selectedTags.push(t); });
  renderTagOrder();
  // 지역을 직접 골랐던 경우: 주소에 넘어온 지역으로 '가고 싶은 지역 있음' 상태 복원
  const region = params.get('region');
  if (params.get('direct') && region) {
    const chip = document.querySelector('#mode-group .chip[data-value="direct"]');
    if (chip) chip.click();
    pickedRegion = region;
    document.getElementById('region-search').value = region;
    const hint = document.getElementById('region-picked');
    hint.textContent = '✔ ' + region + ' 안에서 일정을 짜 드려요.';
    hint.classList.add('picked');
  }
  document.getElementById('submit-btn').textContent = '이 조건으로 다시 추천받기';
}

// 저장할 때 고칠 여행 번호 (여행지를 아직 안 골랐을 때만 — 이미 일정이 있는 여행은 새로 만듦)
function editTripId() {
  return editTrip && !editTrip.region ? editTrip.id : null;
}

setupEditMode();
