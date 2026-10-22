/**
 * 정적 검사: 빌드 없이 그대로 배포·실행되는 JS 파일의 문법을 확인한다.
 * 대상: public/js(브라우저 스크립트), scripts·test(Node 스크립트).
 * src/는 TypeScript라 `npm run typecheck`가 맡는다.
 * 사용: npm run lint
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TARGET_DIRS = ['public/js', 'scripts', 'test'];

function walk(directory, out = []) {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(js|mjs)$/.test(name)) out.push(path);
  }
  return out;
}

const files = TARGET_DIRS.flatMap((d) => walk(join(ROOT, d)));
let failed = 0;
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    failed += 1;
    console.error(`[js] ${relative(ROOT, file)}\n${result.stderr}`);
  }
}

console.log(`JS ${files.length}개 검사 — 실패 ${failed}건`);
process.exit(failed ? 1 : 0);
