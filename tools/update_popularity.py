# -*- coding: utf-8 -*-
"""
장소 파일의 인기도만 다시 계산 (build_places.py를 처음부터 다시 돌리지 않고)
입력: tools/raw/type_*.json (TourAPI 원본), tools/raw/related.json (티맵 연관 관광지), data/places/지역.json
출력: data/places/지역.json 의 popularity·popularityRaw·popularityMatch(이름을 자동으로 맞춘 경우 그 티맵 이름),
      data/regions.json 의 popTop10 (추천 후보 명소 인기도 상위 10곳 평균)
      → 바뀐 개수와 '0점 → 점수' 예시를 화면에 출력
2026-10-11: popularity.py에 이름 불일치 자동 맞추기를 넣은 뒤 반영하려고 만듦
실행: python tools/update_popularity.py
"""
import glob, json, os
from popularity import popularity_for, FUZZY_LAST

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

# 카카오 좌표 확인 결과 (tools/verify_popularity.py) — 있으면 '인정 안 함'인 자동 맞춤은 0점으로 (2026-10-12 이재훈 결정)
CHECK_PATH = os.path.join(HERE, 'raw', 'popularity_check.json')
check = json.load(open(CHECK_PATH, encoding='utf-8')) if os.path.exists(CHECK_PATH) else {}
rejected = 0

raw = {}
for f in glob.glob(os.path.join(HERE, 'raw', 'type_*.json')):
    for it in json.load(open(f, encoding='utf-8')):
        raw[str(it['contentid'])] = it

changed = up_from_zero = fuzzy = 0
examples = []
pop_top10 = {}
for f in sorted(glob.glob(os.path.join(ROOT, 'data', 'places', '*.json'))):
    places = json.load(open(f, encoding='utf-8'))
    for p in places:
        it = raw.get(str(p['id']))
        if not it:
            continue
        score, rw = popularity_for(it)
        match = FUZZY_LAST[0]
        c = check.get(str(p['id']))
        if match and c and c.get('match') == match and not c.get('ok'):
            score, rw, match = 0, 0.0, ''      # 카카오로 확인해 보니 다른 곳 → 자동 맞춤 취소
            rejected += 1
        if p.get('featured'):
            score = max(score, 4.0)          # 직접 고른 장소는 최소 4점 (build_places.py와 같음)
        if score != p.get('popularity'):
            changed += 1
            if not p.get('popularity') and score:
                up_from_zero += 1
                if len(examples) < 15:
                    examples.append(f"{p['name']} → {match or '(정확히 일치)'} {score}")
        p['popularity'], p['popularityRaw'] = score, rw
        if match:
            p['popularityMatch'] = match
            fuzzy += 1
        else:
            p.pop('popularityMatch', None)
    json.dump(places, open(f, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    sights = [p for p in places if p['type'] == '명소' and p.get('recommend')]
    pop_top10[os.path.basename(f)[:-5]] = round(sum(sorted((p['popularity'] for p in sights), reverse=True)[:10]) / 10, 2)

rp = os.path.join(ROOT, 'data', 'regions.json')
regions = json.load(open(rp, encoding='utf-8'))
for r in regions:
    if r['region'] in pop_top10:
        r['popTop10'] = pop_top10[r['region']]
json.dump(regions, open(rp, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

print(f'인기도가 바뀐 장소 {changed}곳 (0점 → 점수 {up_from_zero}곳), 이름 자동 맞춤 {fuzzy}곳, 카카오 확인으로 취소 {rejected}곳')
print('\n'.join(examples))

# 구·군 지역(서울 종로구 등)의 popTop10도 다시 계산 (2026-10-12)
import add_districts
add_districts.main()
