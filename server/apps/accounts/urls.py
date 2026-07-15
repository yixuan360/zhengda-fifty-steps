"""
用户认证 — URL 路由
"""
from django.urls import path
from .views import MockLoginView, WechatLoginView, TokenRefreshView

urlpatterns = [
    path('login/mock/', MockLoginView.as_view(), name='mock-login'),
    path('wechat-login/', WechatLoginView.as_view(), name='wechat-login'),
    path('refresh/', TokenRefreshView.as_view(), name='token-refresh'),
]
