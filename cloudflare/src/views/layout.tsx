import type { Child } from 'hono/jsx';
import { html } from 'hono/html';

const FONT_URL =
  'https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;700&family=Inter:wght@300;400;500;700&display=swap';

/** 모든 페이지 공통 틀. DOCTYPE이 없으면 브라우저가 쿼크 모드로 그리므로 html 태그로 붙인다. */
export function Layout(props: { title: string; bodyClass?: string; scripts?: string[]; children: Child }) {
  return html`<!DOCTYPE html>${(
    <html lang="ko">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>{props.title}</title>
        <link rel="stylesheet" href="/css/style.css" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href={FONT_URL} rel="stylesheet" />
      </head>
      <body class={props.bodyClass}>
        {props.children}
        {(props.scripts ?? []).map((src) => (
          <script src={src}></script>
        ))}
      </body>
    </html>
  )}`;
}
