/** 기존 PG INTEGER 상한과 맞춘다. 경로·폼의 id 값을 양의 정수로 바꾸고, 형식이 아니면 null. */
const ID_MAX = 2147483647;

export function parseId(v: unknown): number | null {
  const s = v == null ? '' : String(v).trim();
  if (!/^\d{1,10}$/.test(s)) return null;
  const n = Number(s);
  return n >= 1 && n <= ID_MAX ? n : null;
}
