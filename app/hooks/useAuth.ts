/**
 * 认证 Hook — 游客模式 Mock Token
 * v4.0 §9.3：游客模式优先，微信登录为可选能力
 *
 * 仅在 __DEV__ 模式下自动注入 Mock Token，允许开发阶段
 * 无需微信 SDK 即可验证完整前端链路。
 * 生产构建中跳过，App 以纯游客模式运行（核心链路免鉴权）。
 */
import { useEffect } from 'react';
import { useAuthStore } from '../stores/authStore';

/** Mock JWT（仅开发模式生效） */
const MOCK_ACCESS_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.mock-access-token';
const MOCK_REFRESH_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.mock-refresh-token';

const MOCK_USER = {
  id: 0,
  username: 'visitor',
  nickname: '游客',
  avatarUrl: '',
};

export function useAuth() {
  const store = useAuthStore();

  useEffect(() => {
    // 仅在开发模式下自动注入 Mock Token
    if (!__DEV__) return;
    if (store.isVisitorMode && !store.accessToken) {
      store.setTokens(MOCK_ACCESS_TOKEN, MOCK_REFRESH_TOKEN);
      store.setUser(MOCK_USER);
    }
  }, []);

  return {
    isVisitorMode: store.isVisitorMode,
    isLoggedIn: store.isLoggedIn,
    user: store.user,
    accessToken: store.accessToken,
    logout: () => store.logout(),
  };
}
