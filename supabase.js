// Supabase 연결 설정 — 모든 화면에서 이 파일을 불러와 sb로 DB·로그인을 사용
// 입력: 프로젝트 주소와 공개(publishable) 키 / 출력: 전역 변수 sb, 함수 requireLogin()·logout()
const SUPABASE_URL = 'https://wstwezpajgoqadakohdm.supabase.co';
const SUPABASE_KEY = 'sb_publishable_kiQO5mYX6cz9BPFk3-yngw_C18qiKXz';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// 로그인한 사용자만 들어올 수 있는 화면에서 호출
// 로그인 정보(세션)가 없으면 로그인 화면으로 보내고 null, 있으면 사용자 객체를 돌려줌
async function requireLogin() {
  const { data } = await sb.auth.getSession();
  if (!data.session) {
    location.replace('index.html');
    return null;
  }
  return data.session.user;
}

// 로그아웃 후 로그인 화면으로 이동
async function logout() {
  await sb.auth.signOut();
  location.replace('index.html');
}
