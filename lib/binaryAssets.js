const db = require('./db');

/** 메인 페이지 히어로 프로필 이미지 (관리자 업로드) */
const KIND_SITE_PROFILE_IMAGE = 'site_profile_image';

async function upsertSiteProfileImage(buffer, mime) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('이미지 데이터가 비어 있습니다.');
  }
  const row = await db.get('SELECT kind FROM persisted_binaries WHERE kind = ?', [
    KIND_SITE_PROFILE_IMAGE
  ]);
  if (row) {
    await db.run('UPDATE persisted_binaries SET mime = ?, data = ? WHERE kind = ?', [
      mime,
      buffer,
      KIND_SITE_PROFILE_IMAGE
    ]);
  } else {
    await db.run('INSERT INTO persisted_binaries (kind, mime, data) VALUES (?, ?, ?)', [
      KIND_SITE_PROFILE_IMAGE,
      mime,
      buffer
    ]);
  }
}

async function getPersistedBinary(kind) {
  return db.get('SELECT mime, data FROM persisted_binaries WHERE kind = ?', [kind]);
}

module.exports = {
  KIND_SITE_PROFILE_IMAGE,
  upsertSiteProfileImage,
  getPersistedBinary
};
