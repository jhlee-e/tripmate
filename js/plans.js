// 일정안 비교 화면
// 입력: 주소의 ?trip=여행번호&region=지역 → 그 여행의 조건과 지역 장소 파일
// 출력: 일정안 A(취향)·B(동선)·C(비용)의 총비용·총이동거리·하루 방문 수 비교표와 카드 → 누르면 일정 상세(detail.html)

async function start() {
  const trip = await loadTripFromUrl();
  const region = param('region');
  const status = document.getElementById('status');
  if (!trip || !region) { status.textContent = '여행 정보를 찾을 수 없어요.'; return; }
  document.getElementById('trip-summary').textContent = tripSummary(trip);
  // 섬에서 출발한 여행은 추천하지 않음 (2026-10-10)
  const island = departureIsland(trip);
  if (island) {
    status.textContent = island + '에서 출발하는 여행은 아직 추천할 수 없어요. 배·비행기 이동을 계산하지 않아서, 육지의 출발 위치로 조건을 고쳐 주세요.';
    showEditConditionButton(status, editConditionUrl(trip.id, param('direct') ? region : null));
    return;
  }
  document.getElementById('title').textContent = region + ' 일정안 비교';
  document.getElementById('back-link').href = 'result.html?trip=' + trip.id + '&round=' + (Number(param('round')) || 0);   // 같은 회차 추천으로 돌아감
  if (param('direct')) document.getElementById('back-link').textContent = '← 다른 지역도 추천받기';   // 지역을 직접 골라서 온 경우

  try {
    const places = await loadPlaces(region);
    showMustCard(trip, region, places);
    await attachWeather(trip, region);   // 비 오는 날 야외 명소는 맑은 날로 (js/weather.js, 피드백 반영 6차시)
    const wn = document.getElementById('weather-note');
    wn.textContent = weatherNote(trip);
    wn.hidden = false;
    const fests = festivalsForTrip(await loadFestivals(), trip, region);   // 여행 기간 축제 (js/festival.js)
    if (fests.length) {
      const fn = document.getElementById('fest-note');
      fn.textContent = '🎉 여행 기간 축제·행사 ' + fests.length + '개: ' + fests.slice(0, 3).map(function (f) { return f.title + '(' + festivalDateText(f) + ')'; }).join(', ') +
        (fests.length > 3 ? ' 외 ' + (fests.length - 3) + '개' : '') + ' — 일정 상세에서 원하는 날에 넣을 수 있어요.';
      fn.hidden = false;
    }
    const plans = buildPlans(trip, region, places);
    const editUrl = editConditionUrl(trip.id, param('direct') ? region : null);   // 지난 입력을 불러오는 '조건 수정하기'
    const noPlan = '최대 예산(' + won(trip.budget_max) + ')의 120% 안에서는 ' + region + ' 일정을 만들 수 없어요. 최대 예산을 늘리거나 다른 지역을 골라 보세요.';
    if (!plans) { status.textContent = noPlan; showEditConditionButton(status, editUrl); return; }
    status.textContent = '';
    // 최대 예산 +20%를 넘는 일정안은 빼고 보여 줌 (2026-10-10 이재훈 결정)
    const all = ['A', 'B', 'C'].map(function (k) {
      return { key: k, plan: plans[k], t: computeTimeline(trip, plans[k]) };
    });
    const rows = all.filter(function (r) { return withinBudgetLimit(trip, r.t.cost.total); });
    if (!rows.length) { status.textContent = noPlan; showEditConditionButton(status, editUrl); return; }
    if (rows.length < all.length) {
      status.textContent = all.filter(function (r) { return rows.indexOf(r) === -1; })
        .map(function (r) { return r.key + '안'; }).join('·') + '은 최대 예산을 20% 넘게 넘어서 뺐어요.';
    }
    renderTable(trip, rows);
    rows.forEach(function (row) { renderPlanCard(trip, region, row); });
  } catch (e) {
    console.error(e);
    document.getElementById('error-text').textContent = '오류: ' + e.message;
  }
}

// 꼭 가고 싶은 명소 (2026-11-18 피드백 반영 — 최세민 1번): 지역을 직접 골라 여행지 추천 화면을 건너뛴 경우에도 여기서 고름 (이재훈 결정)
// 입력: trip, 지역, 장소 배열 / 출력: 맨 위 접힌 상자 — 고른 명소를 보여 주고, 다시 고르면 일정안을 새로 계산(새로고침)
function showMustCard(trip, region, places) {
  const card = document.getElementById('must-card');
  const ids = mustIds(trip, region);
  const names = places.filter(function (p) { return ids.indexOf(p.id) !== -1; }).map(function (p) { return p.name; });
  document.getElementById('must-summary').innerHTML = names.length
    ? '📍 꼭 갈 명소 ' + names.length + '곳: ' + esc(names.join(', ')) + ' <small>(누르면 바꾸기)</small>'
    : '📍 꼭 가고 싶은 명소 고르기 <small>(선택 — 고르면 A·B·C안 모두에 넣어요)</small>';
  card.hidden = false;
  card.addEventListener('toggle', function () {
    if (!card.open || card.dataset.ready) return;
    card.dataset.ready = '1';
    makeMustPicker(document.getElementById('must-box'), trip, region, places, function () { location.reload(); });
  });
}

