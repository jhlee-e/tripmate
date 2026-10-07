# -*- coding: utf-8 -*-
"""
places.json 생성 스크립트 (한국관광공사 TourAPI 4.0, KorService2)

입력: tools/tourapi_key.txt 에 넣은 공공데이터포털 인증키
출력: data/places/지역이름.json (지역별 장소 전체 — 명소·식당·숙소, 합의한 구조)
      data/regions.json (지역 목록 — 지역 이름, 파일 경로, 중심 좌표, 장소 수, 명소 태그 평균)

실행: tripmate 폴더에서  python tools/build_places.py
     (파이썬 기본 라이브러리만 사용, 설치할 것 없음)

※ 태그 점수·비용·체류 시간은 TourAPI에 없는 값이라, 세부 분류(lclsSystm3)별 점수표(tools/lcls_scores.json)로 채웁니다.
   (표에 없는 코드만 아래 '분류별 기본값' 사용) 직접 고른 장소는 tools/curated_places.json 값이 우선.
   이 기본값은 Claude가 정한 초안(추정치)이므로 이재훈이 검토·수정해야 합니다.
"""
import json, os, re, sys, time, urllib.parse, urllib.request
from collections import defaultdict

BASE = 'https://apis.data.go.kr/B551011/KorService2/areaBasedList2'
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
RAW_DIR = os.path.join(HERE, 'raw')          # 받아 온 원본(재실행 시 API 호출 절약용)

# ---------------------------------------------------------------
# 1. 가져올 콘텐츠 종류 (TourAPI contentTypeId)
#    12 관광지 / 14 문화시설 / 28 레포츠 / 38 쇼핑 / 39 음식점 / 32 숙박
#    (15 축제·행사는 날짜가 바뀌어서, 25 여행코스는 장소가 아니어서 제외)
# ---------------------------------------------------------------
CONTENT_TYPES = [12, 14, 28, 38, 39, 32]
PLACE_TYPE = {12: '명소', 14: '명소', 28: '명소', 38: '명소', 39: '식당', 32: '숙소'}

# 지역(시·군)당 최대 개수 — 파일 크기 조절용
MAX_PER_REGION = {'명소': 15, '식당': 8, '숙소': 5}

# ---------------------------------------------------------------
# 2. 분류별 기본값 (★ Claude 초안 — 검토 필요)
#    키: TourAPI 분류코드 cat2(없으면 cat1, 그것도 없으면 contentTypeId)
#    tags: 힐링·역사·액티브·미식·쇼핑 (0~5)
#    cost: 명소·식당 = 1인 원, 숙소 = 1박 객실 요금(원)  ← 실제 요금 아님, 평균 추정치
#    stayMin: 머무는 시간(분)
# ---------------------------------------------------------------
DEFAULTS = {
    'A0101': dict(tags=[5, 0, 2, 0, 0], cost=0,     stayMin=90),   # 자연관광지 (산·해변·계곡 등)
    'A0102': dict(tags=[5, 1, 1, 0, 0], cost=0,     stayMin=60),   # 관광자원 (희귀동식물·기암괴석 등)
    'A0201': dict(tags=[1, 5, 0, 0, 0], cost=3000,  stayMin=70),   # 역사관광지 (고궁·사찰·유적)
    'A0202': dict(tags=[5, 0, 1, 1, 0], cost=5000,  stayMin=120),  # 휴양관광지 (공원·온천·수목원)
    'A0203': dict(tags=[2, 2, 5, 0, 0], cost=10000, stayMin=90),   # 체험관광지 (농어촌·전통체험)
    'A0204': dict(tags=[0, 2, 3, 0, 1], cost=5000,  stayMin=60),   # 산업관광지
    'A0205': dict(tags=[2, 3, 0, 0, 1], cost=0,     stayMin=40),   # 건축·조형물 (다리·타워 등)
    'A0206': dict(tags=[1, 4, 1, 0, 0], cost=5000,  stayMin=70),   # 문화시설 (박물관·미술관)
    'A03':   dict(tags=[1, 0, 5, 0, 0], cost=30000, stayMin=120),  # 레포츠
    'A04':   dict(tags=[0, 0, 0, 1, 5], cost=0,     stayMin=60),   # 쇼핑 (시장·아울렛)
    'A05':   dict(tags=[0, 0, 0, 5, 0], cost=12000, stayMin=60),   # 음식점
    'B02':   dict(tags=[1, 0, 0, 0, 0], cost=80000, stayMin=0),    # 숙박
    # 분류코드가 비어 있을 때 쓰는 contentTypeId별 기본값
    12: dict(tags=[3, 2, 1, 0, 0], cost=0,     stayMin=60),
    14: dict(tags=[1, 4, 1, 0, 0], cost=5000,  stayMin=70),
    28: dict(tags=[1, 0, 5, 0, 0], cost=30000, stayMin=120),
    38: dict(tags=[0, 0, 0, 1, 5], cost=0,     stayMin=60),
    39: dict(tags=[0, 0, 0, 5, 0], cost=12000, stayMin=60),
    32: dict(tags=[1, 0, 0, 0, 0], cost=80000, stayMin=0),
}
TAG_NAMES = ['힐링', '역사', '액티브', '미식', '쇼핑']

