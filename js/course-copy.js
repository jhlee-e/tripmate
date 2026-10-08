// 공개 코스 '담기' (조건 입력 화면 condition.html?copy=코스번호에서 사용)
// 입력: 주소의 copy 번호 → public_courses 한 행, 사용자가 입력한 내 날짜·인원·출발지·예산
// 출력: 종료일을 코스 일수에 맞춰 자동으로 정하고, 취향·템포·이동 수단을 코스 값으로 미리 채움.
//       저장할 때 trips에 region·plan_type·day_starts·copied_from을 함께 넣고(copyTripFields),
//       코스의 trip_places를 내 여행으로 복사한 뒤(finishCopy) 일정 상세 화면으로 이동

let copyCourse = null;   // 담는 중인 코스 (담기 모드가 아니면 null)

// 'YYYY-MM-DD' + n일 → 'YYYY-MM-DD'
function addDays(ymd, n) {
  const d = new Date(ymd + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function setupCopyMode() {
  const id = Number(new URLSearchParams(location.search).get('copy'));
  if (!id) return;
  const form = document.getElementById('trip-form');
  const banner = document.createElement('p');
  banner.className = 'copy-banner';
  form.parentNode.insertBefore(banner, form);

  const { data, error } = await sb.from('public_courses').select('*').eq('id', id).maybeSingle();
  if (error || !data) {
    banner.textContent = '담으려는 코스를 찾을 수 없어요. 비공개로 바뀌었을 수 있어요. 아래에서 새 여행을 만들 수 있어요.';
    return;
  }
  copyCourse = data;
  banner.innerHTML = '📥 <strong></strong> 코스(' + data.region + ' · ' + data.days + '일)를 내 여행에 담고 있어요.<br>' +
    '시작일을 고르면 종료일은 ' + data.days + '일에 맞춰 자동으로 정해져요. 취향·템포·이동 수단은 코스 값으로 채워 두었어요 ' +
    '(바꿔도 일정은 그대로 복사되고, 시간·비용은 내 조건으로 다시 계산돼요).';
  banner.querySelector('strong').textContent = '「' + data.title + '」';

  // 여행지는 코스로 정해져 있으므로 '여행지 정하는 방식'·지역 검색 칸은 숨김
  document.getElementById('mode-group').closest('.field-group').hidden = true;
  document.getElementById('region-field').hidden = true;

  // 종료일 = 시작일 + (코스 일수 - 1), 직접 바꿀 수 없음
  endInput.readOnly = true;
  endInput.title = '코스 일수에 맞춰 자동으로 정해져요';
  startInput.addEventListener('input', function () {
    endInput.value = startInput.value ? addDays(startInput.value, data.days - 1) : '';
    checkDates();
  });

  // 코스 값 미리 채우기
  selectedTags.length = 0;
  data.tags.forEach(function (t) { selectedTags.push(t); });
  renderTagOrder();
  [['tempo-group', data.tempo], ['transport-group', data.transport]].forEach(function (g) {
    const chip = document.querySelector('#' + g[0] + ' .chip[data-value="' + g[1] + '"]');
    if (chip) chip.click();
  });
  if (data.days > 1) document.getElementById('rooms').value = data.rooms || 1;
  document.getElementById('submit-btn').textContent = '이 조건으로 코스 담기';
}

// trips에 함께 저장할 열 (담기 모드가 아니면 빈 객체)
function copyTripFields() {
  if (!copyCourse) return {};
  return { region: copyCourse.region, plan_type: copyCourse.plan_type,
           day_starts: copyCourse.day_starts, copied_from: copyCourse.trip_id };
}

// 코스의 일정(trip_places)을 새 여행으로 복사 → 담은 횟수 +1 → 일정 상세로 이동
// 복사에 실패하면 방금 만든 여행을 지워서 일정 없는 여행이 남지 않게 함
async function finishCopy(trip) {
  try {
    const src = await sb.from('trip_places').select('*').eq('trip_id', copyCourse.trip_id).order('day_no').order('order_no');
    if (src.error) throw src.error;
    const rows = src.data.map(function (r) {
      return { trip_id: trip.id, place_id: r.place_id, name: r.name, type: r.type, day_no: r.day_no, order_no: r.order_no,
               start_time: r.start_time, stay_min: r.stay_min, cost: r.cost, lat: r.lat, lng: r.lng,
               meal: r.meal, not_before: r.not_before };
    });
    const ins = await sb.from('trip_places').insert(rows);
    if (ins.error) throw ins.error;
    const cnt = await sb.rpc('save_course', { cid: copyCourse.id });
    if (cnt.error) console.warn('담은 횟수를 올리지 못했어요', cnt.error);   // 담기 자체는 성공이므로 계속 진행
    location.href = 'detail.html?trip=' + trip.id + '&copied=1';
  } catch (e) {
    await sb.from('trips').delete().eq('id', trip.id);
    document.getElementById('error-text').textContent = '코스를 담지 못했어요: ' + e.message;
    console.error(e);
  }
}

setupCopyMode();
