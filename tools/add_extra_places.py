# -*- coding: utf-8 -*-
"""
TourAPI에 없는 지역 고유 브랜드·특별 매장 추가 (2026-10-27, 피드백 2차 3-3)
입력: tools/extra_places.json (Claude가 웹 검색으로 고른 가게 + 근거 링크), tools/kakao_key.txt (카카오 REST 키)
출력: data/places/지역.json 에 장소 추가 (id 90000001부터, 다시 돌리면 예전에 넣은 id 9000xxxx는 지우고 새로 넣음)
      tools/raw/extra_places_found.json (카카오 검색 결과 — 다시 돌릴 때 검색 생략)
실행: python tools/add_extra_places.py   (그다음 python tools/add_districts.py — 광역시 구 이름 붙이기)
※ build_places.py로 장소 파일을 처음부터 다시 만들면 이 스크립트도 다시 돌려야 함
"""
import json, os, urllib.parse, urllib.request
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
URL = 'https://dapi.kakao.com/v2/local/search/keyword.json'
CACHE = os.path.join(HERE, 'raw', 'extra_places_found.json')
CAT = {'snack': ('FD030100', '음식 > 간이음식 > 제과'), 'cafe': ('FD050100', '음식 > 카페/ 찻집 > 카페')}

def search(key, q):
    req = urllib.request.Request(URL + '?' + urllib.parse.urlencode({'query': q, 'size': 5}), headers={'Authorization': 'KakaoAK ' + key})
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read().decode('utf-8')).get('documents', [])

def main():
    items = json.load(open(os.path.join(HERE, 'extra_places.json'), encoding='utf-8'))
    found = json.load(open(CACHE, encoding='utf-8')) if os.path.exists(CACHE) else {}
    key = open(os.path.join(HERE, 'kakao_key.txt'), encoding='utf-8').read().strip()
    regions = {r['region']: r for r in json.load(open(os.path.join(ROOT, 'data', 'regions.json'), encoding='utf-8')) if not r.get('parent')}
    add = {}
    for n, it in enumerate(items):
        if it['query'] not in found:
            docs = search(key, it['query'])
            # 주소에 기대한 말(addr)이 든 첫 결과 (없으면 첫 결과)
            ok = [d for d in docs if (it.get('addr') or '') in (d.get('road_address_name') or d.get('address_name') or '')]
            found[it['query']] = (ok or docs or [None])[0]
        d = found[it['query']]
        if not d:
            print('못 찾음:', it['query']); continue
        if it['region'] not in regions:
            print('지역 없음:', it['region'], it['query']); continue
        cat, catName = CAT[it['kind']]
        p = {'id': 90000001 + n, 'region': it['region'], 'sido': regions[it['region']].get('sido', ''), 'name': d['place_name'],
             'type': '식당', 'category': cat, 'categoryName': catName, 'recommend': True, 'audience': '',
             'tags': {'힐링': 1 if it['kind'] == 'cafe' else 0, '역사': 0, '액티브': 0, '미식': 5, '쇼핑': 1},
             'popularity': 0, 'popularityRaw': 0, 'lat': float(d['y']), 'lng': float(d['x']), 'cost': it['cost'], 'stayMin': 40 if it['kind'] == 'cafe' else 20,
             'address': d.get('road_address_name') or d.get('address_name'), 'photo': '', 'photoLicense': '', 'link': d.get('place_url', ''),
             'featured': True, 'costCheck': '추정', 'basis': it['basis'] + ' (근거: ' + it['source'] + ')', 'scoredBy': 'Claude 판단(웹 검색)', 'indoor': True,
             'extra': True}
        if it['brand'] == 'local': p['localBrand'] = True
        if it['brand'] == 'special': p['special'] = True
        add.setdefault(it['region'], []).append(p)
        print(it['region'], '·', p['name'], '·', p['address'])
    json.dump(found, open(CACHE, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    # 예전에 넣은 가게(id 9000xxxx)는 모든 지역 파일에서 지우고 새로 넣음 (지역을 바꿨을 때 옛 지역에 남지 않게)
    is_extra = lambda p: str(p['id']).isdigit() and 90000000 < int(p['id']) < 90010000
    for region, info in regions.items():
        f = os.path.join(ROOT, info['file'])
        places = json.load(open(f, encoding='utf-8'))
        if not any(is_extra(p) for p in places) and region not in add: continue
        places = [p for p in places if not is_extra(p)] + add.get(region, [])
        json.dump(places, open(f, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    print('추가', sum(len(v) for v in add.values()), '곳')

if __name__ == '__main__':
    main()
