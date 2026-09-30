// 출발 위치 선택 스크립트
// 입력: 사용자의 주소 검색(다음 우편번호 서비스) 또는 지도 클릭·핀 끌기
// 출력: 전역 변수 departure = { address, lat, lng } (위치가 정해지지 않았으면 null)
//       → condition.js가 추천받기 버튼을 누를 때 이 값을 읽어 감

let departure = null;

// 대한민국 전체가 보이도록 지도 만들기 (OpenStreetMap 타일 사용)
const KOREA_CENTER = [36.3, 127.8];
const departureMap = L.map('departure-map', {
  maxBounds: [[32.5, 123.5], [39.5, 132.5]],   // 한반도 밖으로 너무 멀리 못 가게
  minZoom: 6
}).setView(KOREA_CENTER, 6);

L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(departureMap);

let departureMarker = null;

// 위치를 정하고 지도·입력칸에 반영
function setDeparture(lat, lng, address) {
  departure = { address: address, lat: lat, lng: lng };
  document.getElementById('departure-address').value = address;

  if (!departureMarker) {
    departureMarker = L.marker([lat, lng], { draggable: true }).addTo(departureMap);
    // 핀을 끌어서 놓으면 그 위치의 주소로 다시 찾기
    departureMarker.on('dragend', function () {
      const pos = departureMarker.getLatLng();
      pickByCoordinate(pos.lat, pos.lng);
    });
  } else {
    departureMarker.setLatLng([lat, lng]);
  }
}

function setHint(text, isWarning) {
  const hint = document.getElementById('departure-hint');
  hint.textContent = text;
  hint.classList.toggle('warning', !!isWarning);
}

// ---------- 좌표 → 주소 (지도 클릭, 핀 끌기) ----------
// OpenStreetMap의 Nominatim 서비스로 좌표에 해당하는 주소를 찾음
async function pickByCoordinate(lat, lng) {
  setDeparture(lat, lng, '주소 찾는 중...');
  try {
    const url = 'https://nominatim.openstreetmap.org/reverse?format=jsonv2&accept-language=ko&zoom=18'
      + '&lat=' + lat + '&lon=' + lng;
    const res = await fetch(url);
    const data = await res.json();
    const address = data.display_name ? toKoreanOrder(data.display_name) : '선택한 위치';
    setDeparture(lat, lng, address);
    setHint('지도를 누르거나 핀을 끌어서 위치를 정확히 맞출 수 있어요.', false);
  } catch (e) {
    setDeparture(lat, lng, '선택한 위치 (' + lat.toFixed(4) + ', ' + lng.toFixed(4) + ')');
    setHint('주소 이름을 불러오지 못했지만 위치는 저장됐어요.', true);
  }
}

// Nominatim 주소는 "번지, 동, 구, 시, 우편번호, 대한민국" 순서라 한국식으로 뒤집음
function toKoreanOrder(displayName) {
  return displayName.split(', ')
    .filter(function (part) { return part !== '대한민국' && !/^\d{5}$/.test(part); })
    .reverse()
    .join(' ');
}

departureMap.on('click', function (e) {
  pickByCoordinate(e.latlng.lat, e.latlng.lng);
});

// ---------- 주소 → 좌표 (주소 검색) ----------
// 1) 다음 우편번호 서비스로 전국 모든 주소 중 하나를 고름
// 2) 고른 주소를 Nominatim으로 좌표로 바꿈. 정확한 번지가 없으면 동 → 시·군·구 순으로 넓혀서 찾음
async function geocode(query) {
  const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=kr&limit=1&q='
    + encodeURIComponent(query);
  const res = await fetch(url);
  const list = await res.json();
  return list.length > 0 ? { lat: Number(list[0].lat), lng: Number(list[0].lon) } : null;
}

async function pickByAddress(data) {
  const shownAddress = data.roadAddress || data.jibunAddress || data.address;
  document.getElementById('departure-address').value = '위치 찾는 중...';

  // 정확한 주소부터 점점 넓은 범위로 시도
  const tries = [
    { q: data.roadAddress, exact: true },
    { q: data.jibunAddress, exact: true },
    { q: [data.sido, data.sigungu, data.bname].join(' '), exact: false },
    { q: [data.sido, data.sigungu].join(' '), exact: false }
  ];

  for (const t of tries) {
    if (!t.q || !t.q.trim()) continue;
    try {
      const point = await geocode(t.q);
      if (point) {
        setDeparture(point.lat, point.lng, shownAddress);
        departureMap.setView([point.lat, point.lng], t.exact ? 16 : 14);
        if (t.exact) {
          setHint('위치를 찾았어요. 핀을 끌어 미세 조정할 수 있어요.', false);
        } else {
          setHint('정확한 번지를 찾지 못해 동네 중심에 핀을 놓았어요. 지도를 눌러 정확히 맞춰 주세요.', true);
        }
        return;
      }
    } catch (e) { /* 다음 방법으로 계속 */ }
  }

  departure = null;
  document.getElementById('departure-address').value = shownAddress;
  setHint('이 주소의 위치를 찾지 못했어요. 지도에서 직접 눌러 주세요.', true);
}

document.getElementById('address-search-btn').addEventListener('click', function () {
  new daum.Postcode({ oncomplete: pickByAddress }).open();
});
