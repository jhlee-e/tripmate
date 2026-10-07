// 내 여행(목록) 화면 스크립트
// 입력: 로그인한 사용자의 trips 행, 사용자가 누른 여행 칸·삭제 버튼
// 출력: 저장한 여행 목록을 그림. 여행을 누르면 그 여행의 모든 정보(일정·비용·준비물)를 보는 trip.html로 이동

async function loadTrips() {
  const { data, error } = await sb.from('trips').select('*').order('start_date', { ascending: true });
  if (error) return showError(error);

  const list = document.getElementById('trip-list');
  list.innerHTML = '';
  document.getElementById('trip-empty').hidden = data.length > 0;

  data.forEach(function (trip) {
    const li = document.createElement('li');
    li.className = 'trip-item';
    li.innerHTML =
      '<div class="trip-info">' +
        '<strong></strong>' +
        '<span>' + trip.days + '일 · ' + peopleText(trip) + ' · ' + trip.transport + ' · ' + trip.tempo + '</span>' +
        '<span class="trip-tags">' + trip.tags.map(function (t) { return '#' + t; }).join(' ') + '</span>' +
        '<span class="trip-from"></span>' +
        (trip.region ? '<span class="trip-tags">📍 ' + esc(trip.region) + ' · ' + trip.plan_type + '안' +
          (trip.total_cost ? ' · ' + won(trip.total_cost) : '') + '</span>'
                     : '<span class="muted">아직 여행지를 고르지 않았어요</span>') +
      '</div>' +
      '<div class="trip-actions">' +
        '<button type="button" class="small-btn danger">삭제</button>' +
      '</div>';
    li.querySelector('strong').textContent = tripTitle(trip) + ' (' + trip.days + '일)';
    li.querySelector('.trip-from').textContent = '출발: ' + (trip.departure_address || '-');
    li.addEventListener('click', function () { location.href = 'trip.html?trip=' + trip.id; });
    li.querySelector('button.danger').addEventListener('click', function (e) {
      e.stopPropagation();   // 삭제 버튼을 누를 때 여행 열기가 같이 일어나지 않게
      deleteTrip(trip.id);
    });
    list.appendChild(li);
  });
  return data;
}

async function deleteTrip(id) {
  if (!confirm('이 여행을 삭제할까요? 일정과 준비물도 함께 지워집니다.')) return;
  const { error } = await sb.from('trips').delete().eq('id', id);
  if (error) return showError(error);
  loadTrips();
}

async function start() {
  const user = await requireLogin();
  if (!user) return;
  const { data } = await sb.from('users').select('nickname').eq('id', user.id).single();
  document.getElementById('nav-user').textContent = (data ? data.nickname : user.email) + '님';
  loadTrips();
}

start();
