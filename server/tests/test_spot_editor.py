"""
景点编辑器写 API 测试
覆盖：编辑器密钥鉴权、trigger 结构校验、坐标范围校验、创建/更新/删除
"""
from django.test import TestCase, override_settings
from apps.spots.models import Spot

EDITOR_KEY = 'test-editor-key'


@override_settings(EDITOR_KEY=EDITOR_KEY)
class SpotWriteAPITest(TestCase):
    def _url(self, pk=None):
        return f'/api/v1/spots/write/{pk}/' if pk else '/api/v1/spots/write/'

    def _headers(self, key=None):
        return {'HTTP_X_EDITOR_KEY': key or EDITOR_KEY, 'content_type': 'application/json'}

    # ── 鉴权 ──────────────────────────────────────────
    def test_missing_key_forbidden(self):
        resp = self.client.post(self._url(), data={'name': 'x', 'lat': 34.816, 'lng': 113.534})
        self.assertEqual(resp.status_code, 403)

    def test_wrong_key_forbidden(self):
        resp = self.client.post(self._url(), data={'name': 'x', 'lat': 34.816, 'lng': 113.534},
                                **self._headers('wrong'))
        self.assertEqual(resp.status_code, 403)

    # ── 创建 ──────────────────────────────────────────
    def test_create_corridor_ok(self):
        payload = {
            'name': '测试桥',
            'lat': 34.81632,
            'lng': 113.534402,
            'triggerRadius': 50,
            'trigger': {'type': 'corridor', 'halfWidth': 8, 'points': [
                {'lat': 34.816332, 'lng': 113.534242},
                {'lat': 34.816308, 'lng': 113.534562},
            ]},
        }
        resp = self.client.post(self._url(), data=payload, **self._headers())
        self.assertEqual(resp.status_code, 201)
        self.assertTrue(resp.json()['ok'])
        spot = Spot.objects.get(name='测试桥')
        self.assertEqual(spot.trigger['type'], 'corridor')
        self.assertEqual(len(spot.trigger['points']), 2)
        # 往返断言：camelCase 载荷经原始 JSONParser 后，半径/半宽必须原样落库
        self.assertEqual(spot.trigger_radius, 50)
        self.assertEqual(spot.trigger['halfWidth'], 8)

    def test_create_radius_and_is_active_roundtrip(self):
        """回归 C1：全局 CamelCaseJSONParser 曾把 triggerRadius/isActive/halfWidth
        改写为 snake_case 导致这些键静默失效（半径恒 50、is_active 恒 True）。"""
        payload = {
            'name': '回归半径80',
            'lat': 34.817,
            'lng': 113.535,
            'triggerRadius': 80,
            'isActive': False,
            'trigger': {'type': 'corridor', 'halfWidth': 6, 'points': [
                {'lat': 34.816, 'lng': 113.534}, {'lat': 34.816, 'lng': 113.535},
            ]},
        }
        resp = self.client.post(self._url(), data=payload, **self._headers())
        self.assertEqual(resp.status_code, 201)
        spot = Spot.objects.get(name='回归半径80')
        self.assertEqual(spot.trigger_radius, 80)
        self.assertIs(spot.is_active, False)
        self.assertEqual(spot.trigger['halfWidth'], 6)
        # 响应回读也应保持一致（renderer 不应改写 trigger 子树）
        resp_trigger = resp.json()['data']['trigger']
        self.assertEqual(resp_trigger['halfWidth'], 6)
        self.assertEqual(resp.json()['data']['triggerRadius'], 80)

    # ── 校验：半径 / 最小点数 / 长度（H1/H2/M1） ─────────
    def test_create_bad_radius_bad(self):
        for bad in (0, -5, 'abc', 5000):
            payload = {'name': 'x', 'lat': 34.816, 'lng': 113.534, 'triggerRadius': bad}
            resp = self.client.post(self._url(), data=payload, **self._headers())
            self.assertEqual(resp.status_code, 400, msg=f'radius={bad!r} 应 400')

    def test_create_one_point_corridor_bad(self):
        payload = {'name': 'x', 'lat': 34.816, 'lng': 113.534,
                   'trigger': {'type': 'corridor', 'points': [{'lat': 34.816, 'lng': 113.534}]}}
        resp = self.client.post(self._url(), data=payload, **self._headers())
        self.assertEqual(resp.status_code, 400)

    def test_create_two_point_polygon_bad(self):
        payload = {'name': 'x', 'lat': 34.816, 'lng': 113.534,
                   'trigger': {'type': 'polygon', 'points': [
                       {'lat': 34.816, 'lng': 113.534}, {'lat': 34.817, 'lng': 113.534},
                   ]}}
        resp = self.client.post(self._url(), data=payload, **self._headers())
        self.assertEqual(resp.status_code, 400)

    def test_create_name_too_long_bad(self):
        payload = {'name': '景' * 101, 'lat': 34.816, 'lng': 113.534}
        resp = self.client.post(self._url(), data=payload, **self._headers())
        self.assertEqual(resp.status_code, 400)

    def test_create_missing_name_bad(self):
        resp = self.client.post(self._url(), data={'lat': 34.816, 'lng': 113.534}, **self._headers())
        self.assertEqual(resp.status_code, 400)

    def test_create_coord_out_of_campus_bad(self):
        resp = self.client.post(self._url(), data={'name': 'x', 'lat': 40.0, 'lng': 116.0}, **self._headers())
        self.assertEqual(resp.status_code, 400)

    def test_create_invalid_trigger_bad(self):
        payload = {'name': 'x', 'lat': 34.816, 'lng': 113.534,
                   'trigger': {'type': 'polygon', 'points': ['garbage']}}
        resp = self.client.post(self._url(), data=payload, **self._headers())
        self.assertEqual(resp.status_code, 400)

    def test_create_unknown_type_bad(self):
        payload = {'name': 'x', 'lat': 34.816, 'lng': 113.534,
                   'trigger': {'type': 'path'}}
        resp = self.client.post(self._url(), data=payload, **self._headers())
        self.assertEqual(resp.status_code, 400)

    # ── 更新 ──────────────────────────────────────────
    def test_patch_trigger_ok(self):
        spot = Spot.objects.create(name='原景', lat=34.816, lng=113.534)
        payload = {'trigger': {'type': 'polygon', 'points': [
            {'lat': 34.816, 'lng': 113.534}, {'lat': 34.817, 'lng': 113.534},
            {'lat': 34.817, 'lng': 113.535},
        ]}}
        resp = self.client.patch(self._url(spot.id), data=payload, **self._headers())
        self.assertEqual(resp.status_code, 200)
        spot.refresh_from_db()
        self.assertEqual(spot.trigger['type'], 'polygon')
        self.assertEqual(len(spot.trigger['points']), 3)

    def test_patch_radius_roundtrip(self):
        spot = Spot.objects.create(name='圆景', lat=34.816, lng=113.534, trigger_radius=50)
        resp = self.client.patch(self._url(spot.id), data={'triggerRadius': 120}, **self._headers())
        self.assertEqual(resp.status_code, 200)
        spot.refresh_from_db()
        self.assertEqual(spot.trigger_radius, 120)

    def test_patch_bad_radius_bad(self):
        spot = Spot.objects.create(name='圆景', lat=34.816, lng=113.534)
        resp = self.client.patch(self._url(spot.id), data={'triggerRadius': -3}, **self._headers())
        self.assertEqual(resp.status_code, 400)
        spot.refresh_from_db()
        self.assertEqual(spot.trigger_radius, 50)

    def test_patch_nonexistent_404(self):
        resp = self.client.patch(self._url(99999), data={'trigger': None}, **self._headers())
        self.assertEqual(resp.status_code, 404)

    def test_patch_trigger_none_clears_geometry(self):
        spot = Spot.objects.create(name='圆景', lat=34.816, lng=113.534, trigger={
            'type': 'corridor', 'points': [{'lat': 34.816, 'lng': 113.534}, {'lat': 34.817, 'lng': 113.534}],
        })
        resp = self.client.patch(self._url(spot.id), data={'trigger': None}, **self._headers())
        self.assertEqual(resp.status_code, 200)
        spot.refresh_from_db()
        self.assertIsNone(spot.trigger)

    # ── 删除 ──────────────────────────────────────────
    def test_delete_ok(self):
        spot = Spot.objects.create(name='待删', lat=34.816, lng=113.534)
        resp = self.client.delete(self._url(spot.id), **self._headers())
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(Spot.objects.filter(id=spot.id).exists())


