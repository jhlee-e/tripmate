"""
고속·시외버스 터미널 사이 실제 소요시간·요금 받기 (2026-10-12, 이재훈 결정: 버스도 실제 시간표로, KTX와 비교해 A·B안은 빠른 쪽·C안은 싼 쪽)
입력: tools/tago_key.txt (공공데이터포털 일반 인증키 — TAGO 고속버스정보·시외버스정보 활용신청),
      data/stations.json (카카오에서 모은 버스터미널 좌표), data/regions.json (지역 중심 좌표)
출력: tools/raw/bus_match.json — 우리 터미널 ↔ TAGO 터미널 번호 맞춘 결과 (확인용)
      tools/raw/bus_times_raw.json — 받은 기록 (이어 받기용)
      data/bus_times.json — { "출발터미널|도착터미널": { "E": [보통 분, 최단 분, 요금(원), 편수], "S": [...] } }  E=고속, S=시외
API [확인: GitHub team-offway/core PR #448]: https://apis.data.go.kr/1613000/ExpBusInfo/GetExpBusTrminlList (cityCode)
                                            https://apis.data.go.kr/1613000/SuburbsBusInfo/GetSuberbsBusTrminlList
    시간표 조회 기능 이름·변수는 열차 API와 같은 규칙으로 추정 [추론] — 안 맞으면 응답 앞부분을 출력하고 멈춤
받는 쌍: 출발 = 큰 도시 20곳의 터미널(서울 4곳, 나머지 2곳) + 그 15km 밖의 맞춘 터미널 전부(2026-10-12 이재훈 결정)\n        → 도착 = 지역 237곳마다 중심 30km 안 가까운 터미널 2곳, 직선 40km 이상만. 같은 TAGO 번호끼리는 한 번만 조회
기준 날짜: 실행 다음 날 (버스 API는 가까운 날짜만 조회됨 — 9일 뒤는 0편, 2026-10-12 진단). 심야 등급 제외. 한 방향만 받아 반대 방향도 같다고 봄
이어 받기: 받은 쌍은 남겨 두고, 남은 쌍만 그날 기준 '내일' 시간표로 조회
실행: PowerShell에서  python tools/fetch_bus_times.py   (끝까지 한 번에, 받은 쌍은 건너뛰고 이어 받음)
      주말 시간표(금·토요일에):  python tools/fetch_bus_times.py --weekend
"""
import datetime, json, math, os, re, statistics, sys, time, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
BASE = 'https://apis.data.go.kr/1613000/'
# --weekend: 가장 가까운 토·일요일 시간표를 따로 받아 data/bus_times_weekend.json으로 (2026-10-12 이재훈 결정)
#   버스 API는 가까운 날짜만 조회되므로 금요일(→토요일)이나 토요일(→일요일)에 실행
WEEKEND = '--weekend' in sys.argv
ARGS = [a for a in sys.argv[1:] if not a.startswith('--')]
RAW = os.path.join(HERE, 'raw', 'bus_times_weekend_raw.json' if WEEKEND else 'bus_times_raw.json')
MATCH = os.path.join(HERE, 'raw', 'bus_match.json')
OUT = os.path.join(ROOT, 'data', 'bus_times_weekend.json' if WEEKEND else 'bus_times.json')
MAX_CALLS = int(ARGS[0]) if ARGS else 10 ** 9   # 기본: 끝까지 한 번에 (2026-10-12 이재훈 요청)
SVC = {'E': 'ExpBusInfo', 'S': 'SuburbsBusInfo'}
LIST_OP = {'E': 'GetExpBusTrminlList', 'S': 'GetSuberbsBusTrminlList'}
TIME_OPS = {'E': ['GetStrtpntAlocFndExpbusInfo', 'getStrtpntAlocFndExpbusInfo'],
            'S': ['GetStrtpntAlocFndSuberbsBusInfo', 'getStrtpntAlocFndSuberbsBusInfo']}
