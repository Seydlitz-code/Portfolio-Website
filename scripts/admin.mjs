#!/usr/bin/env node
/**
 * 관리자 계정 관리 (D1).
 *
 *   새 관리자 만들기:   npm run admin -- create  --remote   (로컬 D1은 --local)
 *   기존 회원 승격:     npm run admin -- promote <아이디> --remote
 *
 * create는 아이디·닉네임·비밀번호를 터미널에서 물어본다(비밀번호는 화면에 표시하지 않음).
 * 비밀번호는 이 컴퓨터에서 해시로 바꾼 뒤 해시만 D1에 저장한다.
 * 자동화용으로 ADMIN_USERNAME / ADMIN_NICKNAME / ADMIN_PASSWORD 환경변수도 받는다.
 */
import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';

/** PBKDF2 반복 횟수: 10만 회 (src/lib/password.ts와 같은 형식이어야 로그인된다) */
const PBKDF2_ITERATIONS = 100_000;
/** salt 길이: 16바이트 (src/lib/password.ts의 SALT_BYTES와 같게) */
const SALT_BYTES = 16;
/** 해시 길이: 32바이트 (src/lib/password.ts의 KEY_BYTES와 같게) */
const KEY_BYTES = 32;
const DB_NAME = 'portfolio-db';
// npx/셸을 거치지 않고 wrangler를 Node로 직접 실행한다 (Windows에서 인자 이스케이프 문제 방지).
const WRANGLER = join(dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', 'wrangler', 'bin', 'wrangler.js');
/**
 * 입력 규칙. 이 파일은 빌드 없이 Node로 바로 실행하는 스크립트라 src/lib/accountRules.ts(TypeScript)를
 * 불러올 수 없어 같은 값을 따로 둔다. 아이디·닉네임 규칙은 accountRules.ts와 같게 유지한다.
 * 비밀번호만 일부러 다르다: 회원가입은 20자까지지만, 관리자는 더 긴 비밀번호(64자)를 쓸 수 있게 한다
 * (로그인은 128자까지 받으므로 로그인에는 문제가 없다).
 */
const USERNAME_PATTERN = /^[a-zA-Z0-9_]{3,30}$/;
/** 비밀번호 최소 길이: 8글자 (회원가입과 같음) */
const PASSWORD_MIN = 8;
/** 관리자 비밀번호 최대 길이: 64글자 (로그인 입력 상한 128글자 안) */
const PASSWORD_MAX = 64;
/** 닉네임 최대 길이: 20글자 (accountRules.ts의 NICKNAME_MAX와 같게) */
const NICKNAME_MAX = 20;

function exitWithUsage(message) {
  if (message) console.error(`\n오류: ${message}\n`);
  console.error('사용법:');
  console.error('  npm run admin -- create  --remote|--local');
  console.error('  npm run admin -- promote <아이디> --remote|--local');
  process.exit(1);
}

function hashPassword(password) {
  const salt = randomBytes(SALT_BYTES);
  const hash = pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, KEY_BYTES, 'sha256');
  return `pbkdf2_sha256$${PBKDF2_ITERATIONS}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

/** SQL 문자열 리터럴. wrangler d1 execute는 바인딩 인자를 받지 않으므로 직접 이스케이프한다. */
function quoteSqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const readlineInterface = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      // 질문 문구만 출력하고, 입력한 글자는 화면에 찍지 않는다.
      readlineInterface._writeToOutput = (text) => {
        if (text.includes(question)) readlineInterface.output.write(question);
      };
    }
    readlineInterface.question(question, (answer) => {
      readlineInterface.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer);
    });
  });
}

function runSql(target, sql) {
  const tempDir = mkdtempSync(join(tmpdir(), 'portfolio-admin-'));
  const file = join(tempDir, 'admin.sql');
  try {
    writeFileSync(file, sql, 'utf8');
    const result = spawnSync(process.execPath, [WRANGLER, 'd1', 'execute', DB_NAME, target, ...PERSIST, '--file', file, '--yes'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8'
    });
    const out = `${result.stdout || ''}${result.stderr || ''}`;
    if (result.status !== 0) {
      const line = out.split('\n').find((l) => /constraint|error/i.test(l)) || out.trim().split('\n').pop();
      throw new Error(line ? line.trim() : `wrangler 종료 코드 ${result.status}`);
    }
    return out;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function query(target, sql) {
  // Windows에서 shell을 거치면 따옴표가 깨지므로 조회도 파일로 넘긴다.
  const tempDir = mkdtempSync(join(tmpdir(), 'portfolio-admin-'));
  const file = join(tempDir, 'query.sql');
  try {
    writeFileSync(file, sql, 'utf8');
    const result = spawnSync(process.execPath, [WRANGLER, 'd1', 'execute', DB_NAME, target, ...PERSIST, '--json', '--file', file, '--yes'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8'
    });
    if (result.status !== 0) throw new Error((result.stderr || result.stdout || '').trim().split('\n').pop());
    const json = JSON.parse(result.stdout.slice(result.stdout.indexOf('[')));
    return json[0]?.results ?? [];
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function create(target) {
  const username = (process.env.ADMIN_USERNAME ?? (await ask('관리자 아이디 (영문·숫자·_ 3~30자): '))).trim();
  if (!USERNAME_PATTERN.test(username)) exitWithUsage('아이디는 영문, 숫자, 밑줄(_)로 3~30자여야 합니다.');

  const nickname = (process.env.ADMIN_NICKNAME ?? (await ask(`닉네임 (최대 ${NICKNAME_MAX}자, 비우면 아이디): `))).trim() || username;
  if (Array.from(nickname).length > NICKNAME_MAX) exitWithUsage(`닉네임은 ${NICKNAME_MAX}자 이하여야 합니다.`);

  let password = process.env.ADMIN_PASSWORD;
  if (password == null) {
    password = await ask(`비밀번호 (${PASSWORD_MIN}~${PASSWORD_MAX}자): `, { hidden: true });
    const again = await ask('비밀번호 확인: ', { hidden: true });
    if (password !== again) exitWithUsage('비밀번호가 일치하지 않습니다.');
  }
  if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    exitWithUsage(`비밀번호는 ${PASSWORD_MIN}~${PASSWORD_MAX}자여야 합니다.`);
  }

  const taken = query(
    target,
    `SELECT username, nickname FROM users WHERE username = ${quoteSqlString(username)} OR nickname = ${quoteSqlString(nickname)}`
  );
  if (taken.some((r) => r.username === username)) exitWithUsage(`아이디 "${username}"는 이미 있습니다. promote를 쓰세요.`);
  if (taken.length) exitWithUsage(`닉네임 "${nickname}"은 이미 사용 중입니다.`);

  runSql(
    target,
    `INSERT INTO users (username, nickname, password_hash, is_admin, avatar_key)
     VALUES (${quoteSqlString(username)}, ${quoteSqlString(nickname)}, ${quoteSqlString(hashPassword(password))}, 1, NULL);`
  );
  console.log(`관리자 "${username}"를 만들었습니다 (${target === '--remote' ? '원격' : '로컬'} D1).`);
}

function promote(target, username) {
  if (!username || !USERNAME_PATTERN.test(username)) exitWithUsage('승격할 아이디를 정확히 입력하세요.');
  const rows = query(target, `SELECT id, is_admin FROM users WHERE username = ${quoteSqlString(username)}`);
  if (!rows.length) exitWithUsage(`아이디 "${username}"인 회원이 없습니다.`);
  if (rows[0].is_admin === 1) {
    console.log(`"${username}"는 이미 관리자입니다.`);
    return;
  }
  runSql(target, `UPDATE users SET is_admin = 1 WHERE username = ${quoteSqlString(username)};`);
  console.log(`"${username}"를 관리자로 바꿨습니다 (${target === '--remote' ? '원격' : '로컬'} D1).`);
}

const args = process.argv.slice(2);
// 테스트용: --persist-to=<폴더> 로 다른 로컬 D1 상태를 쓴다 (--local과 함께)
const persistArg = args.find((a) => a.startsWith('--persist-to='));
const PERSIST = persistArg ? ['--persist-to', persistArg.slice('--persist-to='.length)] : [];
const target = args.includes('--remote') ? '--remote' : args.includes('--local') ? '--local' : null;
if (!target) exitWithUsage('--remote(배포된 D1) 또는 --local(로컬 D1)을 지정하세요.');
const positional = args.filter((a) => !a.startsWith('--'));
const command = positional[0];

try {
  if (command === 'create') await create(target);
  else if (command === 'promote') promote(target, positional[1]);
  else exitWithUsage();
} catch (err) {
  console.error(`실패: ${err.message}`);
  process.exit(1);
}
