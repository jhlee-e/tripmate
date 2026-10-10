# -*- coding: utf-8 -*-
"""
객실 정보를 장소 파일에 넣기
입력: tools/raw/rooms.json (fetch_rooms.py, TourAPI), tools/rooms_search.json (Claude 웹 검색 보충, 있으면)
출력: data/places/지역.json 의 숙소마다
        rooms = [{ name, base, max, off: [주중, 주말], peak: [주중, 주말], src: 'tourapi' | 'search' | 'stats' }]  (요금은 방 1개 1박, 0 = 모름)
        cost = 가장 싼 객실의 비수기 주중 요금 (목록·필터용), costCheck = 'TourAPI 객실' | '검색 추정' | '통계 추정'
      요금을 못 구한 숙소(모텔·펜션·한옥 등)는 '통계 추정' 객실을 만듦 (2026-10-10 이재훈 결정):
        TourAPI 실제 요금이 있는 숙소들의 '숙소 종류 × 객실 크기(2인·3~4인·5인 이상)'별 중앙값
        같은 시·도에 그 묶음이 8개 이상이면 시·도 값, 아니면 전국 값
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


def size_of(r):
    m = r['max'] or r['base'] or 2
    return '2인' if m <= 2 else '3~4인' if m <= 4 else '5인 이상'


SIZE_MAX = {'2인': 2, '3~4인': 4, '5인 이상': 6}


def kind_of(p):
    return (p.get('categoryName') or '').split('>')[-1].strip() or '숙소'


def median(vals):
    vals = sorted(v for v in vals if v)
    if not vals:
        return 0
    n = len(vals)
    return vals[n // 2] if n % 2 else (vals[n // 2 - 1] + vals[n // 2]) // 2


def build_stats(all_places, raw):
    """(종류, 크기) / (시도, 종류, 크기) → 4가지 요금 목록"""
    groups = {}
    for p in all_places:
        if p.get('type') != '숙소':
            continue
        for r in from_tourapi(raw.get(str(p['id']), [])):
            for key in ((kind_of(p), size_of(r)), (p.get('sido'), kind_of(p), size_of(r))):
                g = groups.setdefault(key, [[], [], [], []])
                for i, v in enumerate(r['off'] + r['peak']):
                    g[i].append(v)
    return groups


def stats_rooms(p, groups):
    rooms = []
    for size in ('2인', '3~4인', '5인 이상'):
        g = groups.get((p.get('sido'), kind_of(p), size))
        if not g or len([v for v in g[0] if v]) < 8:
            g = groups.get((kind_of(p), size))
        if not g or len([v for v in g[0] if v]) < 5:
            continue
        m = [median(x) for x in g]
        rooms.append({'name': size + '실', 'base': min(2, SIZE_MAX[size]), 'max': SIZE_MAX[size],
                      'off': [m[0], m[1]], 'peak': [m[2], m[3]], 'src': 'stats'})
    return rooms


def peak_ratios(all_places, raw):
    """종류별 '성수기 ÷ 비수기' 요금 비율 중앙값 [주중, 주말] — TourAPI 실제 요금에서 계산
    여기어때 검색 요금은 비수기(10월) 날짜만 있어 성수기 칸을 이 비율로 추정 (2026-10-10 이재훈 결정:
    지난 블로그·후기 조사에 성수기 가격 숫자는 없었고, 여기어때는 내년 여름 날짜가 아직 열리지 않음)"""
    groups = {}
    for p in all_places:
        if p.get('type') != '숙소':
            continue
        for r in from_tourapi(raw.get(str(p['id']), [])):
            for i in (0, 1):
                if r['off'][i] and r['peak'][i]:
                    for key in (kind_of(p), '전체'):
                        groups.setdefault(key, [[], []])[i].append(r['peak'][i] / r['off'][i])
    out = {}
    for key, (a, b) in groups.items():
        if len(a) >= 10:
            out[key] = [sorted(a)[len(a) // 2], sorted(b)[len(b) // 2] if len(b) >= 10 else sorted(a)[len(a) // 2]]
    return out


def main():
    raw = json.load(open(os.path.join(HERE, 'raw', 'rooms.json'), encoding='utf-8'))
    sp = os.path.join(HERE, 'rooms_search.json')
    search = json.load(open(sp, encoding='utf-8')) if os.path.exists(sp) else {}
    total = with_api = with_search = with_stats = 0
    missing = []
    all_places = []
    for fn in sorted(os.listdir(FOLDER)):
        all_places += json.load(open(os.path.join(FOLDER, fn), encoding='utf-8'))
    groups = build_stats(all_places, raw)
    ratios = peak_ratios(all_places, raw)
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
                ratio = ratios.get(kind_of(p)) or ratios.get('전체') or [1, 1]
                rooms = []
                for r in search[str(p['id'])].get('rooms', []):
                    r = dict(r, src='search')
                    if not any(r['peak']):   # 성수기 추정: 비수기 × 종류별 비율 (천 원 단위 반올림)
                        r['peak'] = [int(round(r['off'][i] * ratio[i], -3)) if r['off'][i] else 0 for i in (0, 1)]
                        r['peakEst'] = True
                    rooms.append(r)
                src = '검색 추정'
                if rooms:
                    with_search += 1
            if not rooms:
                rooms = stats_rooms(p, groups)
                src = '통계 추정'
                if rooms:
                    with_stats += 1
            if rooms:
                p['rooms'] = rooms
                fees = [r['off'][0] or r['off'][1] or r['peak'][0] or r['peak'][1] for r in rooms]
                p['cost'] = min(f for f in fees if f)
                p['costCheck'] = src
                changed = True
            elif 'rooms' in p:
                del p['rooms']; changed = True
            if src != 'TourAPI 객실' and src != '검색 추정':
                missing.append([p['id'], p['region'], p['name'], p.get('categoryName', ''), p.get('address', ''), p.get('recommend'), str(p['id']) in raw])
        if changed:
            json.dump(places, open(path, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    with open(os.path.join(HERE, 'rooms_missing.csv'), 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.writer(f)
        w.writerow(['id', 'region', 'name', 'category', 'address', 'recommend', 'tourapi_fetched'])
        w.writerows(missing)
    print(f'숙소 {total}곳: TourAPI 객실 요금 {with_api}곳, 검색 보충 {with_search}곳, 통계 추정 {with_stats}곳, '
          f'실제 요금 없음(목록) {len(missing)}곳 (tools/rooms_missing.csv)')


if __name__ == '__main__':
    main()