# 큰 도시 중심 (출발 쪽 터미널을 고를 곳) — Claude가 고른 20곳
HUB_CITIES = {'서울': (37.5665, 126.978, 4), '인천': (37.456, 126.705, 2), '수원': (37.263, 127.028, 2), '대전': (36.350, 127.385, 2),
              '청주': (36.642, 127.489, 2), '천안': (36.815, 127.114, 2), '대구': (35.871, 128.601, 2), '부산': (35.180, 129.075, 2),
              '울산': (35.538, 129.311, 2), '창원': (35.228, 128.681, 2), '광주': (35.160, 126.851, 2), '전주': (35.824, 127.148, 2),
              '강릉': (37.751, 128.876, 2), '원주': (37.342, 127.920, 2), '춘천': (37.881, 127.730, 2), '포항': (36.019, 129.343, 2),
              '진주': (35.180, 128.108, 2), '목포': (34.812, 126.392, 2), '순천': (34.950, 127.487, 2), '안동': (36.568, 128.729, 2)}
HUB_KM = {'서울': 20}
WORDS = sorted(['종합버스터미널', '여객자동차터미널', '공용버스터미널', '시외버스공용터미널', '시외버스터미널', '고속버스터미널', '버스터미널',
                '종합터미널', '복합터미널', '공영버스정류장', '시외버스정류장', '버스정류장', '정류장', '정류소', '터미널',
                '고속', '시외', '종합', '공용', '공영', '복합', '여객', '버스', '서관', '동관'], key=len, reverse=True)
calls = 0


def api(key, svc, op, **params):
    """출력: (items, 오류 글자 또는 None)"""
    global calls
    calls += 1
    q = urllib.parse.urlencode(dict(params, serviceKey=key, _type='json', numOfRows=params.get('numOfRows', 300), pageNo=1))
    try:
        with urllib.request.urlopen(BASE + svc + '/' + op + '?' + q, timeout=20) as r:
            text = r.read().decode('utf-8')
    except Exception as e:
        return None, str(e)
    try:
        data = json.loads(text)
    except ValueError:
        return None, text[:400]
    head = data.get('response', {}).get('header', {})
    if str(head.get('resultCode', '00')) not in ('00', '0000'):
        return None, json.dumps(head, ensure_ascii=False)
    items = data['response']['body'].get('items') or {}
    items = items.get('item', []) if isinstance(items, dict) else []
    items = [items] if isinstance(items, dict) else items
    return [{k.lower(): v for k, v in it.items()} for it in items], None


def must(res, what):
    items, err = res
    if items is None:
        raise SystemExit(what + ' 실패 — 이 문장을 Claude에게 보내 주세요:\n' + err)
    return items


def km(a, b):
    r = math.pi / 180
    return 6371 * math.hypot((b[1] - a[1]) * r * math.cos((a[0] + b[0]) / 2 * r), (b[0] - a[0]) * r)


def core(name, city=''):
    n = re.sub(r'\(.*?예정\)', '', name)
    n = re.sub(r'[^0-9A-Za-z가-힣]', '', n)
    for w in WORDS:
        n = n.replace(w, '')
    c = re.sub(r'(특별시|광역시|특별자치시|특별자치도|시|군|도)$', '', city or '')
    if c and n.startswith(c):
        n = n[len(c):]
    return n


