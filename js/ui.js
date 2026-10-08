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

// 장소 이름으로 네이버 블로그 후기 검색 주소 만들기 (지역 이름을 붙여 같은 이름의 다른 가게와 덜 헷갈리게)
// 입력: 장소(p.name, p.region) / 출력: 검색 결과 페이지 주소 — 후기 내용을 가져오지는 않고 링크만 연결
function blogSearchUrl(p, region) {
  const q = ((p.region || region || '') + ' ' + p.name).trim() + ' 후기';
  return 'https://search.naver.com/search.naver?ssc=tab.blog.all&query=' + encodeURIComponent(q);
}

// 일일 경비 표 (여행 정보·일정 상세 화면 공통)
// 입력: trip(시작일·인원), computeTimeline 결과(t.days[i].cost) / 출력: 날짜별 숙박·식비·교통·입장료·합계와 1인당 금액 표 HTML
function dailyCostTable(trip, t) {
  const head = '<tr><th>날짜</th><th>숙박</th><th>식비</th><th>교통</th><th>입장료</th><th>합계</th><th>1인당</th></tr>';
  const body = t.days.map(function (d, i) {
    const c = d.cost, date = new Date(trip.start_date);
    date.setDate(date.getDate() + i);
    return '<tr><td>' + (i + 1) + '일차 <small>' + (date.getMonth() + 1) + '/' + date.getDate() + '</small></td>' +
      '<td>' + (c.lodging ? won(c.lodging) : '-') + '</td><td>' + won(c.food) + '</td><td>' + won(c.transport) + '</td>' +
      '<td>' + won(c.admission) + '</td><td><strong>' + won(c.total) + '</strong></td><td>' + won(c.total / trip.people) + '</td></tr>';
  }).join('');
  return '<div class="table-scroll"><table class="daily-cost">' + head + body + '</table></div>' +
    '<p class="helper-text muted">숙박비는 그날 밤 묵는 날에 넣었어요. 1일차 교통비에는 출발지에서 여행지까지, 마지막 날에는 집으로 돌아오는 비용이 들어 있어요.</p>';
}

// 이 여행에서 내 권한: 'owner'(만든 사람) | 'editor'(함께 편집) | 'viewer'(보기만) | null
// 입력: trips 행 / 출력: 권한 문자열 — 공유 기능(sql/add_share.sql)을 아직 실행하지 않았으면 내 여행만 열리므로 'owner'
async function tripRole(trip) {
  const { data } = await sb.auth.getSession();
  if (!data.session) return null;
  if (trip.user_id === data.session.user.id) return 'owner';
  const res = await sb.from('trip_members').select('role').eq('trip_id', trip.id).eq('user_id', data.session.user.id).maybeSingle();
  return res.data ? res.data.role : null;
}
