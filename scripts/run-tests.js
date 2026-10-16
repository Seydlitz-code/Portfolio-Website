/**
 * 테스트 실행기: 폴더 안 *.test.js를 파일마다 별도 `node --test` 프로세스로 순서대로 실행.
 * - 파일들이 같은 PostgreSQL DB를 초기화하며 쓰므로 동시 실행하면 안 됨
 * - Node 버전마다 --test의 폴더·glob 인자와 --test-concurrency 지원이 달라 직접 순회
 * 사용: node scripts/run-tests.js test/integration [test/browser ...]
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const dirs = process.argv.slice(2);
if (!dirs.length) {
  console.error('사용법: node scripts/run-tests.js <테스트 폴더>...');
  process.exit(2);
}

const files = dirs.flatMap((d) =>
  fs
    .readdirSync(d)
    .filter((f) => f.endsWith('.test.js'))
    .sort()
    .map((f) => path.join(d, f))
);
if (!files.length) {
  console.error('테스트 파일이 없습니다:', dirs.join(', '));
  process.exit(2);
}

const failed = [];
for (const file of files) {
  console.log(`\n=== ${file}`);
  const r = spawnSync(process.execPath, ['--test', file], { stdio: 'inherit' });
  if (r.status !== 0) failed.push(file);
}

console.log(`\n테스트 파일 ${files.length}개 중 실패 ${failed.length}개${failed.length ? ': ' + failed.join(', ') : ''}`);
process.exit(failed.length ? 1 : 0);
