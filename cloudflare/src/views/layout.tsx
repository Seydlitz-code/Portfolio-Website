import type { Child } from 'hono/jsx';
import { html, raw } from 'hono/html';

const FONT_URL =
  'https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;700&family=Inter:wght@300;400;500;700&display=swap';
const FONT_AWESOME_URL = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css';

type LayoutProps = {
  title: string;
  htmlClass?: string;
  bodyClass?: string;
  /** 아이콘(Font Awesome)을 쓰는 화면 */
  icons?: boolean;
  /** body 끝에 붙일 스크립트 경로 (기존 화면 순서 그대로) */
  scripts?: (string | { src: string; defer?: boolean })[];
  children?: Child;
};

/** 모든 페이지 공통 틀. DOCTYPE이 없으면 브라우저가 쿼크 모드로 그리므로 html 태그로 붙인다. */
export function Layout(props: LayoutProps) {
  return html`<!DOCTYPE html>${(
    <html lang="ko" class={props.htmlClass}>
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>{props.title}</title>
        <link rel="stylesheet" href="/css/style.css" />
        {props.icons && <link rel="stylesheet" href={FONT_AWESOME_URL} />}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href={FONT_URL} rel="stylesheet" />
      </head>
      <body class={props.bodyClass}>
        {props.children}
        {(props.scripts ?? []).map((s) =>
          typeof s === 'string' ? <script src={s}></script> : <script src={s.src} defer={s.defer}></script>
        )}
      </body>
    </html>
  )}`;
}

/** 서버가 만든 JS(JSON 등)를 그대로 넣는 인라인 스크립트. 값은 jsonForScript로 이스케이프해서 넘긴다. */
export function InlineScript(props: { code: string }) {
  return <script>{raw(props.code)}</script>;
}

/** 이미 정제한 HTML을 그대로 출력 */
export function RawHtml(props: { html: string }) {
  return <>{raw(props.html)}</>;
}

export function ErrorPage(props: { code: number; message: string }) {
  return (
    <Layout title={`${props.code} — 포트폴리오`} bodyClass="auth-page">
      <div class="auth-container">
        <div class="auth-card" style="text-align:center;">
          <div style="font-size: 4rem; font-weight: 700; color: #d1d5db; margin-bottom: 1rem;">{props.code}</div>
          <h1 style="font-size: 1.25rem; margin-bottom: 0.75rem;">{props.message}</h1>
          <a href="/" class="btn-primary" style="display:inline-block; margin-top:1rem;">
            메인으로 돌아가기
          </a>
        </div>
      </div>
    </Layout>
  );
}
