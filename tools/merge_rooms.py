# -*- coding: utf-8 -*-
"""
객실 정보를 장소 파일에 넣기
입력: tools/raw/rooms.json (fetch_rooms.py, TourAPI), tools/rooms_search.json (Claude 웹 검색 보충, 있으면)
출력: data/places/지역.json 의 숙소마다
        rooms = [{ name, base, max, off: [주중, 주말], peak: [주중, 주말], src: 'tourapi' | 'search' }]  (요금은 방 1개 1박, 0 = 모름)
        cost = 가장 싼 객실의 비수기 주중 요금 (목록·필터용), costCheck = 'TourAPI 객실' | '검색 추정'
      tools/rooms_missing.csv — 요금을 하나도 못 구한 숙소 목록 (웹 검색으로 보충할 대상)
실행: python tools/merge_rooms.py  → 그다음 python tools/add_region_costs.py (지역별 최소 숙박비 다시 계산)
"""
import csv, json, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
FOLDER = os.path.join(ROOT, 'data', 'places')


def num(v):
    m = re.sub(r'[^0-9]', '', str(v or ''))
    return int(m) if m else 0


def from_tourapi(items):
    rooms = []
    for it in items:
        r = {'name': (it.get('roomtitle') or '객실').strip(), 'base': num(it.get('roombasecount')), 'max': num(it.get('roommaxcount')),
             'off': [num(it.get('roomoffseasonminfee1')), num(it.get('roomoffseasonminfee2'))],
             'peak': [num(it.get('roompeakseasonminfee1')), num(it.get('roompeakseasonminfee2'))], 'src': 'tourapi'}
        if not r['max']:
            r['max'] = r['base']
        # 1만 원 미만·500만 원 초과는 입력 실수로 보고 버림 (Claude 판단)
        for k in ('off', 'peak'):
            r[k] = [v if 10000 <= v <= 5000000 else 0 for v in r[k]]
        if any(r['off'] + r['peak']):
            rooms.append(r)
    return rooms


def main():
    raw = json.load(open(os.path.join(HERE, 'raw', 'rooms.json'), encoding='utf-8'))
    sp = os.path.join(HERE, 'rooms_search.json')
    search = json.load(open(sp, encoding='utf-8')) if os.path.exists(sp) else {}
    total = with_api = with_search = 0
    missing = []
    for fn in sorted(os.listdir(FOLDER)):
        path = os.path.join(FOLDER, fn)
        places = json.load(open(path, encoding='utf-8'))
        changed = False
        for p in places:
            if p.get('type') != '숙소':
                continue
            total += 1
            rooms = from_tourapi(raw.get(str(p['id']), []))
            src = 'TourAPI 객실'
            if rooms:
                with_api += 1
            elif str(p['id']) in search:
                rooms = [dict(r, src='search') for r in search[str(p['id'])].get('rooms', [])]
                src = '검색 추정'
                if rooms:
                    with_search += 1
            if rooms:
                p['rooms'] = rooms
                fees = [r['off'][0] or r['off'][1] or r['peak'][0] or r['peak'][1] for r in rooms]
                p['cost'] = min(f for f in fees if f)
                p['costCheck'] = src
                changed = True
            else:
                if 'rooms' in p:
                    del p['rooms']; changed = True
                missing.append([p['id'], p['region'], p['name'], p.get('categoryName', ''), p.get('address', ''), p.get('recommend')])
        if changed:
            json.dump(places, open(path, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    with open(os.path.join(HERE, 'rooms_missing.csv'), 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.writer(f)
        w.writerow(['id', 'region', 'name', 'category', 'address', 'recommend'])
        w.writerows(missing)
    print(f'숙소 {total}곳: TourAPI 객실 요금 {with_api}곳, 검색 보충 {with_search}곳, 요금 없음 {len(missing)}곳 (tools/rooms_missing.csv)')


if __name__ == '__main__':
    main()
