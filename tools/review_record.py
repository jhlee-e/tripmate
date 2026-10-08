# -*- coding: utf-8 -*-
# 후기 기반 확인 결과를 tools/review_check.json에 기록하고, 제외 판정은 data/places/<지역>.json의 recommend에 바로 반영
# 입력: 표준 입력으로 '장소id|판정|이유|추가정보(JSON, 없어도 됨)' 줄들 (판정: keep 유지 / drop 추천 제외 / none 찾지 못함)
#   추가정보 (후기 5개와 영업시간을 읽고 Claude가 정리한 값 — 2026-10-09 이재훈 요청 1~8번 항목)
#     q: 품질 등급 'A'|'B'|'C'|'D' — 평균 별점과 후기 수를 함께 본 보정 점수(베이즈 평균, 기준 4.0·가중 50개)로 나눔, 숫자는 저장 안 함
#     solo: 혼자 이용 가능 여부(true/false), minPeople: 최소 주문 인원, group: 단체 가능 여부
#     waitMin: 후기에 나온 대략의 대기 시간(분), issues: 반복되는 문제 신호(위생·불친절·바가지 등)
#     parking / kids / pet: 주차·아이 동반·반려동물 동반 (후기·정보에 나온 경우만)
#     closed: 정기 휴무 요일 ['월'..'일'], open/close: 'HH:MM', break: 'HH:MM-HH:MM' (구글 지도 영업시간)
# 출력: review_check.json { id: { verdict, reason, checked, how } } — 평점 숫자는 저장하지 않음(구글 지도 데이터 약관, 계획서 결정)
#       drop이면 장소 파일의 recommend=False, reviewNote=이유 (build_places.py가 다시 만들어도 이 파일을 읽어 다시 적용)
import json, os, sys, datetime
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PATH = os.path.join(HERE, 'review_check.json')
check = json.load(open(PATH, encoding='utf-8')) if os.path.exists(PATH) else {}
queue = {str(q['id']): q for q in json.load(open(os.path.join(HERE, 'review_queue.json'), encoding='utf-8'))}
today = datetime.date.today().isoformat()
INFO_KEYS = ('q', 'solo', 'minPeople', 'group', 'waitMin', 'issues', 'parking', 'kids', 'pet', 'closed', 'open', 'close', 'break')
by_region = {}
for line in sys.stdin.read().splitlines():
    if not line.strip(): continue
    parts = line.split('|', 3)
    pid, verdict, reason = (parts + ['', ''])[:3]
    extra = json.loads(parts[3]) if len(parts) > 3 and parts[3].strip() else {}
    pid = pid.strip()
    check[pid] = dict({'verdict': verdict.strip(), 'reason': reason.strip(), 'checked': today, 'how': '구글 지도 평점·후기 5개·영업시간 확인 (Claude)'}, **extra)
    if pid in queue: by_region.setdefault(queue[pid]['region'], []).append(pid)
for region, ids in by_region.items():
    f = os.path.join(ROOT, 'data', 'places', region + '.json')
    places = json.load(open(f, encoding='utf-8'))
    for p in places:
        c = check.get(str(p['id']))
        if not c: continue
        if c['verdict'] == 'drop':
            p['recommend'] = False
            p['reviewNote'] = c['reason']
        info = {k: v for k, v in c.items() if k in INFO_KEYS and v not in (None, '', [])}
        if info: p['info'] = info
    json.dump(places, open(f, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
json.dump(check, open(PATH, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
v = [c['verdict'] for c in check.values()]
print('확인', len(check), '/ 유지', v.count('keep'), '/ 제외', v.count('drop'), '/ 못 찾음', v.count('none'))