# 특별시·광역시·특별자치시는 도시 전체를 한 지역으로, 도는 시·군 단위로 나눔
METRO = {'서울특별시': '서울', '부산광역시': '부산', '대구광역시': '대구', '인천광역시': '인천',
         '광주광역시': '광주', '대전광역시': '대전', '울산광역시': '울산', '세종특별자치시': '세종'}


def read_key():
    path = os.path.join(HERE, 'tourapi_key.txt')
    if not os.path.exists(path):
        sys.exit('tools/tourapi_key.txt 파일이 없습니다. 공공데이터포털 인증키를 붙여 넣어 저장해 주세요.')
    key = open(path, encoding='utf-8').read().strip()
    # '인코딩' 키(%가 들어 있음)면 한 번 풀어서 사용 → 아래에서 다시 인코딩
    return urllib.parse.unquote(key)


calls = 0

def fetch_page(key, content_type, page):
    """TourAPI 목록 한 페이지(최대 1000개)를 받아 item 리스트로 돌려줌"""
    global calls
    params = {
        'serviceKey': key, 'MobileOS': 'WIN', 'MobileApp': 'TripMate', '_type': 'json',
        'numOfRows': 1000, 'pageNo': page, 'arrange': 'C', 'contentTypeId': content_type,
    }
    url = BASE + '?' + urllib.parse.urlencode(params)
    for attempt in range(3):
        try:
            calls += 1
            with urllib.request.urlopen(url, timeout=60) as res:
                text = res.read().decode('utf-8')
            data = json.loads(text)
            body = data['response']['body']
            items = body.get('items') or {}
            items = items.get('item', []) if isinstance(items, dict) else []
            if isinstance(items, dict):
                items = [items]
            return items, int(body.get('totalCount', 0))
        except json.JSONDecodeError:
            sys.exit('API가 JSON이 아닌 응답을 보냈습니다(인증키 오류일 가능성):\n' + text[:500])
        except Exception as e:
            print('  재시도', attempt + 1, e)
            time.sleep(3)
    sys.exit('API 호출이 계속 실패했습니다. 인터넷 연결과 인증키를 확인해 주세요.')


def download_all(key):
    """콘텐츠 종류별로 전국 데이터를 모두 받아 raw 폴더에 저장 (이미 받은 건 건너뜀)"""
    os.makedirs(RAW_DIR, exist_ok=True)
    all_items = []
    for ct in CONTENT_TYPES:
        cache = os.path.join(RAW_DIR, f'type_{ct}.json')
        if os.path.exists(cache):
            items = json.load(open(cache, encoding='utf-8'))
            print(f'[{ct}] 저장된 원본 사용: {len(items)}개')
        else:
            items, page = [], 1
            while True:
                chunk, total = fetch_page(key, ct, page)
                items += chunk
                print(f'[{ct}] {page}페이지 — {len(items)}/{total}')
                if not chunk or len(items) >= total:
                    break
                page += 1
                time.sleep(0.3)
            json.dump(items, open(cache, 'w', encoding='utf-8'), ensure_ascii=False)
        all_items += items
    return all_items


def to_float(v):
    """좌표 문자열을 숫자로. 'null'·빈칸처럼 숫자가 아니면 0 (→ 좌표 없음으로 제외)"""
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


