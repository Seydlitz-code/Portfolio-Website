/** 라우트 공통: 로그인·관리자 확인, 오류 화면, 상단 메뉴 데이터, 폼 값 읽기 */
import type { Context, MiddlewareHandler } from 'hono';
import type { AppEnv } from '../types';
import { ErrorPage } from '../views/layout';
import type { NavData } from '../views/nav';
import { sitePlainText } from './html';
import type { Settings } from './siteData';

type Status = 400 | 403 | 404 | 500;

export function renderError(c: Context<AppEnv>, code: Status, message: string) {
  return c.html(<ErrorPage code={code} message={message} />, code);
}

/** 비로그인이면 로그인 화면으로 (돌아올 경로를 next로 붙임) */
export const requireLogin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!c.get('user')) {
    const u = new URL(c.req.url);
    return c.redirect('/auth/login?next=' + encodeURIComponent(u.pathname + u.search));
  }
  await next();
};

export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!c.get('user')?.isAdmin) return renderError(c, 403, '관리자 권한이 필요합니다.');
  await next();
};

export async function navData(c: Context<AppEnv>, settings: Settings, extra?: Partial<NavData>): Promise<NavData> {
  const user = c.get('user');
  return {
    user,
    isAdmin: Boolean(user?.isAdmin),
    unreadCount: c.get('unreadCount') ?? 0,
    siteTitle: await sitePlainText(settings.site_name ?? ''),
    ...extra
  };
}

export type FormBody = Record<string, string | File | (string | File)[]>;

/** 폼 본문 (같은 이름이 여러 번 오면 배열) */
export async function readForm(c: Context<AppEnv>): Promise<FormBody> {
  return (await c.req.parseBody({ all: true })) as FormBody;
}

/** 문자열 값. 같은 이름이 여러 번 오면 비어 있지 않은 값 중 마지막을 택한다. */
export function field(body: FormBody, name: string): string | null {
  const v = body[name];
  if (v == null) return null;
  const xs = Array.isArray(v) ? v : [v];
  let last: string | null = null;
  let any: string | null = null;
  for (const x of xs) {
    if (typeof x !== 'string') continue;
    any = x;
    if (x.trim() !== '') last = x;
  }
  return last ?? any;
}

export function fileField(body: FormBody, name: string): File | null {
  const v = body[name];
  const xs = Array.isArray(v) ? v : [v];
  for (const x of xs) if (x instanceof File && x.size > 0) return x;
  return null;
}

/** 업로드 파일의 앞부분(형식 판별용) */
export async function fileHead(file: File, n = 16): Promise<Uint8Array> {
  return new Uint8Array(await file.slice(0, n).arrayBuffer());
}
