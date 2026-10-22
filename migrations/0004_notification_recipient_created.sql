-- 알림 패널은 받는 사람별 최근 알림 40개를 created_at 내림차순으로 읽는다 (src/routes/api.ts).
-- 이 인덱스가 없으면 쌓인 알림 전부를 정렬해야 해서, 알림이 늘수록 D1 읽기 행 수가 함께 는다.
CREATE INDEX idx_comment_notifications_recipient_created
  ON comment_notifications (recipient_user_id, created_at DESC, id DESC);
