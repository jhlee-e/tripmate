cd "$(dirname "$0")/.." && python3 tools/review_next.py ${1:-10} | awk -F'|' '{print $1"|"$7}'
