"""
全局配置 — URL 路由
"""
from django.urls import path
from .views import ConfigView, VersionView, PingView

urlpatterns = [
    path('', ConfigView.as_view(), name='config-list'),
    path('version/', VersionView.as_view(), name='version'),
    path('ping/', PingView.as_view(), name='ping'),
]
