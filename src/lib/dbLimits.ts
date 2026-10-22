/**
 * D1 플랫폼 상한 (https://developers.cloudflare.com/d1/platform/limits/).
 * 상한을 넘는 쿼리는 D1이 오류로 거절하므로, 보내기 전에 여기 값으로 먼저 확인한다.
 */

/** D1 쿼리 하나에 바인딩할 수 있는 최대 값 수 */
export const D1_MAX_BOUND_PARAMS = 100;

/** D1에 저장할 수 있는 문자열·BLOB·행 하나의 최대 크기: 2,000,000바이트 */
const D1_VALUE_MAX_BYTES = 2_000_000;
/** 같은 행의 다른 컬럼(제목 등) 몫으로 남겨 두는 여유: 1KB */
const ROW_OTHER_COLUMNS_BYTES = 1024;
const UTF8_ENCODER = new TextEncoder();

/** 값 하나가 D1 저장 상한을 넘는지 (UTF-8 바이트 기준) */
export function isOverD1ValueLimit(text: string): boolean {
  return UTF8_ENCODER.encode(text).byteLength > D1_VALUE_MAX_BYTES - ROW_OTHER_COLUMNS_BYTES;
}
