/**
 * 认证 Hook — 游客模式（v4.0 §9.3）
 *
 * 游客模式优先：核心链路（景点同步/配置/播放）全部免鉴权，
 * 不注入任何 Token。微信登录为可选能力（services/api.ts wechatLogin），
 * 后续迭代接入时在此扩展。
 *
 * 注意：切勿注入伪造 JWT —— DRF 的 JWTAuthentication 对非法 Bearer
 * 直接返回 401（即使视图是 AllowAny），会导致同步链路整体失败。
 */
import { useAuthStore } from '../stores/authStore';

export function useAuth() {
  const store = useAuthStore();

  return {
    isVisitorMode: store.isVisitorMode,
    isLoggedIn: store.isLoggedIn,
    user: store.user,
    accessToken: store.accessToken,
    logout: () => store.logout(),
  };
}
