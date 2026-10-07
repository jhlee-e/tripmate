# -*- coding: utf-8 -*-
"""
분류체계(lclsSystm) 코드 이름표 받기 (TourAPI KorService2 · 분류체계코드조회 lclsSystmCode2)

입력: tools/tourapi_key.txt 인증키
출력: tools/lcls_codes.json — 분류 코드와 이름 목록 (예: NA050100 → 자연관광 > ... > 해수욕장)
     장소 데이터의 lclsSystm3 코드 201가지가 각각 무엇인지 알아내 분류별 점수표를 만들기 위함

실행: tripmate 폴더에서  python tools/fetch_lcls_codes.py   (호출 몇 번이면 끝남)
"""
import json, os, sys, urllib.parse, urllib.request

URL = 'https://apis.data.go.kr/B551011/KorService2/lclsSystmCode2'
HERE = os.path.dirname(os.path.abspath(__file__))


def read_key():
    return urllib.parse.unquote(open(os.path.join(HERE, 'tourapi_key.txt'), encoding='utf-8').read().strip())


def call(key, extra):
    params = {'serviceKey': key, 'MobileOS': 'ETC', 'MobileApp': 'TripMate', '_type': 'json',
              'numOfRows': 1000, 'pageNo': 1}
    params.update(extra)
    with urllib.request.urlopen(URL + '?' + urllib.parse.urlencode(params), timeout=30) as res:
        text = res.read().decode('utf-8')
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        sys.exit('API가 JSON이 아닌 응답을 보냈습니다:\n' + text[:500])
    header = data['response']['header']
    if header.get('resultCode') != '0000':
        sys.exit(f"API 오류 {header.get('resultCode')}: {header.get('resultMsg')}")
    items = data['response']['body'].get('items') or {}
    items = items.get('item', []) if isinstance(items, dict) else []
    return [items] if isinstance(items, dict) else items


def main():
    key = read_key()
    # 1) 전체 목록을 한 번에 달라고 요청 (lclsSystmListYn=Y)
    items = call(key, {'lclsSystmListYn': 'Y'})
    print('목록 한 번에 받기:', len(items), '줄')
    # 2) 그게 안 되면 대분류 → 중분류 → 소분류 순서로 내려가며 받기
    if len(items) < 100:
        items = []
        for a in call(key, {}):
            c1 = a.get('code')
            for b in call(key, {'lclsSystm1': c1}):
                c2 = b.get('code')
                for c in call(key, {'lclsSystm1': c1, 'lclsSystm2': c2}):
                    items.append({'lclsSystm1Cd': c1, 'lclsSystm1Nm': a.get('name'),
                                  'lclsSystm2Cd': c2, 'lclsSystm2Nm': b.get('name'),
                                  'lclsSystm3Cd': c.get('code'), 'lclsSystm3Nm': c.get('name')})
        print('단계별로 받기:', len(items), '줄')
    json.dump(items, open(os.path.join(HERE, 'lcls_codes.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('저장 완료 → tools/lcls_codes.json')
    if items:
        print('첫 줄 예시:', items[0])


if __name__ == '__main__':
    main()
