"""文脉叙事引擎 — API v2 路由"""
from django.urls import path

from .views import NarrativeLogCreateView

urlpatterns = [
    path(
        'narrative/log/', NarrativeLogCreateView.as_view(),
        name='narrative-log',
    ),
]
