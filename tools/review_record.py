# -*- coding: utf-8 -*-
# 후기 기반 확인 결과를 tools/review_check.json에 기록하고, 제외 판정은 data/places/<지역>.json의 recommend에 바로 반영
# 입력: 표준 입력으로 '장소id|판정|이유' 줄들 (판정: keep 유지 / drop 추천 제외 / none 찾지 못함)
# 출력: review_check.json { id: { verdict, reason, checked, how } } — 평점 숫자는 저장하지 않음(구글 지도 데이터 약관, 계획서 결정)
#       drop이면 장소 파일의 recommend=False, reviewNote=이유 (build_places.py가 다시 만들어도 이 파일을 읽어 다시 적용)
import json, os, sys, datetime
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PATH = os.path.join(HERE, 'review_check.json')
check = json.load(open(PATH, encoding='utf-8')) if os.path.exists(PATH) else {}
queue = {str(q['id']): q for q in json.load(open(os.path.join(HERE, 'review_queue.json'), encoding='utf-8'))}
today = datetime.date.today().isoformat()
by_region = {}
for line in sys.stdin.read().splitlines():
    if not line.strip(): continue
    pid, verdict, reason = (line.split('|') + ['', ''])[:3]
    pid = pid.strip()
    check[pid] = {'verdict': verdict.strip(), 'reason': reason.strip(), 'checked': today, 'how': '구글 지도 평점·후기 확인 (Claude)'}
    if pid in queue: by_region.setdefault(queue[pid]['region'], []).append(pid)
for region, ids in by_region.items():
    f = os.path.join(ROOT, 'data', 'places', region + '.json')
    places = json.load(open(f, encoding='utf-8'))
    for p in places:
        c = check.get(str(p['id']))
        if c and c['verdict'] == 'drop':
            p['recommend'] = False
            p['reviewNote'] = c['reason']
    json.dump(places, open(f, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
json.dump(check, open(PATH, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
v = [c['verdict'] for c in check.values()]
print('확인', len(check), '/ 유지', v.count('keep'), '/ 제외', v.count('drop'), '/ 못 찾음', v.count('none'))