# 주소 첫 단어(시·도) 표기가 제각각이라 하나로 맞춤 — 원본에서 실제로 나온 표기들 ('경남', '강원도', '부산시', 오타 등)
SIDO_ALIAS = {
    '서울': '서울특별시', '부산': '부산광역시', '부산광역': '부산광역시', '부산시': '부산광역시',
    '대구': '대구광역시', '인천': '인천광역시', '울산': '울산광역시', '대전': '대전광역시',
    '광주특별시': '광주광역시', '광주광역사': '광주광역시', '광주': '광주광역시',
    '경기': '경기도', '강원': '강원특별자치도', '강원도': '강원특별자치도',
    '충북': '충청북도', '충남': '충청남도', '경북': '경상북도', '경남': '경상남도',
    '전북': '전북특별자치도', '전라북도': '전북특별자치도', '전북특별자치시': '전북특별자치도',
    '전라남도': '전남광주통합특별시', '전남': '전남광주통합특별시', '전남광주': '전남광주통합특별시',
    '전남광주통합특별': '전남광주통합특별시', '전남광주통특별시': '전남광주통합특별시',
    '제주': '제주특별자치도', '제주특별자치': '제주특별자치도',
}
MERGED = '전남광주통합특별시'   # 원본 주소에 나오는 통합 시·도 (옛 광주광역시 구 + 전라남도 시·군)


def region_of(addr):
    """주소 첫 두 단어로 지역 이름 결정. 예) '강원특별자치도 강릉시 ...' → ('강원특별자치도', '강릉')"""
    parts = (addr or '').split()
    if not parts:
        return None, None
    sido = SIDO_ALIAS.get(parts[0], parts[0])
    if sido == '광주광역시':                             # 옛 표기 → 통합 시·도의 '광주' 지역으로
        return MERGED, '광주'
    if sido in METRO:
        return sido, METRO[sido]
    if len(parts) < 2:
        return None, None
    if sido == MERGED and parts[1][-1] == '구':          # 옛 광주광역시의 구 → 광주 한 지역으로
        return sido, '광주'
    if parts[1][-1] in '시군':
        return sido, parts[1][:-1] if len(parts[1]) > 2 else parts[1]   # '강릉시'→'강릉', '고성군'→'고성'
    return None, None


def defaults_for(item):
    ct = int(item.get('contenttypeid') or 0)
    for code in (item.get('cat2'), item.get('cat1')):
        if code and code in DEFAULTS:
            return DEFAULTS[code]
    return DEFAULTS.get(ct)


from popularity import popularity_for, REF_MONTH   # 인기도(티맵 연관 관광지 순위 기반) — tools/popularity.py

# 세부 분류(lclsSystm3, 201가지)별 점수표 — tools/make_lcls_scores.py 로 만든 lcls_scores.json
_LCLS_PATH = os.path.join(HERE, 'lcls_scores.json')
LCLS = json.load(open(_LCLS_PATH, encoding='utf-8')) if os.path.exists(_LCLS_PATH) else {}
# 제외 분류에 있어도 장소별로 추천 후보에 다시 넣는 목록 — tools/make_recommend_overrides.py
_OV_PATH = os.path.join(HERE, 'recommend_overrides.json')
OVERRIDES = json.load(open(_OV_PATH, encoding='utf-8')) if os.path.exists(_OV_PATH) else {}


def to_place(item, region, sido):
    ct = int(item['contenttypeid'])
    code = item.get('lclsSystm3') or ''
    lc = LCLS.get(code)
    if lc:                                    # 세부 분류 점수표가 있으면 그것을 사용
        tags, cost, stay, cat_name, rec = lc['tags'], lc['cost'], lc['stayMin'], lc['name'], lc['recommend']
    else:                                     # 없으면 예전 분류(cat2)·콘텐츠 종류별 기본값
        d = defaults_for(item)
        tags, cost, stay = dict(zip(TAG_NAMES, d['tags'])), d['cost'], d['stayMin']
        cat_name, rec = item.get('cat2') or str(ct), True
    ov = OVERRIDES.get(str(item['contentid']))
    if ov:
        rec = ov['recommend']
    audience = ov.get('audience', '') if ov else ''
    lat, lng = to_float(item['mapy']), to_float(item['mapx'])
    name = item.get('title', '').strip()
    return {
        'id': int(item['contentid']),
        'region': region,
        'sido': sido,
        'name': name,
        'type': PLACE_TYPE[ct],
        'category': code,
        'categoryName': cat_name,
        'recommend': rec,
        'audience': audience,                 # '10대'면 청소년 전용·청소년 대상 공간                     # False면 추천 후보에서 제외 (사후면세점·대형마트·교통시설 등)
        'tags': tags,
        'popularity': popularity_for(item)[0],   # 0~5, 티맵 이동 데이터 기반 (자료에 없으면 0)
        'popularityRaw': popularity_for(item)[1],
        'lat': round(lat, 6), 'lng': round(lng, 6),
        'cost': cost,
        'stayMin': stay,
        'address': item.get('addr1', ''),
        'photo': item.get('firstimage', ''),
        'photoLicense': item.get('cpyrhtDivCd', ''),
        'link': 'https://map.kakao.com/link/map/' + urllib.parse.quote(name) + f',{lat},{lng}',
    }


