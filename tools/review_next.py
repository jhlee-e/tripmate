# 다음에 확인할 장소 n개를 검색어로 출력 (입력: n / 출력: id|지역|이름|검색어 줄)
import json, os, sys, re
HERE = os.path.dirname(os.path.abspath(__file__))
q = json.load(open(os.path.join(HERE, 'review_queue.json'), encoding='utf-8'))
c = json.load(open(os.path.join(HERE, 'review_check.json'), encoding='utf-8'))
n = int(sys.argv[1]) if len(sys.argv) > 1 else 10
for x in [x for x in q if str(x['id']) not in c][:n]:
    m = re.search(r'([가-힣0-9]+(?:로|길)[0-9가-힣]*\s*[0-9-]+)', x['address'])
    print(x['id'], x['region'], x['type'], x['name'], '|', x['region'] + ' ' + x['name'] + (' ' + m.group(1) if m else ''), sep='|')
