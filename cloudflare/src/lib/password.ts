/**
 * 비밀번호 해시: PBKDF2-SHA256 (WebCrypto).
 * 저장 형식: pbkdf2_sha256$<반복 횟수>$<salt base64>$<hash base64>
 * 반복 횟수를 함께 저장하므로 나중에 값을 바꿔도 기존 해시를 계속 검증할 수 있다.
 * scripts/admin.mjs도 같은 형식으로 해시를 만든다.
 */

/** Workers의 PBKDF2 반복 횟수 상한이 100,000이다. */
export const PBKDF2_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const KEY_BYTES = 32;
const PREFIX = 'pbkdf2_sha256';

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
    'deriveBits'
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    KEY_BYTES * 8
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(password, salt, PBKDF2_ITERATIONS);
  return `${PREFIX}$${PBKDF2_ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`;
}

/**
 * stored가 null(없는 아이디)이면 같은 계산을 한 번 하고 false를 돌려준다.
 * 응답 시간으로 계정 존재 여부가 드러나지 않게 하기 위해서다.
 */
export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (stored === null) {
    await derive(password, new Uint8Array(SALT_BYTES), PBKDF2_ITERATIONS);
    return false;
  }
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== PREFIX) return false;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > PBKDF2_ITERATIONS) return false;

  let salt: Uint8Array;
  let expected: Uint8Array;
  try {
    salt = fromBase64(parts[2]);
    expected = fromBase64(parts[3]);
  } catch {
    return false;
  }
  const actual = await derive(password, salt, iterations);
  if (actual.byteLength !== expected.byteLength) return false;
  return crypto.subtle.timingSafeEqual(actual, expected);
}
