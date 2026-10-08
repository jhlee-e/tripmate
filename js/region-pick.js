// 여행지 정하는 방식 선택 + 지역 검색
// 입력: 방식 버튼(추천받기 / 지역 직접 선택), 검색칸에 친 글자, data/regions.json(시·군 이름·시·도)
// 출력: 전역 변수 pickedRegion에 고른 지역 이름 (예: '강릉'), 아직 안 골랐거나 추천받기 방식이면 null

let pickedRegion = null;
const ISLAND_REGIONS = ['제주', '서귀포', '울릉'];   // recommend.js의 SEA_REGIONS와 같은 목록 (추천에서 제외한 섬)
let allRegions = [];

// 방식 버튼: 직접 선택이면 지역 검색칸을 보이고, 버튼 문구도 바꿈
function setupModeSelect() {
  const buttons = document.querySelectorAll('#mode-group .chip');
  buttons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      buttons.forEach(function (b) { b.classList.remove('selected'); });
      btn.classList.add('selected');
      const direct = btn.dataset.value === 'direct';
      document.getElementById('region-field').hidden = !direct;
      document.getElementById('submit-btn').textContent = direct ? '이 지역 일정 추천받기' : '여행지 추천받기';
      if (direct) document.getElementById('region-search').focus();
    });
  });
}

// 검색어가 지역 이름이나 시·도 이름에 들어 있는 곳을 모두 찾음 (공백 무시)
function searchRegions(query) {
  const q = query.replace(/\s/g, '');
  if (!q) return [];
  return allRegions.filter(function (r) {
    return r.region.indexOf(q) !== -1 || r.sido.replace(/\s/g, '').indexOf(q) !== -1;
  }).sort(function (a, b) {
    // 지역 이름이 검색어로 시작하는 곳을 먼저
    return (b.region.indexOf(q) === 0) - (a.region.indexOf(q) === 0) || a.region.localeCompare(b.region, 'ko');
  });
}

function renderResults(list) {
  const ul = document.getElementById('region-results');
  ul.innerHTML = '';
  list.forEach(function (r) {
    const li = document.createElement('li');
    const island = ISLAND_REGIONS.indexOf(r.region) !== -1;
    li.innerHTML = esc(r.region) + '<small>' + esc(r.sido) + (island ? ' · 섬 지역은 아직 지원하지 않아요' : '') + '</small>';
    if (island) li.className = 'disabled';
    else li.addEventListener('click', function () { choose(r); });
    ul.appendChild(li);
  });
}

function choose(r) {
  pickedRegion = r.region;
  document.getElementById('region-search').value = r.region;
  document.getElementById('region-results').innerHTML = '';
  const hint = document.getElementById('region-picked');
  hint.textContent = '✔ ' + r.region + ' (' + r.sido + ') 안에서 일정을 짜 드려요.';
  hint.classList.add('picked');
}

async function setupRegionSearch() {
  const input = document.getElementById('region-search');
  try {
    allRegions = await (await fetch('data/regions.json')).json();
  } catch (e) {
    document.getElementById('region-picked').textContent = '지역 목록을 불러오지 못했어요: ' + e.message;
    return;
  }
  input.addEventListener('input', function () {
    pickedRegion = null;   // 글자를 고치면 목록에서 다시 골라야 함
    const hint = document.getElementById('region-picked');
    hint.classList.remove('picked');
    const found = searchRegions(input.value);
    hint.textContent = input.value && found.length === 0 ? '찾는 지역이 없어요. 시·군 이름으로 검색해 보세요.' : '목록에서 지역을 눌러 골라 주세요.';
    renderResults(found);
  });
  // Enter를 누르면 결과가 하나뿐일 때 바로 고름 (폼 제출은 막음)
  input.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const found = searchRegions(input.value).filter(function (r) { return ISLAND_REGIONS.indexOf(r.region) === -1; });
    const exact = found.filter(function (r) { return r.region === input.value.trim(); })[0];
    if (exact || found.length === 1) choose(exact || found[0]);
  });
}

// condition.html에는 ui.js가 없으므로 글자 이스케이프를 여기서 정의
function esc(text) {
  return String(text).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
