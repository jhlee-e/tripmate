# -*- coding: utf-8 -*-
# 6번 실내/실외 구분: 장소 분류 이름(categoryName)으로 판단해 data/places/*.json 에 indoor 값을 붙임
# 입력: data/places/*.json / 출력: 각 장소에 indoor = True(실내) | False(실외) | None(섞여 있음·모름)
#   식당·카페·숙소는 실내. 판단 기준 낱말은 아래 표 (Claude 판단 — 분류 이름만 보고 정함)
import json, os, re, glob
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
INDOOR = re.compile(r'박물관|전시관|미술관|화랑|기념관|과학관|공연장|공연시설|수족관|아쿠아|백화점|쇼핑몰|아웃렛|면세점|전문상가|기념품|특산물|공방|서점|도서관|'
                    r'온천|사우나|스파|찜질|영화관|천문대|전통문화체험|공예체험|문화시설|산업관광|화장품|주류|먹거리|실내|스케이트|볼링|문화원|컨벤션')
OUTDOOR = re.compile(r'해변|해수욕장|해안|산,|고개|오름|봉우리|계곡|폭포|숲|약수터|섬|항구|포구|호수|저수지|강$|하천|공원|둘레길|골목길|문화거리|마을|생태|습지|'
                     r'캠핑|야영|글램핑|카라반|수상레저|래프팅|카약|요트|윈드서핑|낚시|패러글라이딩|헹글라이딩|골프|승마|스키|썰매|카트|'
                     r'유적지|사적지|성ㆍ산성|성곽|고분|능|탑|비석|불상|민속마을|고궁|문$|다리|대교|등대|전망대|동상|기암괴석|동굴|희귀동|테마파크|동물원|관광단지|사당|종교성지|불교|수목원|정원|자연휴양림|농장|목장|어장|비상설시장')
def classify(p):
    if p['type'] in ('식당', '숙소'):
        return True
    c = p.get('categoryName') or ''
    if INDOOR.search(c): return True
    if OUTDOOR.search(c): return False
    return None
if __name__ == '__main__':
    stat = {True: 0, False: 0, None: 0}
    for f in glob.glob(os.path.join(ROOT, 'data', 'places', '*.json')):
        raw = open(f, encoding='utf-8').read()
        places = json.loads(raw)
        for p in places:
            p['indoor'] = classify(p)
            if p['type'] == '명소': stat[p['indoor']] += 1
        json.dump(places, open(f, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    print('명소 실내', stat[True], '실외', stat[False], '모름', stat[None])