function renderTable(trip, rows) {
  // [이름, 값 꺼내기, 글자로 바꾸기, 작을수록 좋은지]
  const metrics = [
    ['총비용', function (r) { return r.t.cost.total; }, won, true],
    ['총 이동거리', function (r) { return r.t.distanceKm; }, function (v) { return v.toFixed(0) + 'km'; }, true],
    ['하루 방문 수', function (r) { return r.t.visitsPerDay; }, function (v) { return v.toFixed(1) + '곳'; }, false],
    ['숙박비', function (r) { return r.t.cost.lodging; }, won, true],
    ['식비', function (r) { return r.t.cost.food; }, won, true],
    ['교통비', function (r) { return r.t.cost.transport; }, won, true],
    ['입장료', function (r) { return r.t.cost.admission; }, won, true]
  ];
  let html = '<tr><th></th>' + rows.map(function (r) {
    return '<th>' + r.key + '안<small>' + PLAN_INFO[r.key].name + '</small></th>';
  }).join('') + '</tr>';
  metrics.forEach(function (m) {
    const vals = rows.map(m[1]);
    const best = m[3] ? Math.min.apply(null, vals) : Math.max.apply(null, vals);
    html += '<tr><th>' + m[0] + '</th>' + vals.map(function (v) {
      return '<td class="' + (v === best ? 'best' : '') + '">' + m[2](v) + '</td>';
    }).join('') + '</tr>';
  });
  document.getElementById('compare-table').innerHTML = html;
  document.getElementById('compare-card').hidden = false;
}

function renderPlanCard(trip, region, row) {
  const plan = row.plan, t = row.t;
  const card = document.createElement('section');
  card.className = 'card plan-card';
  const over = t.cost.total > trip.budget_max;
  let daysHtml = '';
  // 가독성 개선 (피드백 반영 6차시, 차승우): '→'로 이은 긴 한 줄 대신 날짜별 줄 + 장소마다 칩, 식사는 작고 흐리게
  t.days.forEach(function (d, i) {
    const chips = d.items.map(function (it) {
      const meal = !!it.stop.meal;
      return '<span class="stop-chip' + (meal ? ' meal' : '') + (rainWarn(it.stop.p, trip, i + 1) ? ' wet' : '') + '" title="' + hhmm(it.begin) + '">' +
        (meal ? stopIcon(it.stop) + ' ' : '') + (isMustPlace(it.stop.p, trip, region) ? '📍' : '') + (it.stop.p.festival ? '🎉' : '') +
        esc(it.stop.p.name) + (rainWarn(it.stop.p, trip, i + 1) ? ' ☔' : '') + '</span>';
    });
    const w = dayWeather(trip, i + 1);
    daysHtml += '<li><span class="day-label">' + (i + 1) + '일차' + (w ? '<small>' + weatherIcon(w) + ' ' + Math.round(w.rain) + '%</small>' : '') + '</span>' +
      '<span class="day-chips">' + chips.join('') + '</span></li>';
  });
  card.innerHTML =
    '<h2 class="section-title">' + row.key + '안 · ' + PLAN_INFO[row.key].name +
      ' <small>' + PLAN_INFO[row.key].desc + '</small></h2>' +
    '<p class="plan-total' + (over ? ' over' : '') + '">' + won(t.cost.total) +
      (over ? ' <small>최대 예산 ' + won(trip.budget_max) + ' 초과</small>' : '') + '</p>' +
    '<p class="plan-stats"><span>🧭 총 이동 ' + t.distanceKm.toFixed(0) + 'km</span><span>📍 하루 ' + t.visitsPerDay.toFixed(1) + '곳</span>' +
      '<span>' + (plan.lodging ? '🏨 ' + (trip.days - 1) + '박' : '☀️ 당일치기') + '</span></p>' +
    (plan.swaps && plan.swaps.length ? '<p class="helper-text swap-note">💰 예산에 맞추려고 ' + plan.swaps.length + '곳을 더 저렴한 곳으로 바꿨어요: ' +
      plan.swaps.map(function (w) { return esc(w.from) + ' → ' + esc(w.to) + '(−' + won(w.saving) + ')'; }).join(', ') + '</p>' : '') +
    (plan.lodging ? '<p class="helper-text">숙소: ' + esc(plan.lodging.name) + ' (' + esc(lodgingLabel(plan.lodging, trip)) + ' × 방 ' + trip.rooms + '개)</p>' + lodgingWarnHtml(plan.lodging, trip) : '') +
    '<ul class="plan-days">' + daysHtml + '</ul>' +
    '<a class="submit-btn" href="detail.html?trip=' + trip.id + '&region=' + encodeURIComponent(region) + '&plan=' + row.key + '">' +
      row.key + '안 자세히 보기</a>';
  document.getElementById('plan-cards').appendChild(card);
}

start();
