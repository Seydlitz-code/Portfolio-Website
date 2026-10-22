/** 라우트 공통: 로그인·관리자 확인, 오류 화면, 상단 메뉴 데이터, 폼 값 읽기 */
import type { Context, MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { AppEnv } from '../types';
import { ErrorPage } from '../views/layout';
import type { NavData } from '../views/nav';
import { toSitePlainText } from './html';
import type { Settings } from './siteData';
import { MEDIA_MIMES } from './fileSniff';

type ErrorStatus = 400 | 403 | 404 | 500;

export function renderError(c: Context<AppEnv>, code: ErrorStatus, message: string) {
  return c.html(<ErrorPage code={code} message={message} />, code);
}

/** 비로그인이면 로그인 화면으로 보낸다 (돌아올 경로를 next로 붙임) */
export const requireLogin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!c.get('user')) {
    const url = new URL(c.req.url);
    return c.redirect('/auth/login?next=' + encodeURIComponent(url.pathname + url.search));
  }
  await next();
};

export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!c.get('user')?.isAdmin) return renderError(c, 403, '관리자 권한이 필요합니다.');
  await next();
};

/** 화면 상단 메뉴에 필요한 값을 모은다. */
export async function buildNavData(c: Context<AppEnv>, settings: Settings, extra?: Partial<NavData>): Promise<NavData> {
  const user = c.get('user');
  return {
    user,
    isAdmin: Boolean(user?.isAdmin),
    unreadCount: c.get('unreadCount') ?? 0,
    siteTitle: await toSitePlainText(settings.site_name ?? ''),
    ...extra
  };
}

export type FormBody = Record<string, string | File | (string | File)[]>;

/**
 * 요청 본문 최대 크기: 12MB (기존 서버 express.urlencoded limit와 같음).
 * 본문을 메모리에 읽기 전에 막아야 isolate 메모리(128MB)를 넘기지 않는다.
 */
const REQUEST_BODY_MAX_BYTES = 12 * 1024 * 1024;
/** 로그인·댓글처럼 짧은 값만 받는 폼의 본문 최대 크기: 64KB */
const SMALL_FORM_MAX_BYTES = 64 * 1024;
/** 파일 본문을 그대로 R2로 흘려보내는 경로. 메모리에 모으지 않으므로 자체 상한(55MB)을 쓴다. */
const STREAMED_UPLOAD_PATH = '/posts/body-upload';
/** 짧은 값만 받는 폼 경로 (로그인, 댓글 작성·수정·삭제) */
const SMALL_FORM_PATHS = [/^\/auth\/login$/, /^\/posts\/\d+\/comments(?:\/\d+)?$/];

const respondPayloadTooLarge = (c: Context<AppEnv>) => c.text('Payload Too Large', 413);
const limitToRequestMax = bodyLimit({ maxSize: REQUEST_BODY_MAX_BYTES, onError: respondPayloadTooLarge });
const limitToSmallForm = bodyLimit({ maxSize: SMALL_FORM_MAX_BYTES, onError: respondPayloadTooLarge });

/** 본문을 읽지 않고 R2로 흘려보내는 요청인지: 업로드 경로에 첨부 형식(MEDIA_MIMES)으로 보낸 POST만 해당 */
function isStreamedUpload(c: Context<AppEnv>, path: string): boolean {
  const mediaType = (c.req.header('content-type') || '').split(';')[0].trim().toLowerCase();
  return c.req.method === 'POST' && path === STREAMED_UPLOAD_PATH && MEDIA_MIMES.includes(mediaType);
}

/**
 * 모든 요청 본문 크기 제한 (앱 맨 앞 미들웨어, 본문을 읽는 다른 미들웨어보다 먼저).
 * Content-Type과 관계없이 적용하고, Content-Length가 없는 chunked 본문은 읽으면서 센다 (hono/body-limit).
 * 짧은 폼 경로는 64KB, 스트리밍 업로드는 라우트의 55MB 확인에 맡기고, 나머지는 12MB.
 */
export const limitRequestBody: MiddlewareHandler<AppEnv> = (c, next) => {
  const path = c.req.path.replace(/\/+$/, '');
  if (isStreamedUpload(c, path)) return next();
  if (SMALL_FORM_PATHS.some((pattern) => pattern.test(path))) return limitToSmallForm(c, next);
  return limitToRequestMax(c, next);
};

/** multipart 본문의 파일 외 여유분: 다른 필드·경계 문자열 (Content-Length 사전 확인용) */
const FORM_OVERHEAD_BYTES = 1024 * 1024;

/**
 * 본문을 읽기 전에 Content-Length로 너무 큰 업로드를 거른다 (파일 상한 + 다른 필드 여유분).
 * Content-Length가 없으면(chunked) 크기를 미리 알 수 없으므로 너무 큰 것으로 본다.
 * 실제 파일 크기는 본문을 읽은 뒤 checkImageFile이 다시 확인한다.
 */
export function isFormBodyTooLarge(c: Context<AppEnv>, maxFileBytes: number): boolean {
  const contentLength = c.req.header('content-length');
  if (contentLength == null) return true;
  return Number(contentLength) > maxFileBytes + FORM_OVERHEAD_BYTES;
}

/** 폼 본문 (같은 이름이 여러 번 오면 배열) */
export async function readForm(c: Context<AppEnv>): Promise<FormBody> {
  return (await c.req.parseBody({ all: true })) as FormBody;
}

/**
 * 폼의 문자열 값. 같은 이름이 여러 번 오면 비어 있지 않은 값 중 마지막을 택한다
 * (기존 서버의 bodyScalarPreferLast와 같음). 모두 비어 있으면 마지막 값을 돌려준다.
 */
export function readField(body: FormBody, name: string): string | null {
  const value = body[name];
  if (value == null) return null;
  const values = Array.isArray(value) ? value : [value];
  let lastFilled: string | null = null;
  let lastString: string | null = null;
  for (const item of values) {
    if (typeof item !== 'string') continue;
    lastString = item;
    if (item.trim() !== '') lastFilled = item;
  }
  return lastFilled ?? lastString;
}

/** 폼의 파일 값 (비어 있지 않은 첫 파일) */
export function readFileField(body: FormBody, name: string): File | null {
  const value = body[name];
  const values = Array.isArray(value) ? value : [value];
  for (const item of values) if (item instanceof File && item.size > 0) return item;
  return null;
}

/** 형식 판별에 쓰는 업로드 파일의 앞부분 (기본 16바이트) */
export async function readFileHead(file: File, length = 16): Promise<Uint8Array> {
  return new Uint8Array(await file.slice(0, length).arrayBuffer());
}
