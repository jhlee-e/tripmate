# -*- coding: utf-8 -*-
"""
장소 소개글 받기 (TourAPI KorService2 · 공통정보조회 detailCommon2)

입력: data/places.json 의 장소 id(contentId), tools/tourapi_key.txt 인증키
출력: tools/raw/overviews.json  — { "장소id": {"overview": 소개글, "homepage": ..., "cat3": ...}, ... }

실행: tripmate 폴더에서  python tools/fetch_overviews.py
 - 이미 받은 장소는 건너뛰므로, 하루 호출 한도에 걸려 멈추면 다음 날 같은 명령을 다시 실행하면 이어서 받음
 - 강릉·경주·전주·여수를 가장 먼저 받음 (5차시 알고리즘 개발용)
 - 한 번 실행에 최대 950회만 호출 (개발계정 하루 한도 1,000회 가정 — 마이페이지에서 실제 한도 확인)
"""
import json, os, sys, time, urllib.parse, urllib.request

URL = 'https://apis.data.go.kr/B551011/KorService2/detailCommon2'
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(HERE, 'raw', 'overviews.json')
PRIORITY = ['강릉', '경주', '전주', '여수']
MAX_CALLS = int(sys.argv[1]) if len(sys.argv) > 1 else 950


def read_key():
    key = open(os.path.join(HERE, 'tourapi_key.txt'), encoding='utf-8').read().strip()
    return urllib.parse.unquote(key)


def fetch(key, content_id):
    """장소 하나의 공통정보를 받아 dict로. 한도 초과·인증 오류면 None 대신 예외"""
    params = {'serviceKey': key, 'MobileOS': 'ETC', 'MobileApp': 'TripMate',
              '_type': 'json', 'contentId': content_id, 'numOfRows': 10, 'pageNo': 1}
    with urllib.request.urlopen(URL + '?' + urllib.parse.urlencode(params), timeout=30) as res:
        text = res.read().decode('utf-8')
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        # 한도 초과·키 오류는 JSON이 아닌 XML로 오는 경우가 많음
        raise RuntimeError('API 오류 응답: ' + text[:300])
    header = data['response']['header']
    if header.get('resultCode') != '0000':
        raise RuntimeError(f"API 오류 {header.get('resultCode')}: {header.get('resultMsg')}")
    items = (data['response']['body'].get('items') or {})
    items = items.get('item', []) if isinstance(items, dict) else []
    item = items[0] if items else {}
    return {'overview': item.get('overview', ''), 'homepage': item.get('homepage', ''),
            'cat3': item.get('cat3', ''), 'tel': item.get('tel', '')}


def main():
    key = read_key()
    places = json.load(open(os.path.join(ROOT, 'data', 'places.json'), encoding='utf-8'))
    places.sort(key=lambda p: (p['region'] not in PRIORITY, p['region']))   # 4개 지역 먼저
    done = json.load(open(OUT, encoding='utf-8')) if os.path.exists(OUT) else {}
    todo = [p for p in places if str(p['id']) not in done]
    print(f'전체 {len(places)}곳 중 받은 것 {len(done)}곳, 남은 것 {len(todo)}곳 (이번 실행 최대 {MAX_CALLS}회)')

    calls = 0
    try:
        for p in todo:
            if calls >= MAX_CALLS:
                print('이번 실행 호출 수 한도에 도달 — 내일 다시 실행하면 이어서 받습니다.')
                break
            calls += 1
            for attempt in range(3):          # 인터넷이 잠깐 끊겨 시간 초과가 나면 3번까지 다시 시도
                try:
                    done[str(p['id'])] = fetch(key, p['id'])
                    break
                except RuntimeError:
                    raise                     # 한도 초과·인증 오류는 재시도해도 소용없으므로 중단
                except Exception as e:
                    if attempt == 2:
                        raise
                    print('  재시도', attempt + 1, e)
                    time.sleep(5)
            if calls % 50 == 0:
                json.dump(done, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False)
                print(f'  {calls}회 — 누적 {len(done)}/{len(places)} (지금: {p["region"]} {p["name"]})')
            time.sleep(0.1)
    except Exception as e:
        print('중단:', e)
    json.dump(done, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False)
    print(f'저장 완료: 누적 {len(done)}/{len(places)}곳 → tools/raw/overviews.json')


if __name__ == '__main__':
    main()