def minutes(a, b):
    ta = datetime.datetime.strptime(str(a)[:12], '%Y%m%d%H%M')
    tb = datetime.datetime.strptime(str(b)[:12], '%Y%m%d%H%M')
    return int((tb - ta).total_seconds() // 60)


def tago_terminals(key):
    """출력: { 'E': [(id, 이름, 도시)], 'S': [...] } — 목록 API는 도시 조건(cityCode)을 무시하므로 한 번에 전부 받음 (2026-10-12 진단)"""
    out = {}
    for t in ('E', 'S'):
        lst = must(api(key, SVC[t], LIST_OP[t], numOfRows=5000), SVC[t] + ' 터미널 목록')
        seen = {}
        for x in lst:
            seen[x['terminalid']] = (x['terminalid'], x['terminalnm'], x.get('cityname', ''))
        out[t] = list(seen.values())
        print(f'TAGO {"고속" if t == "E" else "시외"}버스 터미널 {len(out[t])}곳')
    return out


def match(ours, tago):
    """우리 터미널마다 TAGO 번호 찾기 — 같은 도시(주소에 도시 이름 앞 2글자)에서 핵심 이름이 같거나 한쪽이 다른 쪽으로 시작"""
    res = {}
    for s in ours:
        addr = s.get('address', '')
        got = {}
        for t, lst in tago.items():
            best, score = None, 0
            for tid, tname, city in lst:
                c2 = re.sub(r'(특별시|광역시|특별자치시|특별자치도|시|군|도)$', '', city or '')[:2]
                if c2 and c2 not in addr and c2 not in s['name']:
                    continue
                a, b = core(s['name'], city), core(tname, city)
                if a == b:
                    sc = 3
                elif min(len(a), len(b)) >= 2 and (a.startswith(b) or b.startswith(a)):
                    sc = 2
                elif len(os.path.commonprefix([a, b])) >= 4:   # '센트럴시티호남' ↔ '센트럴시티서울'
                    sc = 1
                else:
                    continue
                if sc > score:
                    best, score = (tid, tname), sc
            if best:
                got[t] = best
        if got:
            res[s['name']] = got
    return res


def main():
    key = open(os.path.join(HERE, 'tago_key.txt'), encoding='utf-8-sig').read().strip()
    raw = json.load(open(RAW, encoding='utf-8')) if os.path.exists(RAW) else {}
    raw.setdefault('pairs', {})
    bad = ('예정', '방면', '휴게소', '환승', '리무진', '에버랜드')   # 여행 출발·도착지로 맞지 않는 곳 (Claude 판단)
    stations = [s for s in json.load(open(os.path.join(ROOT, 'data', 'stations.json'), encoding='utf-8'))
                if s['kind'] in ('고속버스', '시외버스') and not any(b in s['name'] for b in bad)]

    # 1) 터미널 맞추기 (처음 한 번)
    if not os.path.exists(MATCH):
        m = match(stations, tago_terminals(key))
        json.dump(m, open(MATCH, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    m = json.load(open(MATCH, encoding='utf-8'))
    print(f'우리 터미널 {len(stations)}곳 중 TAGO와 맞춘 곳 {len(m)}곳 (확인: tools/raw/bus_match.json)')
    by = {s['name']: s for s in stations if s['name'] in m}

    # 2) 받을 쌍: 큰 도시 터미널 → 지역마다 가까운 터미널
    def near(pt, maxkm, n):
        lst = sorted((km(pt, (s['lat'], s['lng'])), s['name']) for s in by.values())
        return [nm for d, nm in lst if d <= maxkm][:n]
    hubs = []
    for city, (lat, lng, n) in HUB_CITIES.items():
        hubs += [h for h in near((lat, lng), HUB_KM.get(city, 12), n) if h not in hubs]
    # 2026-10-12 이재훈 결정: 출발 쪽을 맞춘 터미널 전부로 넓히되, 큰 도시 터미널 15km 안은 뺌 (그 동네는 큰 도시 시간표를 씀)
    extra = [x for x in by if x not in hubs and min(km((by[x]['lat'], by[x]['lng']), (by[h]['lat'], by[h]['lng'])) for h in hubs) >= 15]
    origins = hubs + extra
    dests = []
    for r in json.load(open(os.path.join(ROOT, 'data', 'regions.json'), encoding='utf-8')):
        dests += [d for d in near((r['lat'], r['lng']), 30, 2) if d not in dests]

    # 같은 TAGO 터미널 번호끼리는 한 번만 조회 ('강릉고속'·'강릉시외'가 같은 번호인 경우 등) — 키: 종류|작은 번호|큰 번호
    tp = raw.setdefault('tpairs', {})
    for k, v in raw['pairs'].items():   # 예전(이름 기준) 기록 옮기기
        a, b, t = k.split('|')
        if a in m and b in m and t in m[a] and t in m[b]:
            x, y = sorted((m[a][t][0], m[b][t][0]))
            tp.setdefault(t + '|' + x + '|' + y, v)
    todo, seen = [], set()
    for a in origins:
        for b in dests:
            if a == b or km((by[a]['lat'], by[a]['lng']), (by[b]['lat'], by[b]['lng'])) < 40:
                continue
            for t in ('E', 'S'):
                if t in m[a] and t in m[b] and m[a][t][0] != m[b][t][0]:
                    x, y = sorted((m[a][t][0], m[b][t][0]))
                    k = t + '|' + x + '|' + y
                    if k not in tp and k not in seen:
                        seen.add(k)
                        todo.append((m[a][t][0], m[b][t][0], t, k))
    date = (datetime.date.today() + datetime.timedelta(days=1)).strftime('%Y%m%d')
    if WEEKEND:
        # 내일부터 가장 가까운 토·일요일 → 서울경부→부산(늘 있는 노선)으로 그 날짜가 조회되는지 먼저 확인
        d = datetime.date.today() + datetime.timedelta(days=1)
        while d.weekday() < 5:
            d += datetime.timedelta(days=1)
        date = d.strftime('%Y%m%d')
        test, err = api(key, SVC['E'], TIME_OPS['E'][0], depTerminalId='NAEK010', arrTerminalId='NAEK700', depPlandTime=date, numOfRows=5)
        if not test:
            raise SystemExit(f'{date}({"토" if d.weekday() == 5 else "일"}) 시간표가 아직 조회되지 않아요. 금요일이나 토요일에 다시 실행해 주세요.' +
                             (('\n' + err) if err else ''))
    raw['busDate'] = date
    print(f'출발 쪽 터미널 {len(origins)}곳(큰 도시 {len(hubs)}곳), 도착 쪽 {len(dests)}곳 → 남은 조회 {len(todo)}회 (기준 날짜 {date})')

    # 3) 시간표 조회 — 끝까지 한 번에, 응답이 늦으면 한 번 더, 오류가 30번 연속이면(하루 한도로 보고) 저장하고 멈춤
    ops = raw.setdefault('ops', {})
    got, fails = 0, 0
    try:
        for dep, arr, t, k in todo:
            if calls >= MAX_CALLS:
                break
            params = dict(depTerminalId=dep, arrTerminalId=arr, depPlandTime=date, numOfRows=200)
            op = ops.get(t, TIME_OPS[t][0])
            items, err = api(key, SVC[t], op, **params)
            if items is None:
                items, err = api(key, SVC[t], op, **params)
            if items is None:
                fails += 1
                print('  건너뜀:', k, err[:120])
                if fails >= 30:
                    print('오류가 30번 연속 났어요 (하루 조회 한도일 수 있음). 지금까지 저장했으니 나중에 다시 실행하면 이어서 받아요.')
                    break
                continue
            fails = 0
            durs, fares = [], []
            for it in items:
                if '심야' in str(it.get('gradenm', '')):   # 심야버스는 낮보다 빨라 보통 소요시간에서 뺌 (Claude 판단)
                    continue
                try:
                    durs.append(minutes(it['depplandtime'], it['arrplandtime']))
                except (KeyError, ValueError):
                    continue
                f = str(it.get('charge', '')).split('.')[0]
                if f.isdigit() and int(f) > 0:
                    fares.append(int(f))
            durs = [d for d in durs if d > 0]
            tp[k] = [int(statistics.median(durs)), min(durs), int(statistics.median(fares)) if fares else 0, len(durs)] if durs else [0, 0, 0, 0]
            got += 1
            if got % 200 == 0:
                print(f'  {got} / {len(todo)}회 …')
                json.dump(raw, open(RAW, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
            time.sleep(0.03)
    finally:
        json.dump(raw, open(RAW, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

    # 4) 우리 터미널 이름 쌍으로 펼치기 (같은 TAGO 번호를 쓰는 이름은 모두 같은 값)
    table = {}
    names = list(by)
    for i, a in enumerate(names):
        for b in names[i + 1:]:
            for t in ('E', 'S'):
                if t in m[a] and t in m[b] and m[a][t][0] != m[b][t][0]:
                    x, y = sorted((m[a][t][0], m[b][t][0]))
                    v = tp.get(t + '|' + x + '|' + y)
                    if v and v[3] > 0:
                        table.setdefault(a + '|' + b, {})[t] = v
    json.dump(table, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    left = len(todo) - got
    print(f'완료: 이번 조회 {got}회, 버스가 있는 터미널 쌍 {len(table)}개 → {os.path.relpath(OUT, ROOT)}')
    if left > 0:
        print(f'아직 {left}회 남음 — 다시 실행하면 이어서 받아요.')


if __name__ == '__main__':
    main()
