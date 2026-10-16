/**
 * 업로드 파일의 실제 형식을 앞부분 바이트(시그니처)로 판별.
 * 브라우저가 보낸 Content-Type(file.mimetype)은 조작 가능하므로 저장·서빙 MIME은 이 결과를 사용한다.
 */
function sniffMime(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  const head6 = buf.slice(0, 6).toString('ascii');
  if (head6 === 'GIF87a' || head6 === 'GIF89a') return 'image/gif';
  if (buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'video/webm';
  if (buf.slice(4, 8).toString('ascii') === 'ftyp') {
    const brand = buf.slice(8, 12).toString('ascii');
    return brand === 'qt  ' ? 'video/quicktime' : 'video/mp4';
  }
  return null;
}

const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const VIDEO_MIMES = ['video/mp4', 'video/webm', 'video/quicktime'];

/** 허용 목록 중 실제 형식을 반환, 아니면 null */
function verifiedMime(buf, allowed) {
  const m = sniffMime(buf);
  return m && allowed.includes(m) ? m : null;
}

module.exports = { sniffMime, verifiedMime, IMAGE_MIMES, VIDEO_MIMES };
