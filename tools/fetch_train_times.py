"""
KTX 역 사이 실제 소요시간·요금 받기 (2026-10-12, 이재훈 결정: 주요 역 쌍의 실제 소요시간 표를 만들어 쓰기)
입력: tools/tourapi_key.txt (공공데이터포털 인증키 — '국토교통부_(TAGO)_열차정보' 활용신청 필요),
      data/stations.json (tools/fetch_stations.py가 만든 KTX역 목록)
출력: tools/raw/train_times_raw.json (받은 기록, 이어 받기용)
      data/train_times.json — { "서울역|강릉역": [보통 소요시간(분, 중앙값), 가장 빠른 시간(분), 어른 요금(원, 중앙값), 그날 KTX 편수] }
      (한 방향만 받아 반대 방향에도 같은 값을 씀 — Claude 판단)
API: https://apis.data.go.kr/1613000/TrainInfo  (GetCtyCodeList → GetCtyAcctoTrainSttnList → GetStrtpntAlocFndTrainInfo)
     요청·응답 이름은 예전 TrainInfoService 기준(depPlaceId·arrPlaceId·depPlandTime / depplandtime·arrplandtime·adultcharge·traingradename) [추론]
     — SRT는 이 API에 없음, 약 30일 안의 날짜만 조회됨 (GitHub 사용 기록)
기준 날짜: 실행일로부터 7일 뒤 이후의 첫 수요일 (평일 대표 시간표, Claude 판단)
순서: 서울권 역(서울·용산·청량리·광명·행신·상봉·수원) ↔ 모든 역 → 큰 역끼리 → 나머지. 한 번에 최대 950회, 며칠에 나눠 실행
실행: PowerShell에서  python tools/fetch_train_times.py      (호출 수를 바꾸려면 python tools/fetch_train_times.py 500)
"""
import datetime, json, os, re, statistics, sys, time, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
BASE = 'https://apis.data.go.kr/1613000/TrainInfo/'
RAW = os.path.join(HERE, 'raw', 'train_times_raw.json')
OUT = os.path.join(ROOT, 'data', 'train_times.json')
MAX_CALLS = int(sys.argv[1]) if len(sys.argv) > 1 else 950
SEOUL = ['서울역', '용산역', '청량리역', '광명역', '행신역', '상봉역', '수원역']
HUBS = ['대전역', '동대구역', '부산역', '광주송정역', '오송역', '천안아산역', '익산역', '울산역', '강릉역', '전주역', '서대전역',
        '경주역', '포항역', '마산역', '창원중앙역', '진주역', '순천역', '여수엑스포역', '목포역', '안동역', '원주역', '서원주역', '김천구미역']
calls = 0


def api(key, op, **params):
    global calls
    calls += 1
    q = urllib.parse.urlencode(dict(params, serviceKey=key, _type='json', numOfRows=params.get('numOfRows', 200), pageNo=1))
    with urllib.request.urlopen(BASE + op + '?' + q, timeout=20) as r:
        text = r.read().decode('utf-8')
    try:
        data = json.loads(text)
    except ValueError:
        raise SystemExit('API 응답이 JSON이 아니에요 (활용신청 승인 전이거나 키 문제일 수 있음):\n' + text[:500])
    head = data.get('response', {}).get('header', {})
    if str(head.get('resultCode', '00')) not in ('00', '0000'):
        raise SystemExit('API 오류: ' + json.dumps(head, ensure_ascii=False))
    items = data['response']['body'].get('items') or {}
    items = items.get('item', []) if isinstance(items, dict) else []
    return [items] if isinstance(items, dict) else items


def norm(n):
    return re.sub(r'[\s()역]', '', n)


def minutes(a, b):
    ta = datetime.datetime.strptime(str(a)[:12], '%Y%m%d%H%M')
    tb = datetime.datetime.strptime(str(b)[:12], '%Y%m%d%H%M')
    return int((tb - ta).total_seconds() // 60)


def main():
    key = open(os.path.join(HERE, 'tourapi_key.txt'), encoding='utf-8-sig').read().strip()
    raw = json.load(open(RAW, encoding='utf-8')) if os.path.exists(RAW) else {}
    raw.setdefault('pairs', {})

    # 1) TAGO 역 번호 (처음 한 번만)
    ours = [s['name'] for s in json.load(open(os.path.join(ROOT, 'data', 'stations.json'), encoding='utf-8')) if s['kind'] == 'KTX']
    if not raw.get('ids'):
        tago = {}
        for c in api(key, 'GetCtyCodeList'):
            for st in api(key, 'GetCtyAcctoTrainSttnList', cityCode=c['citycode'], numOfRows=300):
                tago[norm(st['nodename'])] = st['nodeid']
        ids, missing = {}, []
        for n in ours:
            k = norm(n)
            hit = tago.get(k) or next((v for t, v in tago.items() if t.startswith(k) or k.startswith(t)), None)
            if hit:
                ids[n] = hit
            else:
                missing.append(n)
        raw['ids'] = ids
        if missing:
            print('TAGO에서 역 번호를 못 찾은 역:', ', '.join(missing))
        json.dump(raw, open(RAW, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    ids = raw['ids']

    # 2) 기준 날짜
    day = datetime.date.today() + datetime.timedelta(days=7)
    while day.weekday() != 2:
        day += datetime.timedelta(days=1)
    date = raw.get('date') or day.strftime('%Y%m%d')
    raw['date'] = date

    # 3) 받을 역 쌍 (우선순위 순)
    names = [n for n in ours if n in ids]
    order = [n for n in SEOUL if n in ids] + [n for n in HUBS if n in ids]
    order += [n for n in names if n not in order]
    todo = []
    for i, a in enumerate(order):
        for b in order[i + 1:]:
            k = a + '|' + b
            if k not in raw['pairs']:
                todo.append((a, b))
    print(f'남은 역 쌍 {len(todo)}개, 이번에 최대 {MAX_CALLS}회 (기준 날짜 {date})')

    got = 0
    try:
        for a, b in todo:
            if calls >= MAX_CALLS:
                break
            trains = api(key, 'GetStrtpntAlocFndTrainInfo', depPlaceId=ids[a], arrPlaceId=ids[b], depPlandTime=date, numOfRows=200)
            ktx = [t for t in trains if 'KTX' in str(t.get('traingradename', ''))]
            durs = [minutes(t['depplandtime'], t['arrplandtime']) for t in ktx]
            fares = [int(t['adultcharge']) for t in ktx if str(t.get('adultcharge', '')).isdigit() and int(t['adultcharge']) > 0]
            got += 1
            raw['pairs'][a + '|' + b] = [int(statistics.median(durs)), min(durs),
                                         int(statistics.median(fares)) if fares else 0, len(durs)] if durs else [0, 0, 0, 0]
            if calls % 50 == 0:
                print(f'  {calls}회 …')
                json.dump(raw, open(RAW, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
            time.sleep(0.05)
    finally:
        json.dump(raw, open(RAW, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

    table = {k: v for k, v in raw['pairs'].items() if v[3] > 0}   # 바로 가는 KTX가 있는 쌍만
    json.dump(table, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    left = len(todo) - got
    print(f'완료: 이번 호출 {calls}회, 받은 역 쌍 {len(raw["pairs"])}개 (바로 가는 KTX 있음 {len(table)}개) → data/train_times.json')
    if left > 0:
        print(f'아직 {left}개 남음 — 내일 다시 실행해 주세요.')


if __name__ == '__main__':
    main()
