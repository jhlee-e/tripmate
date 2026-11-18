# -*- coding: utf-8 -*-
"""
지역 축제·행사 받기 (피드백 반영 6차시, 최세민 2번 댓글)

입력: tools/tourapi_key.txt (공공데이터포털 인증키), 오늘 날짜
출력: data/festivals.json — { "강릉": [ { id, title, start, end, lat, lng, address, photo, district }, ... ], ... }
      TourAPI 행사정보조회(searchFestival2)에서 오늘 이후 끝나는 축제·행사를 모두 받아, 주소로 지역(build_places.py와 같은 규칙)을 붙임
      start·end는 'YYYY-MM-DD'. 광역시는 지역 이름(예: '서울') 아래에 구·군(district)을 함께 적음

실행: tripmate 폴더에서  python tools/fetch_festivals.py   (호출 수: 1000개당 1번, 보통 3~4번)
     축제 일정은 자주 바뀌므로 한 달에 한 번쯤 다시 실행해 커밋하면 됨
"""
import json, os, re, sys, time, urllib.parse, urllib.request, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from build_places import read_key, region_of, METRO   # 지역 이름 규칙은 장소 데이터와 똑같이

URL = 'https://apis.data.go.kr/B551011/KorService2/searchFestival2'


def fetch(key, start, page):
    params = {'serviceKey': key, 'MobileOS': 'WIN', 'MobileApp': 'TripMate', '_type': 'json',
              'numOfRows': 1000, 'pageNo': page, 'arrange': 'C', 'eventStartDate': start}
    url = URL + '?' + urllib.parse.urlencode(params)
    for attempt in range(3):
        try:
            with urllib.request.urlopen(url, timeout=60) as res:
                text = res.read().decode('utf-8')
            body = json.loads(text)['response']['body']
            items = body.get('items') or {}
            items = items.get('item', []) if isinstance(items, dict) else []
            return ([items] if isinstance(items, dict) else items), int(body.get('totalCount', 0))
        except json.JSONDecodeError:
            sys.exit('API가 JSON이 아닌 응답을 보냈습니다(인증키 오류일 가능성):\n' + text[:500])
        except Exception as e:
            print('  재시도', attempt + 1, e)
            time.sleep(3)
    sys.exit('API 호출이 계속 실패했습니다.')


def ymd(s):
    s = str(s or '')
    return s[:4] + '-' + s[4:6] + '-' + s[6:8] if re.fullmatch(r'\d{8}', s) else None


def main():
    key = read_key()
    today = datetime.date.today()
    # eventStartDate: 이 날짜 이후에 '끝나는' 행사까지 포함해서 돌려줌 → 오늘로 두면 진행 중인 축제도 들어옴
    since = today.strftime('%Y%m%d')
    items, page = [], 1
    while True:
        chunk, total = fetch(key, since, page)
        items += chunk
        print(f'{page}페이지 — {len(items)}/{total}')
        if not chunk or len(items) >= total:
            break
        page += 1
        time.sleep(0.3)

    out, skipped = {}, 0
    for it in items:
        start, end = ymd(it.get('eventstartdate')), ymd(it.get('eventenddate'))
        try:
            lat, lng = float(it.get('mapy') or 0), float(it.get('mapx') or 0)
        except ValueError:
            lat = lng = 0
        sido, region = region_of(it.get('addr1'))
        if not (start and end and lat and lng and region) or end < today.isoformat():
            skipped += 1
            continue
        row = {'id': 'fe-' + str(it['contentid']), 'title': it.get('title', '').strip(), 'start': start, 'end': end,
               'lat': round(lat, 6), 'lng': round(lng, 6), 'address': it.get('addr1', ''),
               'photo': it.get('firstimage') or ''}
        parts = (it.get('addr1') or '').split()
        if sido in METRO and len(parts) > 1 and parts[1][-1] in '구군':
            row['district'] = parts[1]
        out.setdefault(region, []).append(row)
    for v in out.values():
        v.sort(key=lambda r: (r['start'], r['title']))
    path = os.path.join(ROOT, 'data', 'festivals.json')
    json.dump({'fetched': today.isoformat(), 'regions': out}, open(path, 'w', encoding='utf-8'), ensure_ascii=False)
    print(f'저장: {path} — {sum(len(v) for v in out.values())}개 ({len(out)}개 지역), 제외 {skipped}개')


if __name__ == '__main__':
    main()