def pick_balanced(places, limit):
    """사진 있는 것 우선, 분류(category)가 골고루 섞이도록 돌아가며 limit개 고르기"""
    groups = defaultdict(list)
    for p in places:
        groups[p['category']].append(p)
    for g in groups.values():
        g.sort(key=lambda p: (p['photo'] == '',))      # 사진 있는 것 먼저 (원래 순서 = 최근 수정순 유지)
    picked, order = [], sorted(groups, key=lambda c: -len(groups[c]))
    while len(picked) < limit and any(groups[c] for c in order):
        for c in order:
            if groups[c] and len(picked) < limit:
                picked.append(groups[c].pop(0))
    return picked


def load_curated():
    path = os.path.join(HERE, 'curated_places.json')
    return json.load(open(path, encoding='utf-8')) if os.path.exists(path) else []


# 여행지로 보기 어려운 항목을 이름으로 걸러내는 규칙 (걸러진 목록은 tools/excluded_places.csv 로 남김)
#  - 끝말 규칙: 괄호를 뺀 이름이 이 말로 끝날 때만 제외 ('고양 화장실전시관'·'BTS 버스정류장' 같은 명소는 남김)
EXCLUDE_ENDINGS = ['화장실', '주차장', '관광안내소', '탐방안내소', '관광안내센터', '안내센터', '마트', '주유소', '충전소']
#  - 포함 규칙: 이름 어디에든 들어 있으면 제외 (편의점·생활용품점·체인 매장)
EXCLUDE_WORDS = ['편의점', '식자재', 'GS25', 'CU ', '세븐일레븐', '미니스톱', '이마트24', '다이소',
                 'ABC마트', '올리브영', '스파오', '슈마커', '미즈노', '컨버스', '아트박스', '유니클로', '탑텐',
                 '뉴발란스', '나이키', '아디다스', '롯데리아', '맥도날드', '버거킹', '스타벅스', '이디야',
                 '투썸플레이스', '메가MGC', '컴포즈커피', '빽다방', '파리바게뜨', '뚜레쥬르', '폴더 ']


def exclude_reason(it):
    """걸러낼 이유를 돌려줌 (걸러내지 않으면 빈 문자열)"""
    name = (it.get('title') or '').strip()
    base = re.sub(r'\(.*?\)|\[.*?\]', '', name).strip()      # 괄호 안 설명 빼기
    for w in EXCLUDE_ENDINGS:
        if base.endswith(w) and base != w:
            return '이름이 "' + w + '"로 끝남'
    for w in EXCLUDE_WORDS:
        if w in name + ' ':
            return '이름에 "' + w.strip() + '"'
    return ''


