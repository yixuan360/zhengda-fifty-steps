"""文脉叙事引擎 — API v2 路由"""
from django.urls import path

from .views import NarrativeDimensionsView, NarrativeLogCreateView

urlpatterns = [
    path(
        'narrative/log/', NarrativeLogCreateView.as_view(),
        name='narrative-log',
    ),
    path(
        'narrative/dimensions/', NarrativeDimensionsView.as_view(),
        name='narrative-dimensions',
    ),
]
