-- 본문 첨부가 게시물·사이트 설정에 처음 저장된 시각. NULL이면 아직 어디에도 저장되지 않은 업로드다.
-- Cron 정리는 NULL인 첨부만 검사한다. 이미 붙은 첨부 때문에 6시간마다 모든 게시물 본문을 다시 훑지 않기 위함이다.
-- 붙은 첨부가 나중에 빠지면 게시물 수정·삭제 때 바로 정리한다 (src/lib/postAssets.ts).
ALTER TABLE post_body_assets ADD COLUMN attached_at TEXT;

-- 이미 있는 첨부 중 참조 중인 것을 붙은 것으로 표시한다 (이 마이그레이션에서 한 번만 실행).
-- id 뒤가 숫자가 아니거나 문자열 끝인지 확인해 /media/post-body/7이 /media/post-body/70에 걸리지 않게 한다.
UPDATE post_body_assets
   SET attached_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE EXISTS (
         SELECT 1 FROM posts
          WHERE posts.content GLOB ('*/media/post-body/' || post_body_assets.id || '[^0-9]*')
             OR posts.content GLOB ('*/media/post-body/' || post_body_assets.id))
    OR EXISTS (
         SELECT 1 FROM site_settings
          WHERE site_settings.value GLOB ('*/media/post-body/' || post_body_assets.id || '[^0-9]*')
             OR site_settings.value GLOB ('*/media/post-body/' || post_body_assets.id));

-- Cron 정리가 읽는 "아직 붙지 않은 오래된 첨부"만 담는 부분 인덱스
CREATE INDEX idx_post_body_assets_unattached ON post_body_assets (created_at) WHERE attached_at IS NULL;
