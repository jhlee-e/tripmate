"""
버스 시간표 API 진단 (2026-10-12) — 서울경부(NAEK010) → 부산(NAEK700) 고속버스를 여러 방식으로 조회해 응답 원문을 출력
입력: tools/tago_key.txt / 출력: 화면에만 (파일 안 만듦)
실행: python tools/probe_bus_api.py   → 출력 전체를 Claude에게 보내 주세요
"""
import datetime, json, os, urllib.parse, urllib.request
HERE = os.path.dirname(os.path.abspath(__file__))
key = open(os.path.join(HERE, 'tago_key.txt'), encoding='utf-8-sig').read().strip()
today = datetime.date.today()
dates = [today.strftime('%Y%m%d'), (today + datetime.timedelta(days=1)).strftime('%Y%m%d'), '20261021']
tries = []
for d in dates:
    tries.append(('ExpBusInfo/GetStrtpntAlocFndExpbusInfo', dict(depTerminalId='NAEK010', arrTerminalId='NAEK700', depPlandTime=d)))
tries += [
    ('ExpBusInfo/GetStrtpntAlocFndExpbusInfo', dict(depTerminalId='NAEK010', arrTerminalId='NAEK700', depPlandTime=dates[1], busGradeId='1')),
    ('ExpBusInfo/getStrtpntAlocFndExpbusInfo', dict(depTerminalId='NAEK010', arrTerminalId='NAEK700', depPlandTime=dates[1])),
    ('ExpBusInfo/GetExpBusTrminlList', dict(cityCode='11')),
    ('ExpBusInfo/GetCtyCodeList', dict()),
    ('SuburbsBusInfo/GetStrtpntAlocFndSuberbsBusInfo', dict(depTerminalId='NAI0511601', arrTerminalId='NAI2551901', depPlandTime=dates[1])),
]
for op, p in tries:
    q = urllib.parse.urlencode(dict(p, serviceKey=key, _type='json', numOfRows=5, pageNo=1))
    try:
        with urllib.request.urlopen('https://apis.data.go.kr/1613000/' + op + '?' + q, timeout=30) as r:
            text = r.read().decode('utf-8')
    except Exception as e:
        text = '요청 오류: ' + str(e)
    print('=====', op, {k: v for k, v in p.items()})
    print(text[:700])
