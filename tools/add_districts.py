# 광역시·특별시를 구·군 단위 지역으로도 추천할 수 있게 하는 스크립트 (2026-10-12, 이재훈 결정)
# 입력: data/places/서울.json 등 광역시 7곳 장소 파일, data/regions.json
# 출력: ① 광역시 장소마다 district(구·군 이름, 예: '종로구') 추가 — 같은 파일을 그대로 고쳐 씀
#       ② regions.json에 '서울 종로구' 같은 구·군 지역 76곳 추가 (장소 파일은 따로 만들지 않고 광역시 파일을 같이 씀)
#          parent(광역시 이름), district(구·군), near(가까운 구·군 순서 — 장소가 모자랄 때 보탤 순서)
# 결정: 세종은 하나로 둠 / 수원·창원·성남처럼 일반구가 있는 시는 나누지 않음 / 시 단위 '서울'도 그대로 추천
# 다시 돌려도 됨: 예전에 추가한 구·군 지역을 지우고 새로 계산함
# 실행 순서: build_places.py → indoor.py → add_region_costs.py → add_districts.py (update_popularity.py는 끝에서 자동 실행)
import json, os, re, math

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
TAG_NAMES = ['힐링', '역사', '액티브', '미식', '쇼핑']
# 2026-10-12 장소 주소에 실제로 나오는 구·군 (인천은 2026년 개편 후 이름: 제물포구·영종구·서해구·검단구)
DISTRICTS = {
    '서울': ['강남구', '강동구', '강북구', '강서구', '관악구', '광진구', '구로구', '금천구', '노원구', '도봉구', '동대문구',
             '동작구', '마포구', '서대문구', '서초구', '성동구', '성북구', '송파구', '양천구', '영등포구', '용산구', '은평구',
             '종로구', '중구', '중랑구'],
    '부산': ['강서구', '금정구', '기장군', '남구', '동구', '동래구', '부산진구', '북구', '사상구', '사하구', '서구', '수영구',
             '연제구', '영도구', '중구', '해운대구'],
    '대구': ['군위군', '남구', '달서구', '달성군', '동구', '북구', '서구', '수성구', '중구'],
    '인천': ['강화군', '계양구', '검단구', '남동구', '미추홀구', '부평구', '서해구', '연수구', '영종구', '옹진군', '제물포구'],
    '광주': ['광산구', '남구', '동구', '북구', '서구'],
    '대전': ['대덕구', '동구', '서구', '유성구', '중구'],
    '울산': ['남구', '동구', '북구', '울주군', '중구'],
}
# add_region_costs.py와 같은 규칙 (최소 비용 추정)
CHAIN = ['스타벅스', '투썸플레이스', '이디야', '메가커피', '메가MGC', '컴포즈커피', '빽다방', '할리스', '엔제리너스', '커피빈',
         '폴바셋', '파스쿠찌', '탐앤탐스', '카페베네', '공차', '설빙', '배스킨', '던킨', '파리바게뜨', '뚜레쥬르', '맥도날드',
         '버거킹', '롯데리아', '맘스터치', 'KFC', '서브웨이', '도미노피자', '피자헛', '교촌', 'BHC', 'bhc', 'BBQ', '본죽',
         '김밥천국', '홍콩반점', '새마을식당', '한신포차', '아웃백', '빕스', '애슐리']
DESSERT_CATS = {'FD050100', 'FD050200', 'FD050300', 'FD030100'}
BAR_CATS = {'FD040100', 'FD040200', 'FD040300', 'FD040400'}
DESSERT_WORDS = re.compile('카페|커피|베이커리|제과|빵|디저트|케이크|도넛|젤라또|아이스크림|빙수|티하우스|찻집|다방|로스터')


