// 꼭 가고 싶은 명소 고르기 (2026-11-18 피드백 반영 — 최세민 1번·조정인 5번)
// 입력: 넣을 상자(element), trip(trips 한 행), 지역 이름, 그 지역 장소 배열(loadPlaces 결과), 다 고른 뒤 할 일(onDone(ids))
// 출력: 상자 안에 [검색 칸 + 추천 명소 목록(체크) + 고른 명소 + '넣어서 일정 보기' 버튼]을 그림
//   버튼을 누르면 trips.must_places = { region, ids }로 저장한 뒤 onDone(ids)를 부름
// 쓰는 곳: 여행지 추천(result.js)의 지역 카드 아래, 일정안 비교(plans.js) 맨 위
// 이재훈 결정: 개수 제한 없음 / 명소만 고름 (식당은 음식 선호 표의 '먹고 싶어요'로)

const MUST_SHOW = 12;   // 검색어가 없을 때 보여 줄 추천 명소 수 (Claude 판단)

function makeMustPicker(box, trip, region, places, onDone) {
  ensureScores(places, trip);   // 취향 점수가 없는 장소에도 점수를 붙임 (recommend.js)
  const district = places.district;
  // 고를 수 있는 곳: 그 지역 명소 (배 타는 섬 제외). 구·군 지역이면 그 구의 명소를 먼저
  const all = places.filter(function (p) { return p.type === '명소' && !p.ferry; });
  const order = function (a, b) {
    const da = district && a.district !== district ? 1 : 0, db = district && b.district !== district ? 1 : 0;
    return (da - db) || ((b._s || 0) - (a._s || 0));
  };
  all.sort(order);
  const byId = {};
  all.forEach(function (p) { byId[p.id] = p; });
  const chosen = mustIds(trip, region).filter(function (id) { return byId[id]; });

  box.classList.add('must-pick');
  box.innerHTML =
    '<p class="helper-text">고른 명소는 A·B·C안 모두에 꼭 들어가요. 개수 제한은 없지만 너무 많으면 하루 활동 시간을 넘을 수 있어요.</p>' +
    '<input type="search" class="must-search" placeholder="명소 이름으로 찾기 (예: ' + esc(all[0] ? all[0].name : '') + ')" autocomplete="off">' +
    '<ul class="must-list"></ul>' +
    '<p class="must-chosen"></p>' +
    '<button type="button" class="submit-btn must-go"></button>' +
    '<p class="error-text must-error" role="alert"></p>';
  const search = box.querySelector('.must-search');
  const list = box.querySelector('.must-list');
  const chosenBox = box.querySelector('.must-chosen');
  const go = box.querySelector('.must-go');

  // 목록: 검색어가 없으면 취향 점수 상위 MUST_SHOW곳 + 이미 고른 곳, 있으면 이름에 검색어가 든 곳 (공백 무시)
  function renderList() {
    const q = search.value.replace(/\s/g, '');
    let shown;
    if (q) shown = all.filter(function (p) { return p.name.replace(/\s/g, '').indexOf(q) !== -1; }).slice(0, 30);
    else shown = chosen.map(function (id) { return byId[id]; }).concat(all.filter(function (p) { return chosen.indexOf(p.id) === -1; }).slice(0, MUST_SHOW));
    list.innerHTML = shown.length ? '' : '<li class="muted">찾는 명소가 없어요.</li>';
    shown.forEach(function (p) {
      const li = document.createElement('li');
      li.innerHTML = '<label><input type="checkbox"' + (chosen.indexOf(p.id) !== -1 ? ' checked' : '') + '> <span></span></label>';
      li.querySelector('span').textContent = p.name + ' (' + (p.categoryName || '명소') + (p.cost ? ' · ' + won(p.cost) : ' · 무료') + ')' +
        (district && p.district !== district ? ' · ' + (p.district || '다른 구') : '');
      li.querySelector('input').addEventListener('change', function (e) {
        const i = chosen.indexOf(p.id);
        if (e.target.checked && i === -1) chosen.push(p.id);
        if (!e.target.checked && i !== -1) chosen.splice(i, 1);
        renderChosen();
      });
      list.appendChild(li);
    });
  }
  function renderChosen() {
    chosenBox.textContent = chosen.length
      ? '📍 고른 명소 ' + chosen.length + '곳: ' + chosen.map(function (id) { return byId[id].name; }).join(', ')
      : '아직 고른 명소가 없어요.';
    go.textContent = chosen.length ? '📍 고른 명소 넣어서 일정 보기 →' : '명소 지정 없이 일정 보기 →';
  }
  search.addEventListener('input', renderList);

  go.addEventListener('click', async function () {
    go.disabled = true;
    const value = chosen.length ? { region: region, ids: chosen.slice() } : null;
    const { error } = isGuestTrip(trip)   // 로그인 없이 짜는 여행은 브라우저에 보관 (js/guest.js)
      ? (updateGuestTrip({ must_places: value }), { error: null })
      : await sb.from('trips').update({ must_places: value }).eq('id', trip.id);
    go.disabled = false;
    if (error) {
      box.querySelector('.must-error').textContent = '저장 실패: ' + (error.message.indexOf('must_places') !== -1
        ? '\'꼭 가고 싶은 명소\'를 쓰려면 Supabase에서 sql/add_feedback3.sql을 먼저 실행해 주세요.' : error.message);
      console.error(error);
      return;
    }
    trip.must_places = value;
    onDone(chosen.slice());
  });

  renderList();
  renderChosen();
}
