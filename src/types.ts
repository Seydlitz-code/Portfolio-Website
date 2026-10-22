/** 바인딩(Env)과 요청마다 미들웨어가 채우는 값(AppEnv.Variables)의 타입 */
export type Env = {
  DB: D1Database;
  MEDIA: R2Bucket;
  /** 쿠키 서명용 비밀값. `wrangler secret put AUTH_SECRET`(배포), `.dev.vars`(로컬)로 설정한다. */
  AUTH_SECRET: string;
};

export type SessionUser = {
  id: number;
  username: string;
  nickname: string;
  avatarUrl: string | null;
  isAdmin: boolean;
};

export type AppEnv = {
  Bindings: Env;
  Variables: {
    user: SessionUser | null;
    /** 관리자에게만 계산: 안 읽은 댓글 알림 수 */
    unreadCount: number;
  };
};
