# -*- coding: utf-8 -*-
"""
웹 검색으로 찾은 숙소 객실 요금을 기록 (Claude가 여기어때 숙소 페이지를 날짜별로 열어 본 결과)
입력(표준입력, JSON 배열): [{ "id": 숙소id, "url": 여기어때 주소 또는 "", "wd": "주중 페이지 객실 줄들", "we": "주말 페이지 객실 줄들", "note": "" }]
  - 객실 줄 형식: "객실명 | 기준인원 | 최대인원 | 가격"  (여기어때 숙소 페이지를 그 날짜로 열어 읽은 그대로)
  - wd = 2026-10-14(수) 1박, we = 2026-10-17(토) 1박 → 비수기 주중·주말 요금으로 사용
  - 같은 객실의 패키지([조식 2인 패키지] 등 대괄호)는 이름에서 떼고 가장 싼 값만 남김, 가격 '없음'(마감)은 빼기
  - wd·we가 모두 비어 있으면 '못 찾음'으로 기록 (다시 찾지 않게)
출력: tools/rooms_search.json — { 숙소id: { rooms: [{ name, base, max, off: [wd, we], peak: [0, 0] }], url, note, checked } }
      → python tools/merge_rooms.py 로 장소 파일에 넣음 (TourAPI 요금이 없는 숙소만, 표시는 '검색 추정')
"""
import json, os, re, sys, datetime
PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'rooms_search.json')
data = json.load(open(PATH, encoding='utf-8')) if os.path.exists(PATH) else {}
def num(v):
    m = re.sub(r'[^0-9]', '', str(v))
    return int(m) if m else 0


def parse(text, k, rooms):
    for line in (text or '').splitlines():
        parts = [x.strip() for x in line.split('|')]
        if len(parts) < 4:
            continue
        name = re.sub(r'\s+', ' ', re.sub(r'\[[^\]]*\]', '', parts[0])).strip() or parts[0]
        price = num(parts[3])
        if not (10000 <= price <= 5000000):
            continue
        r = rooms.setdefault(name, {'name': name, 'base': num(parts[1]), 'max': num(parts[2]) or num(parts[1]), 'off': [0, 0], 'peak': [0, 0]})
        r['off'][k] = price if not r['off'][k] else min(r['off'][k], price)


items = json.load(sys.stdin)
for it in items:
    rooms = {}
    parse(it.get('wd'), 0, rooms)
    parse(it.get('we'), 1, rooms)
    rooms = list(rooms.values())
    data[str(it['id'])] = {'rooms': rooms, 'url': it.get('url', ''), 'note': it.get('note', ''),
                           'checked': datetime.date.today().isoformat()}
json.dump(data, open(PATH, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
found = sum(1 for v in data.values() if v['rooms'])
print(f'기록 {len(items)}곳 → 누적 {len(data)}곳 (요금 찾음 {found}곳)')
