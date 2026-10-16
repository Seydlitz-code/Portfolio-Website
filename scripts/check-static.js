/**
 * 정적 검사: 모든 서버·클라이언트 JS 문법 확인 + EJS 템플릿 컴파일.
 * 사용: node scripts/check-static.js
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

const ROOT = path.join(__dirname, '..');
const SKIP = new Set(['node_modules', '.git', 'data', 'uploads']);

function walk(dir, ext, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walk(p, ext, out);
    else if (name.endsWith(ext)) out.push(p);
  }
  return out;
}

let failed = 0;

const jsFiles = walk(ROOT, '.js');
for (const f of jsFiles) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) {
    failed += 1;
    console.error(`[js] ${path.relative(ROOT, f)}\n${r.stderr}`);
  }
}

const views = walk(path.join(ROOT, 'views'), '.ejs');
for (const f of views) {
  try {
    ejs.compile(fs.readFileSync(f, 'utf8'), { filename: f });
  } catch (e) {
    failed += 1;
    console.error(`[ejs] ${path.relative(ROOT, f)}: ${e.message}`);
  }
}

console.log(`JS ${jsFiles.length}개, EJS ${views.length}개 검사 — 실패 ${failed}건`);
process.exit(failed ? 1 : 0);
