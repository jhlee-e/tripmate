// 음식 선호 표 (2026-10-27 이재훈 요청) — 조건 입력·함께 정하기 화면이 같이 씀
// 입력: 표를 넣을 상자(element), 처음 값(trips.food_pref / trip_prefs.food_pref, 없으면 null)
// 출력: { get() → food_pref 객체, set(값) }
//   food_pref = { coffee: true|false, allergy: [키], no: [키], dislike: [키], diet: ''|'pesco'|'lacto'|'vegan', noWords: [단어], dislikeWords: [단어] }
// 추천에서 쓰는 방법(알레르기·못 먹음 = 제외, 안 먹음 = 감점)은 js/recommend.js의 FOOD_RULES·foodVerdict
// 알레르기 항목은 식품 알레르기 표시 대상 중 가게 이름으로 알아볼 수 있는 것만 골랐음 (Claude 판단)

const FOOD_ALLERGY_ITEMS = [
  ['갑각류', '갑각류 (새우·게)'], ['조개류', '조개류 (굴·전복·홍합)'], ['생선', '생선'], ['견과류', '땅콩·견과류'],
  ['밀', '밀 (빵·면)'], ['우유', '우유·유제품'], ['달걀', '달걀'], ['대두', '대두 (콩·두부)'], ['메밀', '메밀'],
  ['복숭아', '복숭아'], ['토마토', '토마토']
];
const FOOD_KIND_ITEMS = [
  ['날것', '회·날것 (육회·게장 포함)'], ['해산물', '해산물 전체'], ['고기', '고기 전체'], ['돼지고기', '돼지고기'],
  ['소고기', '소고기'], ['닭고기', '닭고기'], ['양고기', '양고기'], ['오리고기', '오리고기'], ['내장', '곱창·순대 등 내장'],
  ['매운음식', '매운 음식']
];
const FOOD_DIETS = [
  ['', '해당 없음'], ['pesco', '페스코 — 생선·해산물은 먹어요'], ['lacto', '락토·오보 — 고기·생선·해산물은 안 먹어요'],
  ['vegan', '비건 — 우유·달걀·꿀까지 안 먹어요']
];

function emptyFoodPref() { return { coffee: true, allergy: [], no: [], dislike: [], diet: '', noWords: [], dislikeWords: [] }; }

// 화면 요약 글자 ('커피 안 마심 · 알레르기: 갑각류 · 못 먹음: 회·날것 · 안 먹음: 매운 음식') — 없으면 ''
function foodPrefText(fp) {
  if (!fp) return '';
  const name = function (list, k) { const it = list.find(function (x) { return x[0] === k; }); return it ? it[1].replace(/\s*\(.*\)$/, '') : k; };
  const parts = [];
  if (fp.coffee === false) parts.push('커피 안 마심');
  if (fp.allergy && fp.allergy.length) parts.push('알레르기: ' + fp.allergy.map(function (k) { return name(FOOD_ALLERGY_ITEMS, k); }).join(', '));
  const no = (fp.no || []).map(function (k) { return name(FOOD_KIND_ITEMS, k); }).concat(fp.noWords || []);
  const dis = (fp.dislike || []).map(function (k) { return name(FOOD_KIND_ITEMS, k); }).concat(fp.dislikeWords || []);
  if (no.length) parts.push('못 먹음: ' + no.join(', '));
  if (dis.length) parts.push('안 먹음: ' + dis.join(', '));
  if (fp.diet) parts.push(name(FOOD_DIETS, fp.diet).split(' — ')[0]);
  return parts.join(' · ');
}

