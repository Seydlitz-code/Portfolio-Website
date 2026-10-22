/** 경로·폼의 id 검사 (기존 lib/ids.js 이식). id 값을 양의 정수로 바꾸고, 형식이 아니면 null. */
/** id 최대값: 2147483647 (2^31 - 1, 기존 PostgreSQL INTEGER 상한과 같게 둔다) */
const ID_MAX = 2147483647;

export function parseId(value: unknown): number | null {
  const text = value == null ? '' : String(value).trim();
  if (!/^\d{1,10}$/.test(text)) return null;
  const id = Number(text);
  return id >= 1 && id <= ID_MAX ? id : null;
}
