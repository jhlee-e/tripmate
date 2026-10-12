# -*- coding: utf-8 -*-
"""
인기도 점수 계산 (0~5)  — build_places.py가 불러 씀
입력: tools/raw/related.json (티맵 이동 데이터 기반 '관광지별 연관 관광지 정보', 시·군·구별 중심 관광지 + 연관 관광지 순위 1~50)
출력: popularity_for(item) → (점수 0~5, 원점수) / 이름이 맞는 장소가 없으면 (0, 0)

원점수(raw) 계산 규칙
 - 어떤 중심 관광지의 '함께 많이 가는 곳' 목록에 순위 r로 나올 때마다 (51 - r) / 50 점 (1위 1.0점, 50위 0.02점)
 - 그 자체가 중심 관광지로 선정돼 있으면 +5점 (시·군·구를 대표하는 관광지)
점수(0~5): 원점수에 로그를 씌워 전국 상위 1% 값을 5점으로 맞춘 뒤 1~5점으로 환산 (자료에 나오면 최소 1점)
이름 맞추기: 띄어쓰기·괄호·기호를 지운 이름이 같은 시·군·구(없으면 같은 시·도) 안에서 같을 때
"""
import json, math, os, re
from functools import lru_cache
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
PATH = os.path.join(HERE, 'raw', 'related.json')


def norm(name):
    s = re.sub(r'\[.*?\]|\(.*?\)', '', name or '')
    s = re.sub(r'[\s/·・,.\-_&]', '', s)
    return s.lower()


def tmap_names(name):
    """티맵 이름 '여수해상케이블카/돌산정류장' → ['여수해상케이블카돌산정류장', '여수해상케이블카'] ('/' 앞 본이름도 등록)"""
    names = {norm(name)}
    if '/' in (name or ''):
        names.add(norm(name.split('/')[0]))
    return [n for n in names if len(n) >= 2]


RAW_BY_SGG = defaultdict(float)     # (signguCd, 이름) → 원점수
RAW_BY_SIDO = defaultdict(float)    # (시도코드, 이름) → 원점수
KIND_BY_SGG = defaultdict(set)      # (signguCd, 이름) → 티맵 분류 {'관광지','음식','숙박'} (자동 맞추기에서 종류가 같은 것끼리만)
REF_MONTH = None
if os.path.exists(PATH):
    data = json.load(open(PATH, encoding='utf-8'))
    centers = {}
    for v in data.values():
        REF_MONTH = REF_MONTH or v.get('baseYm')
        for i in v['items']:
            w = (51 - int(i['rlteRank'])) / 50
            for nm in tmap_names(i['rlteTatsNm']):
                RAW_BY_SGG[(i['rlteSignguCd'], nm)] += w
                KIND_BY_SGG[(i['rlteSignguCd'], nm)].add(i.get('rlteCtgryLclsNm') or '')
                RAW_BY_SIDO[(i['rlteRegnCd'], nm)] += w
            for nm in tmap_names(i['tAtsNm']):
                centers[(i['signguCd'], nm)] = i['areaCd']
                KIND_BY_SGG[(i['signguCd'], nm)].add('관광지')   # 중심 관광지
    for (sgg, nm), area in centers.items():
        RAW_BY_SGG[(sgg, nm)] += 5
        RAW_BY_SIDO[(area, nm)] += 5
    vals = sorted(RAW_BY_SGG.values())
    TOP = vals[int(len(vals) * 0.99)] if vals else 1
else:
    TOP = 1


_REGION_WORDS = {f[:-5].split('(')[0] for f in os.listdir(os.path.join(os.path.dirname(HERE), 'data', 'places'))} \
    if os.path.isdir(os.path.join(os.path.dirname(HERE), 'data', 'places')) else set()
_REGION_WORDS |= {'서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종', '경기', '강원', '충북', '충남',
                  '전북', '전남', '경북', '경남', '제주'}


def is_place_word(w):
    return w in _REGION_WORDS or (len(w) >= 2 and w[-1] in '시군도' and w[:-1] in _REGION_WORDS)


def name_candidates(title):
    """'경주 불국사 [유네스코 세계유산]' → ['경주불국사', '불국사'] (앞의 지역 이름을 뗀 것도 시도)"""
    t = re.sub(r'\[.*?\]|\(.*?\)', '', title or '').strip()
    cands = [norm(t)]
    words = t.split()
    # 앞 단어가 지역 이름일 때만 떼어 봄 ('경주 불국사'→'불국사', '전북 전주 한옥마을'→'한옥마을')
    #  ('부쉐론 현대백화점…'처럼 브랜드 이름을 떼서 백화점 인기도를 물려받는 오류를 막기 위함)
    while len(words) >= 2 and is_place_word(words[0]):
        words = words[1:]
        cands.append(norm(' '.join(words)))
    # '한려해상국립공원 (오동도)' → '오동도' — 단 '보천사(군산)'처럼 괄호 안이 지역 이름이면 넣지 않음
    #  (2026-10-11 수정: '군산'이 '군산역' 인기도를 물려받는 오류 방지)
    cands += [norm(x) for x in re.findall(r'\((.*?)\)', title or '') if not is_place_word(norm(x))]
    return [c for c in cands if len(c) >= 2]


