// 일정안 비교 화면
// 입력: 주소의 ?trip=여행번호&region=지역 → 그 여행의 조건과 지역 장소 파일
// 출력: 일정안 A(취향)·B(동선)·C(비용)의 총비용·총이동거리·하루 방문 수 비교표와 카드 → 누르면 일정 상세(detail.html)

async function start() {
  const trip = await loadTripFromUrl();
  const region = param('region');
  const status = document.getElementById('status');
  if (!trip || !region) { status.textContent = '여행 정보를 찾을 수 없어요.'; return; }
  document.getElementById('trip-summary').textContent = tripSummary(trip);
  document.getElementById('title').textContent = region + ' 일정안 비교';
  document.getElementById('back-link').href = 'result.html?trip=' + trip.id + '&round=' + (Number(param('round')) || 0);   // 같은 회차 추천으로 돌아감

  try {
    const places = await loadPlaces(region);
    const plans = buildPlans(trip, region, places);
    if (!plans) { status.textContent = '이 예산으로는 ' + region + ' 일정을 만들 수 없어요.'; return; }
    status.textContent = '';
    const rows = ['A', 'B', 'C'].map(function (k) {
      return { key: k, plan: plans[k], t: computeTimeline(trip, plans[k]) };
    });
    renderTable(trip, rows);
    rows.forEach(function (row) { renderPlanCard(trip, region, row); });
  } catch (e) {
    console.error(e);
    document.getElementById('error-text').textContent = '오류: ' + e.message;
  }
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
  t.days.forEach(function (d, i) {
    const names = d.items.map(function (it) {
      return (it.stop.meal ? '🍴' : '') + esc(it.stop.p.name);
    });
    daysHtml += '<li><strong>' + (i + 1) + '일차</strong> ' + names.join(' → ') + '</li>';
  });
  card.innerHTML =
    '<h2 class="section-title">' + row.key + '안 · ' + PLAN_INFO[row.key].name +
      ' <small>' + PLAN_INFO[row.key].desc + '</small></h2>' +
    '<p class="plan-total' + (over ? ' over' : '') + '">' + won(t.cost.total) +
      (over ? ' <small>최대 예산 ' + won(trip.budget_max) + ' 초과</small>' : '') + '</p>' +
    (plan.swaps && plan.swaps.length ? '<p class="helper-text swap-note">💰 예산에 맞추려고 ' + plan.swaps.length + '곳을 더 저렴한 곳으로 바꿨어요: ' +
      plan.swaps.map(function (w) { return esc(w.from) + ' → ' + esc(w.to) + '(−' + won(w.saving) + ')'; }).join(', ') + '</p>' : '') +
    (plan.lodging ? '<p class="helper-text">숙소: ' + esc(plan.lodging.name) + ' (1박 ' + won(plan.lodging.cost) + ' × 방 ' + trip.rooms + '개)</p>' : '') +
    '<ul class="plan-days">' + daysHtml + '</ul>' +
    '<a class="submit-btn" href="detail.html?trip=' + trip.id + '&region=' + encodeURIComponent(region) + '&plan=' + row.key + '">' +
      row.key + '안 자세히 보기</a>';
  document.getElementById('plan-cards').appendChild(card);
}

start();