def main():
    key = read_key()
    items = download_all(key)
    print(f'\n받은 원본 합계: {len(items)}개 (API 호출 {calls}회)')

    # (시·도, 지역) 쌍으로 묶음 — 강원 고성군·경남 고성군처럼 이름이 같은 지역을 구분하기 위함
    groups = defaultdict(list)
    no_coord, excluded, seen = 0, [], set()
    for it in items:
        if int(it.get('contenttypeid') or 0) not in PLACE_TYPE or it['contentid'] in seen:
            continue
        seen.add(it['contentid'])
        sido, region = region_of(it.get('addr1'))
        if to_float(it.get('mapx')) == 0 or to_float(it.get('mapy')) == 0 or not region:
            no_coord += 1
            continue
        reason = exclude_reason(it)
        if reason:
            excluded.append((it['contentid'], region, it.get('title', ''), reason))
            continue
        groups[(sido, region)].append(it)

    # 이름이 겹치는 지역은 '고성(강원)'·'광주(경기)'처럼 시·도 약칭을 붙임 (광역시는 그대로)
    SHORT = {'경상남도': '경남', '경상북도': '경북', '전라남도': '전남', '전라북도': '전북',
             '전북특별자치도': '전북', '충청남도': '충남', '충청북도': '충북', '경기도': '경기',
             '강원도': '강원', '강원특별자치도': '강원', '제주특별자치도': '제주', MERGED: '전남'}
    name_count = defaultdict(int)
    for sido, region in groups:
        name_count[region] += 1

    # 직접 고른 장소(강릉·경주·전주·여수 112곳): 점수를 curated_places.json 값으로 덮어쓰고 featured 표시
    curated = {c['id']: c for c in load_curated()}

    out_dir = os.path.join(ROOT, 'data', 'places')
    os.makedirs(out_dir, exist_ok=True)
    regions, total = [], 0
    for (sido, region), lst in sorted(groups.items(), key=lambda kv: kv[0][1]):
        label = region if (name_count[region] == 1 or sido in METRO or (sido, region) == (MERGED, '광주')) \
            else f'{region}({SHORT.get(sido, sido[:2])})'
        places = []
        for it in lst:
            p = to_place(it, label, sido)
            c = curated.get(p['id'])
            if c:
                p['popularity'] = max(p['popularity'], 4.0)
                p.update(tags=c['tags'], cost=c['cost'], stayMin=c['stayMin'], featured=True,
                         costCheck=c['costCheck'], basis=c['basis'], scoredBy=c['scoredBy'])
            else:
                p.update(featured=False, costCheck='추정', basis=p['categoryName'], scoredBy='세부분류 기본값(Claude 판단)')
            places.append(p)
        places.sort(key=lambda p: (not p['featured'], -p['popularity'], p['photo'] == '', p['name']))   # 직접 고른 곳·사진 있는 곳 먼저
        json.dump(places, open(os.path.join(out_dir, label + '.json'), 'w', encoding='utf-8'),
                  ensure_ascii=False, separators=(',', ':'))
        total += len(places)

        # 지역 요약 — 추천 알고리즘이 지역 파일을 전부 열지 않고도 지역 점수를 계산할 수 있게 미리 계산
        sights = [p for p in places if p['type'] == '명소' and p['recommend']]
        tag_avg = {t: round(sum(p['tags'][t] for p in sights) / len(sights), 2) if sights else 0 for t in TAG_NAMES}
        regions.append({
            'region': label, 'sido': sido, 'file': 'data/places/' + label + '.json',
            'lat': round(sum(p['lat'] for p in places) / len(places), 5),
            'lng': round(sum(p['lng'] for p in places) / len(places), 5),
            'counts': {t: sum(1 for p in places if p['type'] == t) for t in ('명소', '식당', '숙소')},
            'featured': sum(1 for p in places if p['featured']),
            'tagAvg': tag_avg,
            # 지역 인기도: 추천 후보 명소 중 인기도 상위 10곳의 평균 (0~5)
            'popTop10': round(sum(sorted((p['popularity'] for p in sights), reverse=True)[:10]) / 10, 2),
        })

    json.dump(regions, open(os.path.join(ROOT, 'data', 'regions.json'), 'w', encoding='utf-8'),
              ensure_ascii=False, indent=1)
    with open(os.path.join(HERE, 'excluded_places.csv'), 'w', encoding='utf-8-sig') as f:
        f.write('id,지역,이름,걸러낸 이유\n')
        for row in excluded:
            f.write(','.join('"' + str(v).replace('"', "'") + '"' for v in row) + '\n')

    print(f'완료: 지역 {len(regions)}곳, 장소 {total}개 → data/places/지역.json, data/regions.json')
    print(f'좌표·주소가 없어 제외: {no_coord}개 / 규칙으로 걸러냄: {len(excluded)}개 (tools/excluded_places.csv)')
    no_lodging = [r['region'] for r in regions if r['counts']['숙소'] == 0]
    if no_lodging:
        print('숙소가 없는 지역:', ', '.join(no_lodging))


if __name__ == '__main__':
    main()