def raw_for(item):
    area, sgg = item.get('lDongRegnCd') or '', item.get('lDongSignguCd') or ''
    area = area[:2]                                   # 세종은 '36110'처럼 들어 있어 앞 2자리만
    code = sgg if (len(sgg) == 5 and sgg.startswith(area)) else area + sgg
    cands = name_candidates(item.get('title'))
    for nm in cands:
        v = RAW_BY_SGG.get((code, nm)) or RAW_BY_SIDO.get((area, nm))
        if v:
            return v
    # 자동 맞추기에는 괄호 안 이름을 쓰지 않음 ('열안지오름(오라동)'의 '오라동'이 '오라동메밀밭'에 붙는 오류 방지)
    plain = name_candidates(re.sub(r'\(.*?\)', '', item.get('title') or ''))
    return fuzzy_raw(code, plain, TOUR_KIND.get(int(item.get('contenttypeid') or 0)), item.get('title') or '')


# TourAPI 콘텐츠 종류 → 티맵 분류 (12 관광지, 14 문화시설, 28 레포츠, 38 쇼핑, 39 음식점, 32 숙박)
TOUR_KIND = {12: '관광지', 14: '관광지', 28: '관광지', 38: '관광지', 39: '음식', 32: '숙박'}


# ---------- 이름 불일치 자동 맞추기 (2026-10-11 이재훈 요청, 규칙은 Claude 설계) ----------
# 같은 시·군·구 안에서만, 아래 규칙 중 하나가 맞으면 같은 곳으로 봄
#  1) 같은 뜻 낱말을 맞춘 뒤 이름이 같음: 컨트리클럽·골프클럽·골프장 = cc, 끝의 '시장' = '장' ('남창장' = '남창시장')
#  2) 앞에 붙은 지역 이름을 떼면 같음 ('거제숲소리공원' = '숲소리공원')
#  3) 한쪽이 다른 쪽의 앞부분 ('남포향교대성전' ⊃ '남포향교', '국제시장먹자골목' ⊃ '국제시장') — 짧은 쪽 3글자 이상
#  4) 한쪽이 다른 쪽의 뒷부분 ('해인사백련암' ⊃ '백련암') — 짧은 쪽에서 흔한 종류 이름(캠핑장·공원 등)을 뺀 나머지가 3글자 이상
#     ('솔바다캠핑장' ⊃ '바다캠핑장'처럼 흔한 말만 겹치는 경우를 막기 위함)
#  가운데에 끼어 있는 경우('니뽕내뽕웨스턴돔점' ⊃ '웨스턴돔')는 맞추지 않음
#  여러 곳이 맞으면 겹치는 글자가 가장 많은 곳 하나
SYNONYMS = [('컨트리클럽', 'cc'), ('골프클럽', 'cc'), ('골프장', 'cc'), ('cc', 'cc')]
GENERIC_TAILS = sorted(['오토캠핑장', '캠핑장', '캠핑리조트', '글램핑', '근린공원', '공원', '해수욕장', '해변', '시장', '전통시장',
                        '박물관', '미술관', '기념관', '전시관', '전망대', '수목원', '유원지', '관광지', '마을', '체험마을',
                        '휴양림', '자연휴양림', '계곡', '폭포', '저수지', '호수', '산', '섬', '해안', '항', '포구', '리조트', '랜드',
                        '테마파크', '공방', '체험장', '센터', '광장', '거리', '길', '숲', 'cc',
                        '스키장', '썰매장', '물놀이장', '낚시터', '식당', '카페', '베이커리', '시네마', '극장'], key=len, reverse=True)
_REGION_SORTED = sorted((w for w in _REGION_WORDS if len(w) >= 2), key=len, reverse=True)
NAMES_BY_SGG = defaultdict(set)
for (_sgg, _nm) in list(RAW_BY_SGG):
    NAMES_BY_SGG[_sgg].add(_nm)


@lru_cache(maxsize=None)
def canon(n):
    for a, b in SYNONYMS:
        n = n.replace(a, b)
    if n.endswith('시장') and len(n) > 3:
        n = n[:-2] + '장'
    return n


@lru_cache(maxsize=None)
def strip_region(n):
    for w in _REGION_SORTED:
        if len(w) >= 2 and n.startswith(w) and len(n) - len(w) >= 2:
            return n[len(w):]
    return n


@lru_cache(maxsize=None)
def stem_len(n):
    if n in GENERIC_TAILS:
        return 0
    for t in GENERIC_TAILS:
        if n.endswith(t) and len(n) > len(t):
            return len(n) - len(t)
    return len(n)


