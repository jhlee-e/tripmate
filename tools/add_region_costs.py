# regions.json에 지역별 '최소 비용 추정용' 값을 추가하는 스크립트
# 입력: data/places/지역.json 161개, data/regions.json
# 출력: regions.json 각 지역에 costMin = { lodging: 가장 싼 숙소 1박(방 1개), meal: 식사 식당 가격 하위 25% 값(1인) } 추가
#       → js/recommend.js의 rankRegions가 '이 지역에 가면 최소 얼마 드는지'를 미리 계산해 예산을 넘는 지역 점수를 깎는 데 사용
# 거르는 규칙은 recommend.js의 usable()·foodKind()와 같게 맞춤 (추천 후보, 체인 제외, 가격 있는 숙소, 디저트·주점 제외)
import json, re, os

BASE = os.path.join(os.path.dirname(__file__), '..', 'data')
CHAIN = ['스타벅스', '투썸플레이스', '이디야', '메가커피', '메가MGC', '컴포즈커피', '빽다방', '할리스', '엔제리너스', '커피빈',
         '폴바셋', '파스쿠찌', '탐앤탐스', '카페베네', '공차', '설빙', '배스킨', '던킨', '파리바게뜨', '뚜레쥬르', '맥도날드',
         '버거킹', '롯데리아', '맘스터치', 'KFC', '서브웨이', '도미노피자', '피자헛', '교촌', 'BHC', 'bhc', 'BBQ', '본죽',
         '김밥천국', '홍콩반점', '새마을식당', '한신포차', '아웃백', '빕스', '애슐리']
DESSERT_CATS = {'FD050100', 'FD050200', 'FD050300', 'FD030100'}
BAR_CATS = {'FD040100', 'FD040200', 'FD040300', 'FD040400'}
DESSERT_WORDS = re.compile('카페|커피|베이커리|제과|빵|디저트|케이크|도넛|젤라또|아이스크림|빙수|티하우스|찻집|다방|로스터')

def is_meal(p):
    return p['category'] not in BAR_CATS and p['category'] not in DESSERT_CATS and not DESSERT_WORDS.search(p['name'])

regions = json.load(open(os.path.join(BASE, 'regions.json'), encoding='utf-8'))
for r in regions:
    places = json.load(open(os.path.join(BASE, 'places', r['region'] + '.json'), encoding='utf-8'))
    ok = [p for p in places if p['recommend'] and not any(b in p['name'] for b in CHAIN)]
    lodg = sorted(p['cost'] for p in ok if p['type'] == '숙소' and p['cost'] > 0)
    meals = sorted(p['cost'] for p in ok if p['type'] == '식당' and is_meal(p))
    r['costMin'] = {
        'lodging': lodg[0] if lodg else None,
        'meal': meals[len(meals) // 4] if meals else None
    }
json.dump(regions, open(os.path.join(BASE, 'regions.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('done', len(regions))
