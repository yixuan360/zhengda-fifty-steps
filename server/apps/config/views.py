"""
全局配置 + 版本检查 + 设备心跳 — View
"""
import uuid
import hashlib
import logging
from datetime import timedelta
from django.db.utils import IntegrityError
from django.utils import timezone
from rest_framework.views import APIView
from rest_framework.response import Response
from .models import GlobalConfig, DevicePing

logger = logging.getLogger(__name__)


class ConfigView(APIView):
    """GET /api/v1/config/ — 返回全部 key-value 配置"""
    permission_classes = []

    def get(self, request):
        configs = GlobalConfig.objects.all()
        data = {item.key: item.value for item in configs}
        return Response({'ok': True, 'data': data, 'message': ''})


class VersionView(APIView):
    """GET /api/v1/config/version/ — 返回最新版本号和下载地址"""
    permission_classes = []

    def get(self, request):
        version_code = 1
        download_url = ''
        configs = GlobalConfig.objects.filter(
            key__in=['app_version_code', 'app_download_url']
        ).values('key', 'value')
        for cfg in configs:
            if cfg['key'] == 'app_version_code':
                try:
                    version_code = int(cfg['value']) if cfg['value'] is not None else 1
                except (ValueError, TypeError):
                    logger.warning('app_version_code is not an integer: %s', cfg['value'])
            elif cfg['key'] == 'app_download_url':
                v = cfg['value']
                if isinstance(v, str) and v.startswith(('http://', 'https://')):
                    download_url = v
                elif v:
                    logger.warning('app_download_url is not a valid URL: %s', v)
        return Response({
            'ok': True,
            'data': {'versionCode': version_code, 'downloadUrl': download_url},
            'message': '',
        })


class PingView(APIView):
    """POST /api/v1/config/ping/ — 匿名设备心跳"""
    permission_classes = []

    def post(self, request):
        dev = request.data.get('deviceId', '') if request.data else ''
        ver = request.data.get('version', '1.0.0') if request.data else '1.0.0'
        hashed = hashlib.sha256((dev or str(uuid.uuid4())).encode()).hexdigest()[:16]

        # 使用服务器配置的时区确定日期边界
        today = timezone.now().date()

        if not DevicePing.objects.filter(device_id=hashed, created_at__date=today).exists():
            try:
                DevicePing.objects.create(device_id=hashed, app_version=ver)
            except IntegrityError:
                pass
            except Exception:
                logger.exception('DevicePing create failed: dev=%s', hashed)

        today_count = DevicePing.objects.filter(
            created_at__date=today,
        ).values('device_id').distinct().count()
        week_count = DevicePing.objects.filter(
            created_at__date__gte=today - timedelta(days=7),
        ).values('device_id').distinct().count()
        return Response({
            'ok': True,
            'data': {'todayDevices': today_count, 'weekDevices': week_count},
            'message': '',
        })
