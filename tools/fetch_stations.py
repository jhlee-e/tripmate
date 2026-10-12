"""
역·터미널 좌표 모으기 (2026-10-12, 피드백 2차 2단계: 대중교통 여행에서 역·터미널을 일정 장소로 넣기)
입력: tools/kakao_key.txt (카카오 REST API 키), data/regions.json (지역 중심 좌표)
출력: data/stations.json — [{ id, name, kind('KTX' | 'SRT' | '고속버스' | '시외버스'), lat, lng, address }]
방법:
  ① KTX·SRT 정차역: 아래 KTX_STATIONS 이름을 카카오 키워드 검색 → 분류에 '기차역'이 있는 첫 결과의 좌표
     (역 목록은 Claude가 노선별로 정리한 것 [추론] — 카카오에서 못 찾은 역은 끝에 출력)
  ② 버스터미널: 지역 237곳 중심에서 반경 20km 안 '버스터미널' 검색 → 분류에 '버스터미널'이 있는 곳만,
     분류나 이름에 '고속'이 있으면 고속버스, 아니면 시외버스
실행: PowerShell에서  python tools/fetch_stations.py   (카카오 호출 약 330회, 1~2분)
"""
import json, os, re, time, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
URL = 'https://dapi.kakao.com/v2/local/search/keyword.json'
OUT = os.path.join(ROOT, 'data', 'stations.json')

# KTX(KTX-산천·KTX-이음 포함) 정차역 [추론: Claude 정리, 카카오에서 위치만 확인]
KTX_STATIONS = [
    '서울역', '용산역', '청량리역', '상봉역', '행신역', '광명역', '수원역',
    '양평역', '서원주역', '만종역', '원주역', '횡성역', '둔내역', '평창역', '진부역', '강릉역', '정동진역', '묵호역', '동해역', '삼척역',
    '부발역', '가남역', '감곡장호원역', '앙성온천역', '충주역', '수안보온천역', '연풍역', '문경역',
    '오송역', '제천역', '단양역', '풍기역', '영주역', '안동역', '의성역', '영천역', '경주역',
    '천안아산역', '대전역', '서대전역', '계룡역', '논산역', '공주역',
    '익산역', '김제역', '정읍역', '전주역', '남원역', '곡성역', '구례구역', '순천역', '여천역', '여수엑스포역',
    '장성역', '광주송정역', '나주역', '목포역',
    '김천구미역', '서대구역', '대구역', '동대구역', '신경주역', '포항역', '영덕역', '울진역',
    '울산역', '태화강역', '부산역', '구포역', '부전역', '밀양역', '진영역', '창원중앙역', '창원역', '마산역', '진주역',
]
SRT_STATIONS = ['수서역', '동탄역', '평택지제역']


def search(key, query, lat=None, lng=None, radius=None):
    params = {'query': query, 'size': 15}
    if lat is not None:
        params.update(x=lng, y=lat, radius=radius, sort='distance')
    req = urllib.request.Request(URL + '?' + urllib.parse.urlencode(params), headers={'Authorization': 'KakaoAK ' + key})
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read().decode('utf-8')).get('documents', [])


def norm(n):
    return re.sub(r'[\s()]', '', n)


def row(d, kind):
    return {'id': d['id'], 'name': d['place_name'], 'kind': kind, 'lat': round(float(d['y']), 6), 'lng': round(float(d['x']), 6),
            'address': d.get('road_address_name') or d.get('address_name', '')}


def main():
    key = open(os.path.join(HERE, 'kakao_key.txt'), encoding='utf-8-sig').read().strip()
    out, seen, missing = [], set(), []

    for kind, names in (('KTX', KTX_STATIONS), ('SRT', SRT_STATIONS)):
        for name in names:
            docs = [d for d in search(key, name) if '기차역' in d.get('category_name', '')]
            if not docs:
                missing.append(name)
                continue
            exact = [d for d in docs if norm(d['place_name']).startswith(norm(name)[:-1])]
            d = (exact or docs)[0]
            if d['id'] not in seen:
                seen.add(d['id'])
                r = row(d, kind)
                r['kakaoName'], r['name'] = r['name'], name   # 이름은 목록 이름으로 ('진부역 1번출구' → '진부역')
                out.append(r)
            time.sleep(0.1)

    regions = json.load(open(os.path.join(ROOT, 'data', 'regions.json'), encoding='utf-8'))
    for i, r in enumerate(regions):
        for d in search(key, '버스터미널', r['lat'], r['lng'], 20000):
            cat = d.get('category_name', '')
            if '버스터미널' not in cat or d['id'] in seen:
                continue
            seen.add(d['id'])
            # 카카오 분류에는 고속·시외 구분이 없어 이름으로 나눔 (이름에 '고속'이 있으면 고속버스, 2026-10-12 수정)
            out.append(row(d, '고속버스' if '고속' in d['place_name'] else '시외버스'))
        if i % 20 == 0:
            print(f'버스터미널 검색 {i + 1}/{len(regions)}')
        time.sleep(0.1)

    json.dump(out, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    cnt = {}
    for s in out:
        cnt[s['kind']] = cnt.get(s['kind'], 0) + 1
    print('완료:', cnt, '→ data/stations.json')
    if missing:
        print('카카오에서 기차역으로 못 찾은 이름:', ', '.join(missing))


if __name__ == '__main__':
    main()
