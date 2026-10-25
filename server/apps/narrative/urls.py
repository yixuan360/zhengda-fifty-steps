"""文脉叙事引擎 — API v2 路由"""
from django.urls import path

from .views import (
    DeepContentDetailView,
    DeepContentLogCreateView,
    NarrativeCategoriesView,
    NarrativeDimensionsView,
    NarrativeLogCreateView,
    RouteDetailView,
    RouteListView,
    RouteLogCreateView,
)

urlpatterns = [
    path(
        'narrative/log/', NarrativeLogCreateView.as_view(),
        name='narrative-log',
    ),
    path(
        'narrative/dimensions/', NarrativeDimensionsView.as_view(),
        name='narrative-dimensions',
    ),
    # V2 比赛版：深度稿（与 V1 的 dimensions/next 链路并存）
    path(
        'narrative/categories/', NarrativeCategoriesView.as_view(),
        name='narrative-categories',
    ),
    path(
        'narrative/deep/log/', DeepContentLogCreateView.as_view(),
        name='narrative-deep-log',
    ),
    path(
        'narrative/deep/', DeepContentDetailView.as_view(),
        name='narrative-deep',
    ),
    # V3 比赛版：路线叙事
    path(
        'narrative/routes/', RouteListView.as_view(),
        name='narrative-routes',
    ),
    path(
        'narrative/routes/log/', RouteLogCreateView.as_view(),
        name='narrative-routes-log',
    ),
    path(
        'narrative/routes/<str:code>/', RouteDetailView.as_view(),
        name='narrative-route-detail',
    ),
]