def district_of(addr, names):
    """주소 두 번째 낱말로 구·군 찾기. '부산광역시 해운대구광역시'처럼 덧붙은 글자가 있어도 앞부분으로 맞춤"""
    parts = (addr or '').split()
    for w in parts[1:3]:
        for d in sorted(names, key=len, reverse=True):
            if w.startswith(d):
                return d
    return None


def km(a, b):
    r = math.pi / 180
    x = (b[1] - a[1]) * r * math.cos((a[0] + b[0]) / 2 * r)
    y = (b[0] - a[0]) * r
    return 6371 * math.hypot(x, y)


def summary(places):
    sights = [p for p in places if p['type'] == '명소' and p['recommend']]
    ok = [p for p in places if p['recommend'] and not any(b in p['name'] for b in CHAIN)]
    lodg = sorted(p['cost'] for p in ok if p['type'] == '숙소' and p['cost'] > 0)
    meals = sorted(p['cost'] for p in ok if p['type'] == '식당' and p['category'] not in BAR_CATS
                   and p['category'] not in DESSERT_CATS and not DESSERT_WORDS.search(p['name']))
    return {
        'lat': round(sum(p['lat'] for p in places) / len(places), 5),
        'lng': round(sum(p['lng'] for p in places) / len(places), 5),
        'counts': {t: sum(1 for p in places if p['type'] == t) for t in ('명소', '식당', '숙소')},
        'featured': sum(1 for p in places if p.get('featured')),
        'tagAvg': {t: round(sum(p['tags'][t] for p in sights) / len(sights), 2) if sights else 0 for t in TAG_NAMES},
        'popTop10': round(sum(sorted((p['popularity'] for p in sights), reverse=True)[:10]) / 10, 2),
        'costMin': {'lodging': lodg[0] if lodg else None, 'meal': meals[len(meals) // 4] if meals else None},
    }


def main():
    rp = os.path.join(ROOT, 'data', 'regions.json')
    regions = [r for r in json.load(open(rp, encoding='utf-8')) if not r.get('parent')]   # 예전 구·군 지역은 지움
    by_name = {r['region']: r for r in regions}
    added, unknown = [], 0
    for metro, names in DISTRICTS.items():
        parent = by_name[metro]
        f = os.path.join(ROOT, parent['file'])
        places = json.load(open(f, encoding='utf-8'))
        groups = {d: [] for d in names}
        for p in places:
            d = district_of(p.get('address'), names)
            if d:
                p['district'] = d
                groups[d].append(p)
            else:
                p.pop('district', None)
                unknown += 1
        json.dump(places, open(f, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))

        rows = []
        for d in names:
            if not groups[d]:
                print('장소가 없는 구·군:', metro, d)
                continue
            s = summary(groups[d])
            for k in ('lodging', 'meal'):                 # 숙소·식당이 없는 구는 광역시 값으로 (이웃 구에서 보태므로)
                if s['costMin'][k] is None:
                    s['costMin'][k] = (parent.get('costMin') or {}).get(k)
            rows.append(dict({'region': metro + ' ' + d, 'sido': parent['sido'], 'file': parent['file'],
                              'parent': metro, 'district': d}, **s))
        for row in rows:                                  # 가까운 구·군 순서 (중심 좌표 직선거리)
            others = sorted((x for x in rows if x is not row),
                            key=lambda x: km((row['lat'], row['lng']), (x['lat'], x['lng'])))
            row['near'] = [x['district'] for x in others]
        added += rows

    json.dump(regions + added, open(rp, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(f'구·군 지역 {len(added)}곳 추가 (전체 {len(regions) + len(added)}곳), 구·군을 못 찾은 장소 {unknown}곳')
    few = [r['region'] + f"(명소 {r['counts']['명소']}·식당 {r['counts']['식당']}·숙소 {r['counts']['숙소']})"
           for r in added if r['counts']['숙소'] == 0 or r['counts']['명소'] < 20]
    if few:
        print('장소가 적은 구·군 (이웃 구에서 보탬):', ', '.join(few))


if __name__ == '__main__':
    main()