@lru_cache(maxsize=None)
def match_len(a, b):
    """두 이름이 같은 곳이면 겹치는 글자 수, 아니면 0"""
    a0, b0 = a, b
    a, b = canon(a), canon(b)
    if a == b:
        return len(a)
    a2, b2 = strip_region(a), strip_region(b)
    if a2 == b2 and len(a2) >= 2 and stem_len(a2) >= 2:   # '광명식당'·'성주식당'처럼 지역 이름만 다르고 흔한 말만 남으면 다른 곳
        return len(a2)
    # 앞·뒷부분 비교는 원래 이름으로만 ('고성시장'→'고성장'으로 바꾼 뒤 '고성장산리…'에 붙는 오류 방지)
    for x, y in ((a0, b0), (strip_region(a0), strip_region(b0))):
        short, long_ = (x, y) if len(x) <= len(y) else (y, x)
        if len(short) < 3 or short == long_:
            continue
        if long_.startswith(short):
            return len(short)
        if long_.endswith(short) and stem_len(short) >= 3:
            return len(short)
    return 0


def brand_prefix(title, extra):
    """'MLB 롯데프리미엄아울렛 김해점'처럼 앞 단어(들)가 통째로 붙어 있는지 — 매장 이름 앞의 브랜드
    (브랜드 매장이 백화점·아울렛 인기도를 물려받지 않게, 지역 이름이면 괜찮음)"""
    words = re.sub(r'\[.*?\]|\(.*?\)', '', title).split()
    acc = ''
    for w in words[:-1]:
        acc += norm(w)
        if acc == extra:
            return not is_place_word(norm(w)) and not is_place_word(acc)
        if len(acc) >= len(extra):
            break
    return False


CAMP_WORDS = ('캠핑장', '캠핑', '글램핑', '카라반', '펜션')


def prefix_ok(c, nm):
    """앞부분이 겹치는 경우 추가 조건 (시험 결과를 보고 2026-10-11 Claude가 덧붙임)
     - 우리 장소가 짧고 티맵 이름이 더 긴 경우('섬진강' → '섬진강파크골프장', '토함산' → '토함산자연휴양림'):
       우리 장소 이름이 4글자 이상이고, 덧붙은 부분이 우리 이름보다 길지 않을 때만
     - 우리 장소가 '티맵 이름 + 캠핑장'인 경우('보경사힐링캠핑장' → '보경사'): 다른 시설이라 맞추지 않음"""
    for x, y in ((c, nm), (strip_region(c), strip_region(nm))):
        if x == y or canon(x) == canon(y):
            return stem_len(x) >= 2 or (x, y) == (c, nm)
        if y.startswith(x) and len(y) > len(x):
            if len(x) >= 4 and len(y) - len(x) <= len(x):
                return True
            continue
        if x.startswith(y) and len(x) > len(y):
            if not x[len(y):].endswith(CAMP_WORDS):
                return True
            continue
        if x.endswith(y) or y.endswith(x):
            return True
    return False


def is_sub_part(c, nm):
    """우리 장소가 '티맵 이름 + 덧붙은 말'인 경우('선운사백파율사비' → '선운사', '공산성쌍수정' → '공산성')
    큰 명소 안의 작은 시설이라 원점수를 절반만 물려받음 (Claude 판단)"""
    for x, y in ((c, nm), (strip_region(c), strip_region(nm))):
        if x == y or canon(x) == canon(y):
            return False
    x, y = strip_region(c), strip_region(nm)
    return (c.startswith(nm) and len(c) > len(nm)) or (x.startswith(y) and len(x) > len(y))


def fuzzy_raw(code, cands, kind=None, title=''):
    best, best_len, best_nm = 0.0, 0, ''
    for nm in NAMES_BY_SGG.get(code, ()):
        if kind and kind not in KIND_BY_SGG.get((code, nm), ()):
            continue                     # 명소는 티맵 '관광지', 식당은 '음식', 숙소는 '숙박'끼리만
        for c in cands:
            m = match_len(c, nm)
            if not m:
                continue
            if len(c) > len(nm) and c.endswith(nm) and brand_prefix(title, c[:len(c) - len(nm)]):
                continue                 # 브랜드 + 매장 이름
            if not prefix_ok(c, nm):
                continue
            if kind == '음식' and not (c.startswith(nm) or nm.startswith(c) or strip_region(c) == strip_region(nm)
                                     or canon(c) == canon(nm)):
                continue                 # 식당은 뒷부분만 겹치면 안 맞춤 ('현리양평해장국' ≠ '양평해장국' — 흔한 음식 이름)
            v = RAW_BY_SGG[(code, nm)] * (0.5 if is_sub_part(c, nm) else 1)
            if m > best_len or (m == best_len and v > best):
                best, best_len, best_nm = v, m, nm
    FUZZY_LAST[0] = best_nm   # 자동으로 맞춘 티맵 이름 (확인용)
    return best if best_len else 0.0


FUZZY_LAST = ['']


def popularity_for(item):
    FUZZY_LAST[0] = ''
    raw = raw_for(item)
    if raw <= 0:
        return 0, 0.0
    score = 1 + 4 * min(1.0, math.log1p(raw) / math.log1p(TOP))
    return round(score, 1), round(raw, 2)
