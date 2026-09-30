// 출발 위치 선택 스크립트 (카카오맵)
// 입력: 사용자의 주소 검색(다음 우편번호 서비스) 또는 지도 클릭·핀 끌기
// 출력: 전역 변수 departure = { address, lat, lng } (위치가 정해지지 않았으면 null)
//       → condition.js가 추천받기 버튼을 누를 때 이 값을 읽어 감
// 카카오맵 SDK는 condition.html에서 autoload=false로 불러오고, 여기서 kakao.maps.load로 준비가 끝난 뒤 시작함

let departure = null;

kakao.maps.load(function () {
  // 대한민국 전체가 보이도록 지도 만들기 (level: 숫자가 클수록 넓게 보임, 1~14)
  const departureMap = new kakao.maps.Map(document.getElementById('departure-map'), {
    center: new kakao.maps.LatLng(36.3, 127.8),
    level: 13
  });
  departureMap.setMaxLevel(13);                              // 한반도보다 더 멀리 축소하지 못하게
  departureMap.addControl(new kakao.maps.ZoomControl(), kakao.maps.ControlPosition.RIGHT);

  const geocoder = new kakao.maps.services.Geocoder();       // 주소 ↔ 좌표 변환기
  let departureMarker = null;

  // 위치를 정하고 지도·입력칸에 반영
  function setDeparture(lat, lng, address) {
    departure = { address: address, lat: lat, lng: lng };
    document.getElementById('departure-address').value = address;
    const pos = new kakao.maps.LatLng(lat, lng);

    if (!departureMarker) {
      departureMarker = new kakao.maps.Marker({ position: pos, draggable: true, map: departureMap });
      // 핀을 끌어서 놓으면 그 위치의 주소로 다시 찾기
      kakao.maps.event.addListener(departureMarker, 'dragend', function () {
        const p = departureMarker.getPosition();
        pickByCoordinate(p.getLat(), p.getLng());
      });
    } else {
      departureMarker.setPosition(pos);
    }
  }

  function setHint(text, isWarning) {
    const hint = document.getElementById('departure-hint');
    hint.textContent = text;
    hint.classList.toggle('warning', !!isWarning);
  }

  // ---------- 좌표 → 주소 (지도 클릭, 핀 끌기) ----------
  function pickByCoordinate(lat, lng) {
    setDeparture(lat, lng, '주소 찾는 중...');
    // 카카오 좌표→주소 변환은 (경도, 위도) 순서로 넣음
    geocoder.coord2Address(lng, lat, function (result, status) {
      if (status === kakao.maps.services.Status.OK && result.length > 0) {
        const r = result[0];
        const address = r.road_address ? r.road_address.address_name : r.address.address_name;
        setDeparture(lat, lng, address);
        setHint('지도를 누르거나 핀을 끌어서 위치를 정확히 맞출 수 있어요.', false);
      } else {
        setDeparture(lat, lng, '선택한 위치 (' + lat.toFixed(4) + ', ' + lng.toFixed(4) + ')');
        setHint('주소 이름을 찾지 못했지만 위치는 저장됐어요.', true);
      }
    });
  }

  kakao.maps.event.addListener(departureMap, 'click', function (e) {
    pickByCoordinate(e.latLng.getLat(), e.latLng.getLng());
  });

  // ---------- 주소 → 좌표 (주소 검색) ----------
  // 다음 우편번호 서비스로 고른 주소를 카카오 주소 검색으로 좌표로 바꿈
  function pickByAddress(data) {
    const shownAddress = data.roadAddress || data.jibunAddress || data.address;
    document.getElementById('departure-address').value = '위치 찾는 중...';

    geocoder.addressSearch(data.address, function (result, status) {
      if (status === kakao.maps.services.Status.OK && result.length > 0) {
        const lat = Number(result[0].y);   // y = 위도
        const lng = Number(result[0].x);   // x = 경도
        setDeparture(lat, lng, shownAddress);
        departureMap.setLevel(3);
        departureMap.setCenter(new kakao.maps.LatLng(lat, lng));
        setHint('위치를 찾았어요. 핀을 끌어 미세 조정할 수 있어요.', false);
      } else {
        departure = null;
        document.getElementById('departure-address').value = shownAddress;
        setHint('이 주소의 위치를 찾지 못했어요. 지도에서 직접 눌러 주세요.', true);
      }
    });
  }

  document.getElementById('address-search-btn').addEventListener('click', function () {
    new daum.Postcode({ oncomplete: pickByAddress }).open();
  });
});
