/** 업로드 이미지 확인: 크기와 실제 형식 (회원가입·마이페이지 프로필 이미지, 메인 페이지 프로필 이미지 공통) */
import { AVATAR_MAX_BYTES } from './accountRules';
import { detectVerifiedMime, IMAGE_MIMES } from './fileSniff';
import { readFileHead } from './http';

type ImageRule = { maxBytes: number; tooLargeMessage: string; wrongTypeMessage: string };
type ImageCheckResult = { mime: string } | { error: string };

/** 회원 프로필 이미지 (회원가입·마이페이지): 3MB, 기존 서버와 같은 안내 문구 */
export const AVATAR_IMAGE_RULE: ImageRule = {
  maxBytes: AVATAR_MAX_BYTES,
  tooLargeMessage: '프로필 이미지는 3MB 이하여야 합니다.',
  wrongTypeMessage: '프로필 이미지는 JPG, PNG, GIF, WEBP만 가능합니다.'
};

/** 메인 페이지 프로필 이미지 (관리자): 5MB, 기존 서버와 같은 안내 문구 */
export const SITE_PROFILE_IMAGE_RULE: ImageRule = {
  maxBytes: 5 * 1024 * 1024,
  tooLargeMessage: '이미지는 5MB 이하여야 합니다.',
  wrongTypeMessage: '이미지 파일(JPG, PNG, GIF, WEBP)만 업로드 가능합니다.'
};

/** 크기 상한과 파일 앞부분으로 판별한 실제 형식(JPG·PNG·GIF·WEBP)을 확인한다. */
export async function checkImageFile(file: File, rule: ImageRule): Promise<ImageCheckResult> {
  if (file.size > rule.maxBytes) return { error: rule.tooLargeMessage };
  const mime = detectVerifiedMime(await readFileHead(file), IMAGE_MIMES);
  return mime ? { mime } : { error: rule.wrongTypeMessage };
}
