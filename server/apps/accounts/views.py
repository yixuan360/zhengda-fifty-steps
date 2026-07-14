"""
用户认证 — View（v4.0 §7.2）
微信登录 + Token 刷新。
"""
from rest_framework import status
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework_simplejwt.tokens import RefreshToken
from .models import User
from .serializers import WechatLoginSerializer, UserSerializer


class WechatLoginView(APIView):
    """
    POST /api/v1/auth/wechat-login/
    接收微信 code → 换取 openid → 签发 JWT
    """
    permission_classes = []

    def post(self, request):
        serializer = WechatLoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        code = serializer.validated_data['code']
        # TODO: V1 真实对接时调用微信 API 换取 openid
        # 目前使用 code 作为 openid 占位（开发阶段）
        user, _ = User.objects.get_or_create(
            openid=code,
            defaults={'username': f'wx_{code[:8]}', 'nickname': '微信用户'},
        )

        refresh = RefreshToken.for_user(user)
        return Response({
            'ok': True,
            'data': {
                'access': str(refresh.access_token),
                'refresh': str(refresh),
                'user': UserSerializer(user).data,
            },
            'message': '',
        })


class TokenRefreshView(APIView):
    """
    POST /api/v1/auth/refresh/
    Token 刷新 — 不需要鉴权，直接验证 refresh token 本身的有效性。
    refresh 接口存在的意义就是 access token 已过期（v4.0 §9.2）。
    """
    permission_classes = []

    def post(self, request):
        refresh_token = request.data.get('refresh')
        if not refresh_token:
            return Response({
                'ok': False, 'data': None, 'message': '缺少 refresh token',
            }, status=status.HTTP_400_BAD_REQUEST)

        try:
            refresh = RefreshToken(refresh_token)
            return Response({
                'ok': True,
                'data': {'access': str(refresh.access_token)},
                'message': '',
            })
        except Exception:
            return Response({
                'ok': False, 'data': None, 'message': 'Refresh token 无效或已过期',
            }, status=status.HTTP_401_UNAUTHORIZED)
