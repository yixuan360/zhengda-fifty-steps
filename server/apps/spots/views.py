"""
景点管理 — View（业务逻辑直接写 View，V1 不需要 Service 层）
"""
import math
from django.conf import settings
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from rest_framework.parsers import JSONParser
from .models import Spot
from .serializers import SpotSerializer
from .trigger_validation import validate_trigger  # 与 admin 地图编辑器共用

# ── 编辑器坐标范围（郑大主校区 GCJ-02，含容差；防误录千里之外的点） ──
CAMPUS_LAT_RANGE = (34.806, 34.829)
CAMPUS_LNG_RANGE = (113.527, 113.544)


def editor_authorized(request):
    """编辑器密钥鉴权：X-Editor-Key 头 == settings.EDITOR_KEY（课程项目简化）"""
    key = request.headers.get('X-Editor-Key', '')
    return bool(settings.EDITOR_KEY) and key == settings.EDITOR_KEY


def parse_radius(value, default=50):
    """触发半径解析：0 < v <= 1000 的有限数，返回 int；非法返回 None。"""
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(v) or v <= 0 or v > 1000:
        return None
    return int(v)


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
    注意：本视图使用原始 JSONParser（跳过全局 CamelCaseJSONParser），
    因为 App 端载荷就是 camelCase（triggerRadius/halfWidth/isActive），
    全局 parser 会把它们递归改写为 snake_case 导致这些键静默失效（C1）。
    """
    permission_classes = []
    parser_classes = [JSONParser]

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
        if len(name) > 100:
            return self._fail('景点名称过长（≤100 字符）')
        category = (data.get('category') or 'architecture')
        if len(category) > 20:
            return self._fail('分类过长（≤20 字符）')
        if not isinstance(lat, (int, float)) or not isinstance(lng, (int, float)) or not validate_coord(lat, lng):
            return self._fail('坐标无效（需在主校区范围内）')
        trigger = data.get('trigger')
        if not validate_trigger(trigger):
            return self._fail('trigger 结构无效')

        radius = parse_radius(data.get('triggerRadius', 50))
        if radius is None:
            return self._fail('触发半径需为 0-1000 的数字')

        # is_active 兼容布尔与字符串（"false"/"0" → False），避免 bool("false") 陷阱
        is_active = data.get('isActive', True)
        if isinstance(is_active, str):
            is_active = is_active.lower() not in ('0', 'false', 'no')

        spot = Spot.objects.create(
            name=name,
            lat=lat,
            lng=lng,
            trigger_radius=radius,
            summary=(data.get('summary') or ''),
            description=(data.get('description') or '') or name,
            category=category,
            is_active=bool(is_active),
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
            if len(name) > 100:
                return self._fail('景点名称过长（≤100 字符）')
            spot.name = name

        if 'lat' in data and 'lng' in data:
            lat, lng = data['lat'], data['lng']
            if not isinstance(lat, (int, float)) or not isinstance(lng, (int, float)) or not validate_coord(lat, lng):
                return self._fail('坐标无效（需在主校区范围内）')
            spot.lat, spot.lng = lat, lng

        if 'triggerRadius' in data:
            radius = parse_radius(data['triggerRadius'])
            if radius is None:
                return self._fail('触发半径需为 0-1000 的数字')
            spot.trigger_radius = radius
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
