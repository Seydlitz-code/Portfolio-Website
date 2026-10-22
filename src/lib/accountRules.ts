/**
 * 회원 정보 입력 규칙 (기존 routes/auth.js와 같은 값). 회원가입·마이페이지·중복 확인이 함께 쓴다.
 * scripts/admin.mjs는 이 파일을 불러올 수 없어 같은 값을 따로 두며, 관리자 비밀번호만 64자까지 허용한다.
 */

/** 아이디 최소 길이: 3글자 (기존 서버와 같음) */
export const USERNAME_MIN = 3;
/** 아이디 최대 길이: 30글자 (기존 서버와 같음) */
export const USERNAME_MAX = 30;
/** 아이디에 쓸 수 있는 문자: 영문, 숫자, 밑줄 */
export const USERNAME_PATTERN = /^[a-zA-Z0-9_]+$/;
/** 닉네임 최대 길이 (글자 단위, 이모지도 한 글자) */
export const NICKNAME_MAX = 20;
/** 비밀번호 최소 길이: 8글자 (기존 서버와 같음) */
export const PASSWORD_MIN = 8;
/** 비밀번호 최대 길이: 20글자 (기존 서버와 같음, 관리자 계정만 scripts/admin.mjs에서 64글자까지) */
export const PASSWORD_MAX = 20;
/** 회원 프로필 이미지 최대 크기: 3MB (기존 서버와 같음) */
export const AVATAR_MAX_BYTES = 3 * 1024 * 1024;
