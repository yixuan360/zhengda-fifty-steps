"""
全局配置 — View（v4.0 §7.2）
GET /api/v1/config/ — 下发全局配置，无需鉴权。
"""
from rest_framework.views import APIView
from rest_framework.response import Response
from .models import GlobalConfig


class ConfigView(APIView):
    """
    GET /api/v1/config/ — 返回全部 key-value 配置
    无需鉴权
    """
    permission_classes = []

    def get(self, request):
        configs = GlobalConfig.objects.all()
        data = {item.key: item.value for item in configs}
        return Response({
            'ok': True,
            'data': data,
            'message': '',
        })
