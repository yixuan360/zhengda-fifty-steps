"""
景点管理 — View（业务逻辑直接写 View，V1 不需要 Service 层）
"""
from django.conf import settings
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from .models import Spot
from .serializers import SpotSerializer

# ── 编辑器坐标范围（郑大主校区 GCJ-02，含容差；防误录千里之外的点） ──
CAMPUS_LAT_RANGE = (34.806, 34.829)
CAMPUS_LNG_RANGE = (113.527, 113.544)


def editor_authorized(request):
    """编辑器密钥鉴权：X-Editor-Key 头 == settings.EDITOR_KEY（课程项目简化）"""
    key = request.headers.get('X-Editor-Key', '')
    return bool(settings.EDITOR_KEY) and key == settings.EDITOR_KEY


def validate_trigger(t):
    """服务端 trigger 结构校验，与 App 端 parseTrigger 同规则。
    返回 True 表示结构合法（None=圆形，合法）。"""
    if t is None:
        return True
    if not isinstance(t, dict):
        return False
    typ = t.get('type')
    if typ not in ('circle', 'corridor', 'polygon'):
        return False
    if typ != 'circle':
        points = t.get('points')
        if not isinstance(points, list) or len(points) == 0:
            return False
        for p in points:
            if (
                not isinstance(p, dict)
                or not isinstance(p.get('lat'), (int, float))
                or not isinstance(p.get('lng'), (int, float))
            ):
                return False
    if 'halfWidth' in t and (not isinstance(t['halfWidth'], (int, float)) or t['halfWidth'] <= 0):
        return False
    return True


def validate_coord(lat, lng):
    return (
        CAMPUS_LAT_RANGE[0] <= lat <= CAMPUS_LAT_RANGE[1]
        and CAMPUS_LNG_RANGE[0] <= lng <= CAMPUS_LNG_RANGE[1]
    )


class SpotListView(APIView):
    """
    GET /api/v1/spots/ — 全量返回所有景点（v4.0 §7.2）
    不过滤 is_active，客户端自行隐藏。
    """
    permission_classes = []

    def get(self, request):
        spots = Spot.objects.all().order_by('id')
        serializer = SpotSerializer(spots, many=True, context={'request': request})
        return Response({
            'ok': True,
            'data': {
                'spots': serializer.data,
                'totalCount': spots.count(),
            },
            'message': '',
        })


class SpotWriteView(APIView):
    """
    景点编辑器写 API（App 地图绘制模式调用）
      POST   /api/v1/spots/write/            创建
      PATCH  /api/v1/spots/write/<id>/       更新（trigger 几何/半径/坐标/名称）
      DELETE /api/v1/spots/write/<id>/       删除
    鉴权：X-Editor-Key 头（见 editor_authorized）
    """
    permission_classes = []

    def _fail(self, msg, code=400):
        return Response({'ok': False, 'data': None, 'message': msg}, status=code)

    def post(self, request):
        if not editor_authorized(request):
            return Response({'ok': False, 'data': None, 'message': '编辑器密钥错误'}, status=status.HTTP_403_FORBIDDEN)
        data = request.data
        name = (data.get('name') or '').strip()
        lat, lng = data.get('lat'), data.get('lng')
        if not name:
            return self._fail('景点名称必填')
        if not isinstance(lat, (int, float)) or not isinstance(lng, (int, float)) or not validate_coord(lat, lng):
            return self._fail('坐标无效（需在主校区范围内）')
        trigger = data.get('trigger')
        if not validate_trigger(trigger):
            return self._fail('trigger 结构无效')

        spot = Spot.objects.create(
            name=name,
            lat=lat,
            lng=lng,
            trigger_radius=int(data.get('triggerRadius', 50)),
            summary=(data.get('summary') or ''),
            description=(data.get('description') or '') or name,
            category=(data.get('category') or 'architecture'),
            is_active=bool(data.get('isActive', True)),
            trigger=trigger,
        )
        serializer = SpotSerializer(spot, context={'request': request})
        return Response({'ok': True, 'data': serializer.data, 'message': ''}, status=status.HTTP_201_CREATED)

    def patch(self, request, pk):
        if not editor_authorized(request):
            return Response({'ok': False, 'data': None, 'message': '编辑器密钥错误'}, status=status.HTTP_403_FORBIDDEN)
        try:
            spot = Spot.objects.get(pk=pk)
        except Spot.DoesNotExist:
            return self._fail('景点不存在', 404)
        data = request.data

        name = (data.get('name') or '').strip()
        if 'name' in data:
            if not name:
                return self._fail('景点名称不能为空')
            spot.name = name

        if 'lat' in data and 'lng' in data:
            lat, lng = data['lat'], data['lng']
            if not isinstance(lat, (int, float)) or not isinstance(lng, (int, float)) or not validate_coord(lat, lng):
                return self._fail('坐标无效（需在主校区范围内）')
            spot.lat, spot.lng = lat, lng

        if 'triggerRadius' in data:
            spot.trigger_radius = int(data['triggerRadius'])
        if 'trigger' in data:
            trigger = data['trigger']
            if not validate_trigger(trigger):
                return self._fail('trigger 结构无效')
            spot.trigger = trigger

        spot.save()
        serializer = SpotSerializer(spot, context={'request': request})
        return Response({'ok': True, 'data': serializer.data, 'message': ''})

    def delete(self, request, pk):
        if not editor_authorized(request):
            return Response({'ok': False, 'data': None, 'message': '编辑器密钥错误'}, status=status.HTTP_403_FORBIDDEN)
        try:
            spot = Spot.objects.get(pk=pk)
        except Spot.DoesNotExist:
            return self._fail('景点不存在', 404)
        spot.delete()
        return Response({'ok': True, 'data': None, 'message': ''})
