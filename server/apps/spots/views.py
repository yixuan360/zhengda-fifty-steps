"""
景点管理 — View（业务逻辑直接写 View，V1 不需要 Service 层）
"""
from rest_framework.views import APIView
from rest_framework.response import Response
from .models import Spot
from .serializers import SpotSerializer


class SpotListView(APIView):
    """
    GET /api/v1/spots/ — 全量返回所有景点（v4.0 §7.2）
    不过滤 is_active，客户端自行隐藏。
    """
    permission_classes = []

    def get(self, request):
        spots = Spot.objects.all().order_by('id')
        serializer = SpotSerializer(spots, many=True)
        return Response({
            'ok': True,
            'data': {
                'spots': serializer.data,
                'totalCount': spots.count(),
            },
            'message': '',
        })
