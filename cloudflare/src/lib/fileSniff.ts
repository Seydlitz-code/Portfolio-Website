/**
 * 업로드 파일의 실제 형식을 앞부분 바이트(시그니처)로 판별한다 (기존 lib/fileSniff.js 이식).
 * 브라우저가 보낸 Content-Type은 조작할 수 있으므로 저장·서빙할 때는 이 결과를 쓴다.
 */
export const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;
export const VIDEO_MIMES = ['video/mp4', 'video/webm', 'video/quicktime'] as const;

function ascii(buf: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...buf.subarray(start, end));
}

export function sniffMime(buf: Uint8Array): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (png.every((b, i) => buf[i] === b)) return 'image/png';
  const head6 = ascii(buf, 0, 6);
  if (head6 === 'GIF87a' || head6 === 'GIF89a') return 'image/gif';
  if (ascii(buf, 0, 4) === 'RIFF' && ascii(buf, 8, 12) === 'WEBP') return 'image/webp';
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'video/webm';
  if (ascii(buf, 4, 8) === 'ftyp') {
    return ascii(buf, 8, 12) === 'qt  ' ? 'video/quicktime' : 'video/mp4';
  }
  return null;
}

/** 허용 목록 중 실제 형식을 돌려주고, 아니면 null */
export function verifiedMime(buf: Uint8Array, allowed: readonly string[]): string | null {
  const m = sniffMime(buf);
  return m && allowed.includes(m) ? m : null;
}
