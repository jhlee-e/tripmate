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
                RAW_BY_SIDO[(i['rlteRegnCd'], nm)] += w
            for nm in tmap_names(i['tAtsNm']):
                centers[(i['signguCd'], nm)] = i['areaCd']
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
    cands += [norm(x) for x in re.findall(r'\((.*?)\)', title or '')]   # '한려해상국립공원 (오동도)' → '오동도'
    return [c for c in cands if len(c) >= 2]


def raw_for(item):
    area, sgg = item.get('lDongRegnCd') or '', item.get('lDongSignguCd') or ''
    for nm in name_candidates(item.get('title')):
        v = RAW_BY_SGG.get((area + sgg, nm)) or RAW_BY_SIDO.get((area, nm))
        if v:
            return v
    return 0.0


def popularity_for(item):
    raw = raw_for(item)
    if raw <= 0:
        return 0, 0.0
    score = 1 + 4 * min(1.0, math.log1p(raw) / math.log1p(TOP))
    return round(score, 1), round(raw, 2)
