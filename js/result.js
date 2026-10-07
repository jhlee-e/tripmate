// 여행지 추천 화면
// 입력: 주소의 ?trip=여행번호 → 그 여행의 조건, data/regions.json, 상위 지역들의 장소 파일
// 출력: 점수 상위 여행지 5곳 카드(사진·추천 이유·예상 비용) → 누르면 일정안 비교(plans.html)로 이동

const RECOMMEND_COUNT = 5;   // 추천할 여행지 수 (계획서 3곳 → 5곳으로 변경, 2026-10-07)
const MAX_TRY = 12;   // 예산 안에서 일정을 못 만드는 지역을 건너뛰며 최대 몇 곳까지 확인할지

async function start() {
  const trip = await loadTripFromUrl();
  const status = document.getElementById('status');
  if (!trip) { status.textContent = '여행 정보를 찾을 수 없어요. 조건을 다시 입력해 주세요.'; return; }
  document.getElementById('trip-summary').textContent = tripSummary(trip);

  try {
    const regions = await loadRegions();
    const round = Number(param('round')) || 0;   // '다시 추천'을 누른 횟수
    const ranked = rankRegions(trip, regions, round);
    const picked = [];
    // 점수 상위 MAX_TRY곳을 모두 확인한 뒤, 예산 안에 드는 곳을 우선해 RECOMMEND_COUNT곳을 고름
    for (let i = 0; i < ranked.length && i < MAX_TRY; i++) {
      status.textContent = '여행지를 고르는 중… (' + ranked[i].region + ' 확인)';
      const places = await loadPlaces(ranked[i].region);
      const plans = buildPlans(trip, ranked[i].region, places);
      if (plans) {
        const cheapest = Math.min.apply(null, ['A', 'B', 'C'].map(function (k) { return computeTimeline(trip, plans[k]).cost.total; }));
        picked.push({ rank: ranked[i], plans: plans, places: places, fits: cheapest <= trip.budget_max });
      }
    }
    // 예산 안에 드는 곳을 먼저, 그다음 예산을 넘는 곳 (각각 점수 순서 유지)
    picked.sort(function (a, b) { return (b.fits - a.fits) || (b.rank.score - a.rank.score); });
    if (picked.length === 0) {
      status.textContent = '이 예산으로는 일정을 만들 수 있는 여행지를 찾지 못했어요. 최대 예산을 늘리거나 여행 일수·인원을 조정해 보세요.';
      return;
    }
    status.textContent = '';
    const shown = picked.slice(0, RECOMMEND_COUNT);
    const over = shown.filter(function (x) { return !x.fits; }).length;
    if (over) status.textContent = '최대 예산 안에 드는 곳이 ' + (shown.length - over) + '곳뿐이라, 예산을 넘는 ' + over + '곳도 함께 보여 드려요.';
    shown.forEach(function (item, i) { renderCard(trip, item, i + 1, round); });
    const again = document.getElementById('reroll-btn');
    again.hidden = false;
    again.onclick = function () { location.href = 'result.html?trip=' + trip.id + '&round=' + (round + 1); };
    document.getElementById('method-note').textContent =
      '점수 = 고른 취향의 지역 평균 점수(1순위 1.5배) × 인기도 보정 × (1 − 왕복 이동 시간 ÷ 전체 활동 시간) × 랜덤(0.9~1.1). ' +
      '이동 시간과 비용은 직선거리로 계산한 추정값이에요.';
  } catch (e) {
    console.error(e);
    document.getElementById('error-text').textContent = '오류: ' + e.message;
  }
}

function renderCard(trip, item, order, round) {
  const r = item.rank, info = r.info;
  // 일정안 3개의 총비용 범위
  const totals = ['A', 'B', 'C'].map(function (k) { return computeTimeline(trip, item.plans[k]).cost.total; });
  const low = Math.min.apply(null, totals), high = Math.max.apply(null, totals);
  // 대표 사진: 취향 점수 높은 명소 중 사진 있는 곳
  const cover = item.places
    .filter(function (p) { return p.type === '명소' && p.photo && p.recommend; })
    .sort(function (a, b) { return (b._s || 0) - (a._s || 0); })[0];
  // 추천 이유: 고른 취향별 지역 평균 점수
  const tagText = trip.tags.map(function (t) { return t + ' ' + info.tagAvg[t].toFixed(1); }).join(' · ');
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
