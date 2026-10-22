"""文脉叙事引擎 — T5 记账 API 与 T5.5 维度覆盖查询"""
from django.db.models import Count
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.renderers import JSONRenderer
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle
from rest_framework.views import APIView

from .models import KnowledgeItem
from .serializers import DimensionQuerySerializer, NarrativeLogSerializer


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
