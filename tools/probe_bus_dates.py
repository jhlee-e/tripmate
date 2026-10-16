# -*- coding: utf-8 -*-
"""
버스 시간표가 며칠 뒤까지 조회되는지, 오늘 날짜로 조회하면 이미 떠난 버스도 나오는지 확인 (2026-10-16)
입력: tools/tago_key.txt / 출력: 화면에만 — 날짜마다 서울경부→부산 고속버스 편수, 첫차·막차 출발 시각
실행: python tools/probe_bus_dates.py   (조회 10회)
"""
import os, json, datetime, urllib.request, urllib.parse
HERE = os.path.dirname(os.path.abspath(__file__))
key = open(os.path.join(HERE, 'tago_key.txt'), encoding='utf-8-sig').read().strip()
URL = 'https://apis.data.go.kr/1613000/ExpBusInfo/GetStrtpntAlocFndExpbusInfo'
now = datetime.datetime.now()
print(f'지금 {now:%m-%d %H:%M}')
for d in range(0, 10):
    day = datetime.date.today() + datetime.timedelta(days=d)
    q = urllib.parse.urlencode(dict(serviceKey=key, _type='json', numOfRows=200, pageNo=1,
                                    depTerminalId='NAEK010', arrTerminalId='NAEK700', depPlandTime=day.strftime('%Y%m%d')))
    try:
        with urllib.request.urlopen(URL + '?' + q, timeout=20) as r:
            body = json.loads(r.read().decode('utf-8'))['response']['body']
        items = body.get('items') or {}
        items = items.get('item', []) if isinstance(items, dict) else []
        items = [items] if isinstance(items, dict) else items
        t = sorted(str(x['depPlandTime'])[8:12] for x in items)
        print(f'{d}일 뒤 {day} ({"월화수목금토일"[day.weekday()]}): {len(t)}편' + (f', 첫차 {t[0][:2]}:{t[0][2:]} 막차 {t[-1][:2]}:{t[-1][2:]}' if t else ''))
    except Exception as e:
        print(f'{d}일 뒤 {day}: 오류 {e}')