class SpotListAPITest(TestCase):
    """GET /api/v1/spots/ — 服务端过滤 is_active（禁用景点不下发）"""

    def _create(self, name, is_active=True):
        return Spot.objects.create(name=name, lat=34.816, lng=113.534, is_active=is_active)

    def test_list_excludes_inactive_spots(self):
        """禁用景点不出现在列表，totalCount 只统计启用景点"""
        self._create('启用甲')
        self._create('启用乙')
        self._create('禁用丙', is_active=False)

        resp = self.client.get('/api/v1/spots/')
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        names = {s['name'] for s in body['data']['spots']}
        self.assertIn('启用甲', names)
        self.assertIn('启用乙', names)
        self.assertNotIn('禁用丙', names)
        self.assertEqual(body['data']['totalCount'], 2)

    def test_list_all_disabled_returns_empty(self):
        """全部禁用时列表为空、totalCount 为 0"""
        self._create('仅禁用', is_active=False)

        resp = self.client.get('/api/v1/spots/')
        body = resp.json()
        self.assertEqual(body['data']['spots'], [])
        self.assertEqual(body['data']['totalCount'], 0)

    def test_list_only_active_roundtrip(self):
        """禁用后 totalCount 从 N 降到 N-1，恢复启用后回升（回归保护）"""
        a = self._create('启用甲')
        b = self._create('启用乙')

        def total():
            return self.client.get('/api/v1/spots/').json()['data']['totalCount']

        self.assertEqual(total(), 2)
        b.is_active = False
        b.save(update_fields=['is_active'])
        self.assertEqual(total(), 1)
        b.is_active = True
        b.save(update_fields=['is_active'])
        self.assertEqual(total(), 2)
        self.assertNotEqual(a.id, b.id)