function makeFoodPref(box, init) {
  const uid = 'fp' + Math.random().toString(36).slice(2, 7);   // 한 화면에 표가 둘 있어도 이름이 겹치지 않게
  box.classList.add('food-pref');
  box.innerHTML =
    '<div class="fp-row"><span class="fp-label">☕ 커피</span>' +
      '<label><input type="radio" name="' + uid + '-coffee" value="yes" checked> 마셔요</label>' +
      '<label><input type="radio" name="' + uid + '-coffee" value="no"> 안 마셔요 <small class="label-note">카페는 줄이고 간식 위주로 (지역 대표 디저트 카페는 그대로)</small></label></div>' +
    '<p class="fp-label">⚠️ 알레르기 <small class="label-note">고르면 그 재료가 들어간 가게를 빼요</small></p>' +
    '<div class="fp-checks">' + FOOD_ALLERGY_ITEMS.map(function (it) {
      return '<label><input type="checkbox" data-allergy="' + it[0] + '"> ' + it[1] + '</label>';
    }).join('') + '</div>' +
    '<p class="fp-label">🍽️ 음식 종류</p>' +
    '<table class="fp-table"><thead><tr><th></th><th>괜찮아요</th><th>안 먹어요<small>뒤로 미룸</small></th><th>못 먹어요<small>빼기</small></th></tr></thead><tbody>' +
      FOOD_KIND_ITEMS.map(function (it) {
        const n = uid + '-' + it[0];
        return '<tr><td>' + it[1] + '</td>' + ['', 'dislike', 'no'].map(function (v) {
          return '<td><input type="radio" name="' + n + '" value="' + v + '" data-kind="' + it[0] + '"' + (v === '' ? ' checked' : '') + ' aria-label="' + it[1] + '"></td>';
        }).join('') + '</tr>';
      }).join('') + '</tbody></table>' +
    '<label class="fp-label" for="' + uid + '-diet">🥗 채식 단계</label>' +
    '<select id="' + uid + '-diet">' + FOOD_DIETS.map(function (d) { return '<option value="' + d[0] + '">' + d[1] + '</option>'; }).join('') + '</select>' +
    '<p class="fp-label">✍️ 직접 입력 <small class="label-note">쉼표로 나눠서 · 가게 이름에 그 말이 들어간 곳을 걸러요</small></p>' +
    '<input type="text" id="' + uid + '-no" placeholder="못 먹는 음식 (예: 오이, 가지)">' +
    '<input type="text" id="' + uid + '-dislike" placeholder="안 먹는 음식 (예: 고수)">' +
    '<p class="helper-text muted fp-note">가게 메뉴 정보가 없어 가게 이름·분류로만 걸러요. 이름에 안 드러나는 재료(국물·소스 등)까지는 알 수 없으니, 알레르기가 있으면 꼭 가게에 직접 확인해 주세요.</p>';

  const $ = function (sel) { return box.querySelector(sel); };
  const words = function (v) { return v.split(/[,，、]/).map(function (w) { return w.trim(); }).filter(Boolean).slice(0, 20); };

  function get() {
    const fp = emptyFoodPref();
    fp.coffee = $('input[name="' + uid + '-coffee"]:checked').value !== 'no';
    box.querySelectorAll('[data-allergy]').forEach(function (c) { if (c.checked) fp.allergy.push(c.dataset.allergy); });
    box.querySelectorAll('[data-kind]').forEach(function (r) {
      if (r.checked && r.value) fp[r.value].push(r.dataset.kind);
    });
    fp.diet = $('#' + uid + '-diet').value;
    fp.noWords = words($('#' + uid + '-no').value);
    fp.dislikeWords = words($('#' + uid + '-dislike').value);
    return fp;
  }
  function set(fp) {
    fp = Object.assign(emptyFoodPref(), fp || {});
    box.querySelector('input[name="' + uid + '-coffee"][value="' + (fp.coffee === false ? 'no' : 'yes') + '"]').checked = true;
    box.querySelectorAll('[data-allergy]').forEach(function (c) { c.checked = fp.allergy.indexOf(c.dataset.allergy) !== -1; });
    FOOD_KIND_ITEMS.forEach(function (it) {
      const v = fp.no.indexOf(it[0]) !== -1 ? 'no' : fp.dislike.indexOf(it[0]) !== -1 ? 'dislike' : '';
      box.querySelector('input[name="' + uid + '-' + it[0] + '"][value="' + v + '"]').checked = true;
    });
    $('#' + uid + '-diet').value = fp.diet || '';
    $('#' + uid + '-no').value = fp.noWords.join(', ');
    $('#' + uid + '-dislike').value = fp.dislikeWords.join(', ');
  }
  set(init);
  return { get: get, set: set };
}

// 저장할 값: 아무것도 안 골랐으면(커피 마심 + 빈칸) null
function foodPrefOrNull(fp) {
  return fp && (fp.coffee === false || fp.allergy.length || fp.no.length || fp.dislike.length || fp.diet || fp.noWords.length || fp.dislikeWords.length) ? fp : null;
}
