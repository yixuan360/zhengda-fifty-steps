"""
用户认证 — URL 路由
"""
from django.urls import path
from .views import WechatLoginView, TokenRefreshView

urlpatterns = [
    path('wechat-login/', WechatLoginView.as_view(), name='wechat-login'),
    path('refresh/', TokenRefreshView.as_view(), name='token-refresh'),
]
