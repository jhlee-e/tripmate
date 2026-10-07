// 추천·비교·상세 화면이 함께 쓰는 작은 도구
// 입력: 주소창의 ?trip=… 값, 로그인 정보 / 출력: 여행 한 건(trips 행), 글자 다듬기 함수들

// 데이터에서 온 글자를 HTML에 넣을 때 태그로 해석되지 않게 바꿈
function esc(text) {
  return String(text == null ? '' : text).replace(/[&<>"']/g, function (ch) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
  });
}

function won(n) { return Math.round(n).toLocaleString('ko-KR') + '원'; }

// 135 → '2시간 15분'
function durationText(min) {
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return (h ? h + '시간 ' : '') + (m || !h ? m + '분' : '').trim();
}

function param(name) { return new URLSearchParams(location.search).get(name); }

// 로그인 확인 → 닉네임 표시 → 주소의 trip 번호로 여행 한 건 불러오기 (없거나 남의 여행이면 null)
async function loadTripFromUrl() {
  const user = await requireLogin();
  if (!user) return null;
  sb.from('users').select('nickname').eq('id', user.id).single().then(function (res) {
    document.getElementById('nav-user').textContent = (res.data ? res.data.nickname : user.email) + '님';
  });
  const id = Number(param('trip'));
  if (!id) return null;
  const { data, error } = await sb.from('trips').select('*').eq('id', id).single();
  if (error) { console.error(error); return null; }
  if (!data.rooms) data.rooms = 1;   // rooms 열을 추가하기 전에 저장한 여행
  return data;
}

function tripSummary(trip) {
  return trip.start_date.slice(5).replace('-', '.') + ' ~ ' + trip.end_date.slice(5).replace('-', '.') +
    ' (' + trip.days + '일) · ' + trip.people + '명 · ' + trip.transport + ' · ' + trip.tempo + ' · ' +
    trip.tags.map(function (t) { return '#' + t; }).join(' ');
}

// 여행 이름: '태안 · 10.20 ~ 10.22' (여행지를 아직 안 골랐으면 날짜만)
function tripTitle(t) {
  const d = t.start_date.slice(5).replace('-', '.') + ' ~ ' + t.end_date.slice(5).replace('-', '.');
  return (t.region ? t.region + ' · ' : '') + d;
}

// 인원 표시: '4명 (성인 2·어린이 1·유아 1)'
function peopleText(trip) {
  const parts = [];
  if (trip.adults) parts.push('성인 ' + trip.adults);
  if (trip.teens) parts.push('청소년 ' + trip.teens);
  if (trip.children) parts.push('어린이 ' + trip.children);
  if (trip.infants) parts.push('유아 ' + trip.infants);
  return trip.people + '명' + (parts.length ? ' (' + parts.join('·') + ')' : '');
}

function showError(error) {
  const el = document.getElementById('error-text');
  if (el) el.textContent = error ? '오류: ' + error.message : '';
  if (error) console.error(error);
}
