// 여행지 추천 화면
// 입력: 주소의 ?trip=여행번호 → 그 여행의 조건, data/regions.json, 상위 지역들의 장소 파일
// 출력: 점수 상위 여행지 5곳 카드(사진·추천 이유·예상 비용) → 누르면 일정안 비교(plans.html)로 이동

const RECOMMEND_COUNT = 5;   // 추천할 여행지 수 (계획서 3곳 → 5곳으로 변경, 2026-10-07)
const MAX_TRY = 20;   // 예산(최대 +20%) 안에서 일정을 못 만드는 지역을 건너뛰며 최대 몇 곳까지 확인할지 (12 → 20, 2026-10-10)

async function start() {
  const trip = await loadTripFromUrl();
  const status = document.getElementById('status');
  if (!trip) { status.textContent = '여행 정보를 찾을 수 없어요. 조건을 다시 입력해 주세요.'; return; }
  document.getElementById('trip-summary').textContent = tripSummary(trip);
  // 섬에서 출발한 여행은 추천하지 않음 (2026-10-10)
  const island = departureIsland(trip);
  if (island) {
    status.textContent = island + '에서 출발하는 여행은 아직 추천할 수 없어요. 배·비행기 이동을 계산하지 않아서, 육지의 출발 위치로 조건을 고쳐 주세요.';
    showEditConditionButton(status, editConditionUrl(trip.id));
    return;
  }
  const navEdit = document.querySelector('.top-nav a[href="condition.html"]');   // '조건 다시 입력'도 지난 입력을 불러오게
  if (navEdit) { navEdit.href = editConditionUrl(trip.id); navEdit.textContent = '조건 수정하기'; }

  try {
    const regions = await loadRegions();
    const round = Number(param('round')) || 0;   // '다시 추천'을 누른 횟수
    const ranked = rankRegions(trip, regions, round);
    const picked = [];
    // 점수 상위부터 확인: 가장 싼 일정안이 최대 예산 +20%를 넘는 지역은 버림 (2026-10-10 이재훈 결정)
    //   예산 안에 드는 곳이 RECOMMEND_COUNT곳 모이거나 MAX_TRY곳을 확인하면 멈춤
    let fitCount = 0;
    for (let i = 0; i < ranked.length && i < MAX_TRY && fitCount < RECOMMEND_COUNT; i++) {
      status.textContent = '여행지를 고르는 중… (' + ranked[i].region + ' 확인)';
      const places = await loadPlaces(ranked[i].region);
      const plans = buildPlans(trip, ranked[i].region, places);
      if (plans) {
        const cheapest = Math.min.apply(null, ['A', 'B', 'C'].map(function (k) { return computeTimeline(trip, plans[k]).cost.total; }));
        if (!withinBudgetLimit(trip, cheapest)) continue;
        picked.push({ rank: ranked[i], plans: plans, places: places, fits: cheapest <= trip.budget_max });
        if (cheapest <= trip.budget_max) fitCount++;
      }
    }
    // 예산 안에 드는 곳을 먼저, 그다음 예산을 넘는 곳 (각각 점수 순서 유지)
    picked.sort(function (a, b) { return (b.fits - a.fits) || (b.rank.score - a.rank.score); });
    if (picked.length === 0) {
      status.textContent = '최대 예산(' + won(trip.budget_max) + ')의 120% 안에서 갈 수 있는 여행지가 없어요. 최대 예산을 늘리거나 여행 일수·인원을 조정해 보세요.';
      showEditConditionButton(status, editConditionUrl(trip.id));
      return;
    }
    status.textContent = '';
    const shown = picked.slice(0, RECOMMEND_COUNT);
    const over = shown.filter(function (x) { return !x.fits; }).length;
    if (over) status.textContent = '최대 예산 안에 드는 곳이 ' + (shown.length - over) + '곳뿐이라, 예산을 조금(20% 이내) 넘는 ' + over + '곳도 함께 보여 드려요.';
    shown.forEach(function (item, i) { renderCard(trip, item, i + 1, round); });
    const again = document.getElementById('reroll-btn');
    again.hidden = false;
    again.onclick = function () { location.href = 'result.html?trip=' + trip.id + '&round=' + (round + 1); };
    document.getElementById('method-note').textContent =
      '점수 = 고른 취향의 지역 평균 점수(1순위 1.5배) × 인기도 보정 × (1 − 왕복 이동 시간 ÷ 전체 활동 시간) × 예산 보정 × 랜덤(0.9~1.1). ' +
      '예산 보정: 그 지역 최소 비용 추정이 최대 예산을 넘으면 (예산 ÷ 추정)²배. 일정의 총비용이 예산을 넘으면 더 싼 숙소·식당·명소로 자동으로 바꿔요. ' +
      '이동 시간과 비용은 직선거리로 계산한 추정값이에요.';
    if (isGroup(trip)) document.getElementById('method-note').textContent +=
      ' 함께 정하기: 취향 점수 대신 ' + trip.group.length + '명의 평균 만족도를 쓰고, 누군가의 만족도가 40% 미만이면 (최저 만족도 ÷ 40%)배로 깎아요. ' +
      '일정에는 날마다 각자의 1순위 취향 장소를 1곳씩 먼저 넣어요.';
  } catch (e) {
    console.error(e);
    document.getElementById('error-text').textContent = '오류: ' + e.message;
  }
}

