"""
景点管理 — URL 路由
"""
from django.urls import path
from .views import SpotListView

urlpatterns = [
    path('', SpotListView.as_view(), name='spot-list'),
]
