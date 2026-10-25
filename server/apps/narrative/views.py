"""文脉叙事引擎 — T5 记账 API、T5.5 维度覆盖查询与 V2 深度稿 API"""
from django.db.models import Count, Prefetch
from rest_framework import status
from rest_framework.parsers import JSONParser
from rest_framework.permissions import AllowAny
from rest_framework.renderers import JSONRenderer
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle
from rest_framework.views import APIView

from .models import (
    DeepContent,
    DeepContentLog,
    KnowledgeItem,
    Route,
    RouteLog,
    RouteNarrative,
)
from .serializers import (
    DeepContentLogSerializer,
    DeepContentQuerySerializer,
    DeepContentSerializer,
    DimensionQuerySerializer,
    NarrativeLogSerializer,
    RouteDetailSerializer,
    RouteLogSerializer,
    RouteSummarySerializer,
    SpotQuerySerializer,
)


class NarrativeLogThrottle(AnonRateThrottle):
    """30 次/分钟/IP（未登录请求按 IP 计数）。"""

    scope = 'narrative_log'
    rate = '30/min'


class NarrativeLogCreateView(APIView):
    """POST /api/v2/narrative/log/ — 记录一次叙事生成结果。"""

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [NarrativeLogThrottle]

    def post(self, request):
        serializer = NarrativeLogSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(
            {'ok': True, 'data': serializer.data, 'message': ''},
            status=status.HTTP_201_CREATED,
        )


class NarrativeDimensionsView(APIView):
    """GET /api/v2/narrative/dimensions/?spot_id=N

    返回该景点已发布（approved）卡片按 dimension 的计数，供 App 决定展示
    哪几条叙事线；计数为 0 的维度不返回。字段名保持 approved_count。
    """

    authentication_classes = []
    permission_classes = [AllowAny]
    renderer_classes = [JSONRenderer]   # 保持 approved_count 的 snake_case

    def get(self, request):
        query = DimensionQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        spot_id = query.validated_data['spot_id']

        counts = {
            row['dimension']: row['approved_count']
            for row in (
                KnowledgeItem.objects
                .filter(spot_id=spot_id, status='approved')
                .values('dimension')
                .annotate(approved_count=Count('id'))
            )
        }

        data = [
            {'dimension': key, 'approved_count': counts[key]}
            for key, _ in KnowledgeItem.DIMENSIONS
            if counts.get(key)
        ]
        return Response({'ok': True, 'data': data, 'message': ''})


class DeepContentLogThrottle(AnonRateThrottle):
    """60 次/分钟/IP；深度稿事件比生成日志更频繁（播放/播完两条）。"""

    scope = 'deep_content_log'
    rate = '60/min'


class NarrativeCategoriesView(APIView):
    """GET /api/v2/narrative/categories/?spot_id=N

    只返回已有 approved 深度稿的分类，供 App 渲染分类按钮。
    """

    authentication_classes = []
    permission_classes = [AllowAny]
    renderer_classes = [JSONRenderer]

    def get(self, request):
        query = SpotQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        spot_id = query.validated_data['spot_id']

        counts = {
            row['category']: row['approved_count']
            for row in (
                DeepContent.objects
                .filter(spot_id=spot_id, status='approved')
                .values('category')
                .annotate(approved_count=Count('id'))
            )
        }

        data = [
            {'category': key, 'label': label, 'approved_count': counts[key]}
            for key, label in DeepContent.CATEGORIES
            if counts.get(key)
        ]
        return Response({'ok': True, 'data': data, 'message': ''})


class DeepContentDetailView(APIView):
    """GET /api/v2/narrative/deep/?spot_id=N&category=architecture

    返回一篇已审深度稿；没有已发布内容时 404，由 App 降级到固定播报。
    """

    authentication_classes = []
    permission_classes = [AllowAny]
    renderer_classes = [JSONRenderer]

    def get(self, request):
        query = DeepContentQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)

        content = (
            DeepContent.objects
            .filter(
                spot_id=query.validated_data['spot_id'],
                category=query.validated_data['category'],
                status='approved',
            )
            .order_by('-version')
            .first()
        )
        if content is None:
            return Response(
                {'ok': False, 'data': None, 'message': '该分类的深度稿暂未上线'},
                status=status.HTTP_404_NOT_FOUND,
            )

        return Response({
            'ok': True,
            'data': DeepContentSerializer(content).data,
            'message': '',
        })


class DeepContentLogCreateView(APIView):
    """POST /api/v2/narrative/deep/log/ — 记录深度稿查看/播放/播完/降级。"""

    authentication_classes = []
    permission_classes = [AllowAny]
    parser_classes = [JSONParser]
    renderer_classes = [JSONRenderer]
    throttle_classes = [DeepContentLogThrottle]

    def post(self, request):
        serializer = DeepContentLogSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(
            {'ok': True, 'data': serializer.data, 'message': ''},
            status=status.HTTP_201_CREATED,
        )


class RouteLogThrottle(AnonRateThrottle):
    """60 次/分钟/IP；路线事件包含规划/开始/调整/完成。"""

    scope = 'route_log'
    rate = '60/min'


class RouteListView(APIView):
    """GET /api/v2/narrative/routes/ — 已发布路线目录。"""

    authentication_classes = []
    permission_classes = [AllowAny]
    renderer_classes = [JSONRenderer]

    def get(self, request):
        routes = (
            Route.objects
            .filter(status='approved')
            .prefetch_related('stops')
            .order_by('code')
        )
        return Response({
            'ok': True,
            'data': RouteSummarySerializer(routes, many=True).data,
            'message': '',
        })


class RouteDetailView(APIView):
    """GET /api/v2/narrative/routes/<code>/ — 站点与已审路线文案。"""

    authentication_classes = []
    permission_classes = [AllowAny]
    renderer_classes = [JSONRenderer]

    def get(self, request, code):
        route = (
            Route.objects
            .filter(code=code, status='approved')
            .prefetch_related(
                'stops',
                Prefetch(
                    'narratives',
                    queryset=RouteNarrative.objects.filter(status='approved'),
                ),
            )
            .first()
        )
        if route is None:
            return Response(
                {'ok': False, 'data': None, 'message': '路线暂未上线'},
                status=status.HTTP_404_NOT_FOUND,
            )
        return Response({
            'ok': True,
            'data': RouteDetailSerializer(route).data,
            'message': '',
        })


class RouteLogCreateView(APIView):
    """POST /api/v2/narrative/routes/log/ — 路线事件日志。"""

    authentication_classes = []
    permission_classes = [AllowAny]
    parser_classes = [JSONParser]
    renderer_classes = [JSONRenderer]
    throttle_classes = [RouteLogThrottle]

    def post(self, request):
        serializer = RouteLogSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(
            {'ok': True, 'data': serializer.data, 'message': ''},
            status=status.HTTP_201_CREATED,
        )
