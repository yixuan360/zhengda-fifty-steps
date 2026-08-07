"""
景点管理 — URL 路由
"""
from django.urls import path
from .views import SpotListView, SpotWriteView

urlpatterns = [
    path('', SpotListView.as_view(), name='spot-list'),
    path('write/', SpotWriteView.as_view(), name='spot-write-create'),
    path('write/<int:pk>/', SpotWriteView.as_view(), name='spot-write-detail'),
]
