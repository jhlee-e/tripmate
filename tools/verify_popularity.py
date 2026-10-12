# -*- coding: utf-8 -*-
"""
인기도 이름 자동 맞춤이 정말 같은(또는 바로 옆) 장소인지 카카오 장소 검색으로 좌표 확인
입력: data/places/지역.json 중 popularityMatch(자동으로 맞춘 티맵 이름)가 있는 장소, tools/kakao_key.txt (카카오 REST API 키)
출력: tools/raw/popularity_check.json — { 장소id: { match, kakao, dist, ok } }
        kakao = 카카오에서 찾은 장소 이름 ('' = 못 찾음), dist = 우리 장소와의 거리(m)
        ok = 같은 곳으로 인정하는지 (기준은 아래 SAME_M·NEAR_M)
      → 그다음 python tools/update_popularity.py 를 실행하면 ok가 아닌 자동 맞춤은 0점으로 되돌림
기준 (2026-10-12, Claude 제안 — 이재훈 검토 필요):
  - 이름이 같은 곳·표기만 다른 곳: 카카오 위치가 우리 장소에서 300m 안이면 같은 곳
  - 우리 장소가 큰 명소 안의 시설('간절곶 소망길' → '간절곶'): 1km 안이면 인정 (인기도는 원래대로 절반)
  - 카카오에서 그 이름을 반경 5km 안에서 못 찾으면 인정 안 함
  - (2차, 2026-10-12) 골프장·스키장·리조트·공원·길 등 넓은 곳은 2km까지 인정 / 카카오 이름 비교를 엄격하게:
    완전히 같거나, 티맵 이름이 4글자 이상이고 앞부분이 같을 때만 ('강화도'가 '강화도령화문석'에 붙던 오류 방지)
  - (3차, 2026-10-12) 2차는 너무 엄격해 같은 곳도 504곳을 못 찾음('무주구천동계곡'↔카카오 '구천동계곡',
    '화진포'↔'화진포해수욕장') → 카카오 이름 비교에도 popularity.py의 자동 맞추기 규칙(match_len)을 씀
    (짧은 쪽 3글자 이상). 거리 기준은 2차와 같음
실행: tripmate 폴더에서 (PowerShell)  python tools/verify_popularity.py
 - 이미 확인한 장소는 건너뛰므로 중간에 멈추면 다시 실행하면 이어서 함 (카카오 하루 한도 10만 회 — 이번엔 약 1,640회)
"""
import glob, json, math, os, re, sys, time, urllib.parse, urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from popularity import norm, is_sub_part, name_candidates, canon, match_len

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(HERE, 'raw', 'popularity_check.json')
URL = 'https://dapi.kakao.com/v2/local/search/keyword.json'
SAME_M, NEAR_M, LARGE_M, SEARCH_M = 300, 1000, 2000, 5000
VERSION = 3   # 기준을 바꾸면 올림 → 다시 실행할 때 전부 새로 확인
# 골프장·스키장·리조트·큰 공원·길·해안도로처럼 넓은 곳은 카카오 위치(입구·주차장 등)가 멀리 찍힐 수 있어 2km까지 인정
LARGE_WORDS = ('cc', '컨트리클럽', '골프', '스키', '리조트', '파크', '랜드', '공원', '수목원', '휴양림', '길', '코스',
               '해안도로', '도로', '호수', '저수지', '산', '섬', '도', '해변', '해수욕장', '계곡', '국립공원', '대교', '방조제')


def dist_m(lat1, lng1, lat2, lng2):
    r = 6371000
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lng2 - lng1) / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def search(key, query, lat, lng):
    q = urllib.parse.urlencode({'query': query, 'x': lng, 'y': lat, 'radius': SEARCH_M, 'sort': 'distance', 'size': 15})
    req = urllib.request.Request(URL + '?' + q, headers={'Authorization': 'KakaoAK ' + key})
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read().decode('utf-8')).get('documents', [])


def main():
    key = open(os.path.join(HERE, 'kakao_key.txt'), encoding='utf-8-sig').read().strip()   # PowerShell이 붙이는 BOM 제거
    done = json.load(open(OUT, encoding='utf-8')) if os.path.exists(OUT) else {}
    todo = []
    for f in sorted(glob.glob(os.path.join(ROOT, 'data', 'places', '*.json'))):
        for p in json.load(open(f, encoding='utf-8')):
            c = done.get(str(p['id']), {})
            # 장소 파일의 자동 맞춤 이름, 없으면(지난번 확인에서 취소돼 지워진 곳) 확인 기록의 이름으로 다시 확인
            m = p.get('popularityMatch') or c.get('match')
            if m and (c.get('match') != m or c.get('v') != VERSION):
                p['popularityMatch'] = m
                todo.append(p)
    print(f'확인할 장소 {len(todo)}곳 (이미 확인 {len(done)}곳)')
    for i, p in enumerate(todo, 1):
        m = p['popularityMatch']
        try:
            docs = search(key, m, p['lat'], p['lng'])
        except Exception as e:
            print('카카오 검색 오류 — 여기서 멈춤 (다시 실행하면 이어서 함):', e)
            break
        # 카카오 결과 중 이름이 티맵 이름과 같은(띄어쓰기·기호 무시) 곳, 없으면 티맵 이름을 포함하는 곳 — 가장 가까운 것
        best = None
        for d in docs:
            k = norm(d['place_name'])
            if k == m or canon(k) == canon(m) or (min(len(k), len(m)) >= 3 and match_len(k, m) >= 3):
                best = d
                break
        if best:
            dist = round(dist_m(p['lat'], p['lng'], float(best['y']), float(best['x'])))
            sub = any(is_sub_part(c, m) for c in name_candidates(re.sub(r'\(.*?\)', '', p['name'])))
            large = m.endswith(LARGE_WORDS)
            ok = dist <= (LARGE_M if large else NEAR_M if sub else SAME_M)
            done[str(p['id'])] = {'name': p['name'], 'match': m, 'kakao': best['place_name'], 'dist': dist, 'ok': ok, 'v': VERSION}
        else:
            done[str(p['id'])] = {'name': p['name'], 'match': m, 'kakao': '', 'dist': None, 'ok': False, 'v': VERSION}
        if i % 50 == 0:
            json.dump(done, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
            print(f'  {i}/{len(todo)}')
        time.sleep(0.05)
    json.dump(done, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    ok = sum(1 for v in done.values() if v['ok'])
    print(f'확인 끝: {len(done)}곳 중 인정 {ok}곳, 인정 안 함 {len(done) - ok}곳 → tools/raw/popularity_check.json')
    print('다음: python tools/update_popularity.py')


if __name__ == '__main__':
    main()
