"""
全局配置 + 版本检查 + 设备心跳 — View
"""
import uuid
import hashlib
from datetime import date, timedelta
from django.db.models import Count
from rest_framework.views import APIView
from rest_framework.response import Response
from .models import GlobalConfig, DevicePing


class ConfigView(APIView):
    """GET /api/v1/config/ — 返回全部 key-value 配置"""
    permission_classes = []

    def get(self, request):
        configs = GlobalConfig.objects.all()
        data = {item.key: item.value for item in configs}
        return Response({'ok': True, 'data': data, 'message': ''})


class VersionView(APIView):
    """GET /api/v1/version/ — 返回最新版本号和下载地址"""
    permission_classes = []

    def get(self, request):
        version_code = 1
        download_url = ''
        try:
            version_code = GlobalConfig.objects.get(key='app_version_code').value
        except GlobalConfig.DoesNotExist:
            pass
        try:
            download_url = GlobalConfig.objects.get(key='app_download_url').value
        except GlobalConfig.DoesNotExist:
            pass
        return Response({
            'ok': True,
            'data': {'versionCode': version_code, 'downloadUrl': download_url},
            'message': '',
        })


class PingView(APIView):
    """POST /api/v1/ping/ — 匿名设备心跳"""
    permission_classes = []

    def post(self, request):
        dev = request.data.get('deviceId', '') if request.data else ''
        ver = request.data.get('version', '1.0.0') if request.data else '1.0.0'
        hashed = hashlib.sha256((dev or str(uuid.uuid4())).encode()).hexdigest()[:16]
        today = date.today()
        if not DevicePing.objects.filter(
            device_id=hashed, created_at__date=today,
        ).exists():
            DevicePing.objects.create(device_id=hashed, app_version=ver)
        today_count = DevicePing.objects.filter(created_at__date=today).count()
        week_count = DevicePing.objects.filter(
            created_at__date__gte=today - timedelta(days=7)
        ).count()
        return Response({
            'ok': True,
            'data': {'todayDevices': today_count, 'weekDevices': week_count},
            'message': '',
        })
