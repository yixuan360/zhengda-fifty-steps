"""文脉叙事引擎 — T5 生成日志记账 API"""
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle
from rest_framework.views import APIView

from .serializers import NarrativeLogSerializer


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
