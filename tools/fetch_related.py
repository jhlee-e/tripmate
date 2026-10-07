# -*- coding: utf-8 -*-
"""
인기도 원자료 받기 — 한국관광공사_관광지별 연관 관광지 정보 (TarRlteTarService1)
  티맵(T map) 이동 데이터로 시·군·구마다 '중심 관광지'와 '함께 많이 가는 연관 관광지 순위'를 알려 주는 API

입력: tools/related_key.txt 인증키 (이 API용으로 발급된 키, 없으면 tools/tourapi_key.txt)
      장소 원본(tools/raw/type_*.json)에 있는 법정동 시·도/시·군·구 코드 쌍
출력: tools/raw/related.json — 시·군·구별 응답 원본 (build_places.py가 인기도 점수 계산에 사용)

실행: tripmate 폴더에서  python tools/fetch_related.py
 - 이미 받은 시·군·구는 건너뜀. 하루 한도에 걸리면 다음 날 다시 실행하면 이어서 받음
 - 기준 월(baseYm)은 지난달부터 시도하고, 자료가 없으면 그 전달로
"""
import datetime, json, os, time, urllib.error, urllib.parse, urllib.request

URL = 'https://apis.data.go.kr/B551011/TarRlteTarService1/areaBasedList1'
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'raw', 'related.json')


def read_key():
    # 이 API 전용 키(tools/related_key.txt)가 있으면 그것을, 없으면 TourAPI 키를 사용
    path = os.path.join(HERE, 'related_key.txt')
    if not os.path.exists(path):
        path = os.path.join(HERE, 'tourapi_key.txt')
    return urllib.parse.unquote(open(path, encoding='utf-8').read().strip())


def months_back(n):
    d = datetime.date.today().replace(day=1)
    for _ in range(n):
        d = (d - datetime.timedelta(days=1)).replace(day=1)
    return d.strftime('%Y%m')


def fetch(key, area, sgg, ym, page):
    area = area[:2]                          # 세종은 시·도 코드가 '36110'처럼 5자리로 들어 있어 앞 2자리만 사용
    params = {'serviceKey': key, 'MobileOS': 'ETC', 'MobileApp': 'TripMate', '_type': 'json',
              'numOfRows': 1000, 'pageNo': page, 'baseYm': ym, 'areaCd': area,
              'signguCd': sgg if sgg.startswith(area) and len(sgg) == 5 else area + sgg}   # 세종처럼 코드가 이미 5자리인 경우
    try:
        with urllib.request.urlopen(URL + '?' + urllib.parse.urlencode(params), timeout=30) as res:
            text = res.read().decode('utf-8')
    except urllib.error.HTTPError as e:      # 403 등은 응답 본문에 이유가 적혀 있어 함께 보여 줌
        raise RuntimeError(f'HTTP {e.code} — 응답 내용: ' + e.read().decode('utf-8', 'replace')[:300])
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        raise RuntimeError('JSON이 아닌 응답(한도 초과·미승인 키일 수 있음): ' + text[:300])
    header = data['response']['header']
    if header.get('resultCode') != '0000':
        raise RuntimeError(f"API 오류 {header.get('resultCode')}: {header.get('resultMsg')}")
    body = data['response']['body']
    items = body.get('items') or {}
    items = items.get('item', []) if isinstance(items, dict) else []
    return ([items] if isinstance(items, dict) else items), int(body.get('totalCount', 0))


def main():
    key = read_key()
    pairs = set()
    for t in (12, 14, 28, 38, 39, 32):
        for x in json.load(open(os.path.join(HERE, 'raw', f'type_{t}.json'), encoding='utf-8')):
            if x.get('lDongRegnCd') and x.get('lDongSignguCd'):
                pairs.add((x['lDongRegnCd'], x['lDongSignguCd']))
    done = json.load(open(OUT, encoding='utf-8')) if os.path.exists(OUT) else {}
    todo = sorted(p for p in pairs if not (done.get(f'{p[0]}-{p[1]}') or {}).get('items'))   # 자료가 비었던 곳은 다시 시도
    print(f'시·군·구 {len(pairs)}곳 중 받은 것 {len(done)}, 남은 것 {len(todo)}')
    calls = 0
    try:
        for area, sgg in todo:
            got = None
            for ym in (months_back(1), months_back(2), months_back(3)):
                items, page = [], 1
                while True:
                    calls += 1
                    chunk, total = fetch(key, area, sgg, ym, page)
                    items += chunk
                    if len(items) >= total or not chunk:
                        break
                    page += 1
                if items:
                    got = {'baseYm': ym, 'items': items}
                    break
            if calls <= 3:
                print('  첫 응답 확인:', area, sgg, (got['items'][0] if got else '자료 없음'))
            done[f'{area}-{sgg}'] = got or {'baseYm': None, 'items': []}
            if len(done) % 20 == 0:
                json.dump(done, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False)
                print(f'  {len(done)}/{len(pairs)} (호출 {calls}회)')
            time.sleep(0.1)
    except Exception as e:
        print('중단:', e)
    json.dump(done, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False)
    print(f'저장 완료: {len(done)}/{len(pairs)} 시·군·구 → tools/raw/related.json (이번 호출 {calls}회)')


if __name__ == '__main__':
    main()
