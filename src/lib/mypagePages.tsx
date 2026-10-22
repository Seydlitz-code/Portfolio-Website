/**
 * 마이페이지 공통: 상단·사이드 정보와 '메인 페이지 설정' 화면.
 * 마이페이지 라우트와, 메인 설정 저장 오류를 다시 보여 주는 관리자 라우트가 함께 쓴다.
 * (buildMypageShell은 기존 lib/mypageShell.js 이식)
 */
import type { Context } from 'hono';
import type { AppEnv } from '../types';
import { MypagePage, type ProfileUser } from '../views/mypage';
import { buildNavData } from './http';
import { getSiteSettings, type Settings } from './siteData';

/** 로그인한 사용자 기준으로 마이페이지 상단·사이드에 쓰는 값 */
export async function buildMypageShell(c: Context<AppEnv>, settings: Settings) {
  const user = c.get('user')!;
  const profileUser: ProfileUser = {
    id: user.id,
    username: user.username,
    nickname: user.nickname,
    avatar: user.avatarUrl
  };
  return {
    nav: await buildNavData(c, settings, { isMypageActive: true }),
    headerNickname: user.nickname,
    profileUser,
    isAdmin: user.isAdmin
  };
}

/** '메인 페이지 설정' 탭 (관리자) */
export async function renderMainSettings(
  c: Context<AppEnv>,
  status: 200 | 400,
  extras: { isSaved?: boolean; errorMessage?: string | null }
) {
  const settings = await getSiteSettings(c.env.DB);
  return c.html(
    <MypagePage
      {...await buildMypageShell(c, settings)}
      tab="mainSettings"
      settings={settings}
      isSaved={Boolean(extras.isSaved)}
      errorMessage={extras.errorMessage ?? null}
    />,
    status
  );
}
