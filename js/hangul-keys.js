// 한/영 입력 실수 도우미 (로그인·회원가입 화면에서 사용)
// 입력: 이메일·비밀번호 칸에 들어간 글자 / 출력: 한글이 섞였는지 판단, 한글 자판으로 친 글자를 영어 자판 글자로 바꾼 값
// 예) 한글 상태로 'test'를 치면 'ㅅㄷㄴㅅ'가 입력됨 → toEnglishKeys('ㅅㄷㄴㅅ') = 'test'

const HANGUL_RE = /[ㄱ-ㅎㅏ-ㅣ가-힣]/;

// 두벌식 자판에서 각 자모가 놓인 영어 키 (Shift가 필요한 쌍자음·ㅒ·ㅖ는 대문자)
const JAMO_KEY = {
  'ㄱ': 'r', 'ㄲ': 'R', 'ㄴ': 's', 'ㄷ': 'e', 'ㄸ': 'E', 'ㄹ': 'f', 'ㅁ': 'a', 'ㅂ': 'q', 'ㅃ': 'Q', 'ㅅ': 't', 'ㅆ': 'T',
  'ㅇ': 'd', 'ㅈ': 'w', 'ㅉ': 'W', 'ㅊ': 'c', 'ㅋ': 'z', 'ㅌ': 'x', 'ㅍ': 'v', 'ㅎ': 'g',
  'ㅏ': 'k', 'ㅐ': 'o', 'ㅑ': 'i', 'ㅒ': 'O', 'ㅓ': 'j', 'ㅔ': 'p', 'ㅕ': 'u', 'ㅖ': 'P', 'ㅗ': 'h', 'ㅘ': 'hk', 'ㅙ': 'ho',
  'ㅚ': 'hl', 'ㅛ': 'y', 'ㅜ': 'n', 'ㅝ': 'nj', 'ㅞ': 'np', 'ㅟ': 'nl', 'ㅠ': 'b', 'ㅡ': 'm', 'ㅢ': 'ml', 'ㅣ': 'l',
  'ㄳ': 'rt', 'ㄵ': 'sw', 'ㄶ': 'sg', 'ㄺ': 'fr', 'ㄻ': 'fa', 'ㄼ': 'fq', 'ㄽ': 'ft', 'ㄾ': 'fx', 'ㄿ': 'fv', 'ㅀ': 'fg', 'ㅄ': 'qt'
};
const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const JUNG = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ';
const JONG = ['', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];

function hasHangul(text) { return HANGUL_RE.test(text); }

// 완성된 글자(가~힣)는 초성·중성·종성으로 나눈 뒤 각각 영어 키로 바꿈. 영어·숫자·기호는 그대로 둠
function toEnglishKeys(text) {
  let out = '';
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code >= 0xAC00 && code <= 0xD7A3) {
      const i = code - 0xAC00;
      out += JAMO_KEY[CHO[Math.floor(i / 588)]] + JAMO_KEY[JUNG[Math.floor((i % 588) / 28)]] + (JONG[i % 28] ? JAMO_KEY[JONG[i % 28]] : '');
    } else {
      out += JAMO_KEY[ch] || ch;
    }
  }
  return out;
}

// 입력 칸에 한/영·Caps Lock 안내를 붙임
// 입력: 입력 칸, 안내를 쓸 요소, 칸을 벗어날 때 한글을 영어로 바꿀지(이메일 칸만 true)
function watchKeyboard(input, hint, autoFix) {
  let composing = false;
  function update(e) {
    const msgs = [];
    if (hasHangul(input.value)) {
      msgs.push(autoFix ? '한글로 입력되고 있어요. 한/영 키를 눌러 주세요 (칸을 벗어나면 영어로 바꿔 드려요).'
                        : '한글로 입력되고 있어요. 한/영 키를 눌러 영어로 바꿔 주세요.');
    }
    if (e && e.getModifierState && e.getModifierState('CapsLock')) msgs.push('Caps Lock이 켜져 있어요.');
    hint.textContent = msgs.join(' ');
  }
  input.addEventListener('compositionstart', function () { composing = true; });
  input.addEventListener('compositionend', function () { composing = false; update(); });
  input.addEventListener('input', function () { if (!composing) update(); });
  input.addEventListener('keyup', update);
  if (autoFix) {
    input.addEventListener('blur', function () {
      if (!hasHangul(input.value)) return;
      input.value = toEnglishKeys(input.value);
      hint.textContent = '한글 자판으로 입력된 부분을 영어로 바꿨어요: ' + input.value;
    });
  }
}

if (typeof module !== 'undefined') module.exports = { toEnglishKeys, hasHangul };
