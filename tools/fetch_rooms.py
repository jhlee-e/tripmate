# -*- coding: utf-8 -*-
"""
숙소 객실 정보 받기 (TourAPI KorService2 · 반복정보조회 detailInfo2, 숙박 contentTypeId=32)

입력: data/places/지역.json 들의 숙소 id(contentId), tools/tourapi_key.txt 인증키
출력: tools/raw/rooms.json — { "숙소id": [ {객실 원본 항목}, ... ], ... }
      객실 원본 항목: roomtitle(객실 이름), roombasecount(기준 인원), roommaxcount(최대 인원),
                     roomoffseasonminfee1/2(비수기 주중/주말 최저 요금), roompeakseasonminfee1/2(성수기 주중/주말 최저 요금) 등

실행: tripmate 폴더에서  python tools/fetch_rooms.py
 - 이미 받은 숙소는 건너뛰므로, 하루 호출 한도에 걸려 멈추면 다음 날 같은 명령을 다시 실행하면 이어서 받음
 - 추천에 쓰는 숙소(recommend) → 나머지 순서, 한 번 실행에 최대 950회 (개발계정 하루 한도 1,000회 가정)
 - 다 받은 뒤:  python tools/merge_rooms.py  (장소 파일에 객실·요금을 넣음)
"""
import json, os, sys, time, urllib.parse, urllib.request

URL = 'https://apis.data.go.kr/B551011/KorService2/detailInfo2'
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(HERE, 'raw', 'rooms.json')
MAX_CALLS = int(sys.argv[1]) if len(sys.argv) > 1 else 950


def read_key():
    key = open(os.path.join(HERE, 'tourapi_key.txt'), encoding='utf-8').read().strip()
    return urllib.parse.unquote(key)


def fetch(key, content_id):
    """숙소 하나의 객실 목록. 한도 초과·인증 오류면 RuntimeError"""
    params = {'serviceKey': key, 'MobileOS': 'ETC', 'MobileApp': 'TripMate', '_type': 'json',
              'contentId': content_id, 'contentTypeId': 32, 'numOfRows': 50, 'pageNo': 1}
    with urllib.request.urlopen(URL + '?' + urllib.parse.urlencode(params), timeout=30) as res:
        text = res.read().decode('utf-8')
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        raise RuntimeError('API 오류 응답: ' + text[:300])
    header = data['response']['header']
    if header.get('resultCode') != '0000':
        raise RuntimeError(f"API 오류 {header.get('resultCode')}: {header.get('resultMsg')}")
    items = (data['response']['body'].get('items') or {})
    items = items.get('item', []) if isinstance(items, dict) else []
    if isinstance(items, dict):
        items = [items]
    keep = ('roomcode', 'roomtitle', 'roomsize1', 'roomcount', 'roombasecount', 'roommaxcount',
            'roomoffseasonminfee1', 'roomoffseasonminfee2', 'roompeakseasonminfee1', 'roompeakseasonminfee2')
    return [{k: it.get(k, '') for k in keep} for it in items]


def main():
    key = read_key()
    folder = os.path.join(ROOT, 'data', 'places')
    lodgings = []
    for fn in os.listdir(folder):
        lodgings += [p for p in json.load(open(os.path.join(folder, fn), encoding='utf-8')) if p.get('type') == '숙소']
    lodgings.sort(key=lambda p: (not p.get('recommend'), p['region']))
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    done = json.load(open(OUT, encoding='utf-8')) if os.path.exists(OUT) else {}
    todo = [p for p in lodgings if str(p['id']) not in done]
    print(f'숙소 {len(lodgings)}곳 중 받은 것 {len(done)}곳, 남은 것 {len(todo)}곳 (이번 실행 최대 {MAX_CALLS}회)')

    calls = 0
    try:
        for p in todo:
            if calls >= MAX_CALLS:
                print('이번 실행 호출 수 한도에 도달 — 내일 다시 실행하면 이어서 받습니다.')
                break
            calls += 1
            for attempt in range(3):
                try:
                    done[str(p['id'])] = fetch(key, p['id'])
                    break
                except RuntimeError:
                    raise
                except Exception as e:
                    if attempt == 2:
                        raise
                    print('  재시도', attempt + 1, e)
                    time.sleep(5)
            if calls % 50 == 0:
                json.dump(done, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False)
                print(f'  {calls}회 — 누적 {len(done)}/{len(lodgings)} (지금: {p["region"]} {p["name"]})')
            time.sleep(0.1)
    except Exception as e:
        print('중단:', e)
    json.dump(done, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False)
    priced = sum(1 for v in done.values() if any(str(r.get(k, '')).replace(',', '').strip() not in ('', '0')
                 for r in v for k in ('roomoffseasonminfee1', 'roomoffseasonminfee2', 'roompeakseasonminfee1', 'roompeakseasonminfee2')))
    print(f'저장 완료: 누적 {len(done)}/{len(lodgings)}곳 (요금이 하나라도 있는 곳 {priced}곳) → tools/raw/rooms.json')


if __name__ == '__main__':
    main()