// 함께 정하기: 사람별 만족도 (40% 미만은 빨간색 — 여행지 점수가 깎인 이유)
function groupLine(trip, r) {
  if (!r.sats) return '';
  return '<li>👥 만족도: ' + trip.group.map(function (m, i) {
    const pct = Math.round(r.sats[i] * 100);
    return '<span' + (r.sats[i] < GROUP_MIN_SAT ? ' class="warn"' : '') + '>' + esc(m.name) + ' ' + pct + '%</span>';
  }).join(' · ') + '</li>';
}

function renderCard(trip, item, order, round) {
  const r = item.rank, info = r.info;
  // 일정안 3개의 총비용 범위
  const totals = ['A', 'B', 'C'].map(function (k) { return computeTimeline(trip, item.plans[k]).cost.total; })
    .filter(function (v) { return withinBudgetLimit(trip, v); });   // 비교 화면에서도 빠지는 일정안(최대 예산 +20% 초과)은 범위에서 제외
  const low = Math.min.apply(null, totals), high = Math.max.apply(null, totals);
  // 대표 사진: 취향 점수 높은 명소 중 사진 있는 곳
  const cover = item.places
    .filter(function (p) { return p.type === '명소' && p.photo && p.recommend; })
    .sort(function (a, b) { return (b._s || 0) - (a._s || 0); })[0];
  // 추천 이유: 고른 취향별 지역 평균 점수
  // 함께 정하기면 모두가 고른 태그를 합쳐서 보여 줌
  const shownTags = isGroup(trip)
    ? trip.group.reduce(function (all, m) { m.tags.forEach(function (t) { if (all.indexOf(t) === -1) all.push(t); }); return all; }, [])
    : trip.tags;
  const tagText = shownTags.map(function (t) { return t + ' ' + info.tagAvg[t].toFixed(1); }).join(' · ');
  const relax = item.plans.A.relax > 1 ? '<li class="warn">예산 상한을 ' + Math.round((item.plans.A.relax - 1) * 100) + '% 올려서 찾은 곳이에요</li>' : '';

  const card = document.createElement('a');
  card.className = 'card region-card';
  card.href = 'plans.html?trip=' + trip.id + '&region=' + encodeURIComponent(r.region) + '&round=' + round;
  card.innerHTML =
    (cover ? '<div class="photo-wrap"><img class="region-photo" src="' + esc(cover.photo) + '" alt="" loading="lazy"><small class="photo-credit">사진: 한국관광공사</small></div>' : '<div class="region-photo empty"></div>') +
    '<div class="region-body">' +
      '<div class="region-head"><span class="rank-badge">' + order + '</span><strong>' + esc(r.region) + '</strong>' +
        '<small>' + esc(info.sido) + '</small><span class="region-score">' + r.score.toFixed(1) + '점<small>랜덤 ×' + r.jitter.toFixed(2) + '</small></span></div>' +
      '<ul class="reason-list">' +
        '<li>취향 점수(5점 만점 평균): ' + esc(tagText) + '</li>' +
        groupLine(trip, r) +
        '<li>인기 명소 10곳 평균 인기도 ' + info.popTop10.toFixed(1) + ' / 5' + (cover ? ' · 대표: ' + esc(cover.name) : '') + '</li>' +
        '<li>출발지에서 편도 약 ' + durationText(r.oneWayMin) + ' (' + trip.transport + ', 추정)</li>' + relax +
      '</ul>' +
      '<p class="region-cost' + (item.fits ? '' : ' over') + '">예상 비용 ' + (low === high ? won(low) : won(low) + ' ~ ' + won(high)) +
        (item.fits ? '' : ' · 예산 초과') +
        ' <small>/ 최대 예산 ' + won(trip.budget_max) + '</small></p>' +
    '</div>';
  document.getElementById('region-cards').appendChild(card);
}

start();
