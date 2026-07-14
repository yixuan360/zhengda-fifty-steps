"""
全局配置 — URL 路由
"""
from django.urls import path
from .views import ConfigView

urlpatterns = [
    path('', ConfigView.as_view(), name='config-list'),
]
