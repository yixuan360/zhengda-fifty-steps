"""
Django Admin 端到端测试（v4.0 §4.3 / §10.1）
覆盖：登录 → 上传图片/音频 → MIME 白名单拒绝非法文件 → API 返回完整 imageUrl
"""
from io import BytesIO
from PIL import Image
from django.test import TestCase, Client
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.exceptions import ValidationError
from django.contrib.auth import get_user_model
from apps.spots.models import Spot
from apps.spots.admin import _validate_file_mime, ALLOWED_IMAGE_MIME, ALLOWED_AUDIO_MIME

User = get_user_model()


def _make_test_image():
    buf = BytesIO()
    img = Image.new('RGB', (1, 1), color='red')
    img.save(buf, format='PNG')
    buf.seek(0)
    return buf.read()


class AdminE2ETest(TestCase):

    @classmethod
    def setUpTestData(cls):
        cls.admin_user = User.objects.create_superuser(
            username='e2e_admin',
            email='e2e@zhengda.com',
            password='e2e_pass_123',
        )
        cls.admin_client = Client()
        cls.admin_client.login(username='e2e_admin', password='e2e_pass_123')

    # ═══════════════════════════════════════════════════════
    # 1. Admin 登录 + 页面可达
    # ═══════════════════════════════════════════════════════

    def test_admin_login_success(self):
        """Admin 超管登录后能访问景点列表页"""
        response = self.admin_client.get('/manage/spots/spot/')
        self.assertEqual(response.status_code, 200)

    def test_admin_add_spot_page(self):
        """Admin 新增景点页面正常加载"""
        response = self.admin_client.get('/manage/spots/spot/add/')
        self.assertEqual(response.status_code, 200)

    # ═══════════════════════════════════════════════════════
    # 2. 创建景点 + 上传有效图片 → API 验证完整 imageUrl
    # ═══════════════════════════════════════════════════════

    def test_create_spot_with_valid_image(self):
        """上传合法 PNG 图片 → 创建成功 → API 返回完整绝对 URL"""
        image = SimpleUploadedFile(
            'test.png', _make_test_image(), content_type='image/png',
        )
        response = self.admin_client.post('/manage/spots/spot/add/', {
            'name': '测试景点',
            'category': 'architecture',  # Admin 分类为必填 ChoiceField（分类动态化后）
            'lat': '34.817',
            'lng': '113.535',
            'trigger_radius': '50',
            'summary': '测试摘要',
            'description': '测试详细描述',
            'is_active': '1',
            'image': image,
            '_save': '保存',
        }, follow=True)
        self.assertEqual(response.status_code, 200)
        self.assertNotContains(response, 'errorlist', status_code=200)

        spot = Spot.objects.get(name='测试景点')
        self.assertTrue(bool(spot.image))
        self.assertIn('images/', spot.image.name)

        # ★ API 返回完整 imageUrl（含协议+域名）
        api_response = self.client.get('/api/v1/spots/')
        body = api_response.json()
        self.assertTrue(body['ok'])
        test_spot = next(s for s in body['data']['spots'] if s['name'] == '测试景点')
        self.assertTrue(
            test_spot['imageUrl'].startswith('http'),
            f'imageUrl should be absolute, got: {test_spot["imageUrl"]}',
        )
        spot.image.delete(save=True)

    def test_full_spot_with_media_api_response(self):
        """上传合法图片 + 音频 → API 返回完整 imageUrl / audioUrl"""
        image = SimpleUploadedFile(
            'spot.png', _make_test_image(), content_type='image/png',
        )
        fake_mp3 = SimpleUploadedFile(
            'intro.mp3',
            b'\xff\xfb\x90\x00' + b'\x00' * 256,
            content_type='audio/mpeg',
        )
        response = self.admin_client.post('/manage/spots/spot/add/', {
            'name': '完整景点',
            'category': 'architecture',  # Admin 分类为必填 ChoiceField（分类动态化后）
            'lat': '34.818',
            'lng': '113.536',
            'trigger_radius': '60',
            'summary': '有图有音频的景点',
            'description': '完整的景点信息，包含图片和音频。',
            'is_active': '1',
            'image': image,
            'audio': fake_mp3,
            '_save': '保存',
        }, follow=True)
        self.assertEqual(response.status_code, 200)
        self.assertNotContains(response, 'errorlist', status_code=200)

        spot = Spot.objects.get(name='完整景点')
        self.assertTrue(bool(spot.image))
        self.assertTrue(bool(spot.audio))

        # ★ API 返回完整 URL
        api_response = self.client.get('/api/v1/spots/')
        body = api_response.json()
        self.assertTrue(body['ok'])
        test_spot = next(s for s in body['data']['spots'] if s['name'] == '完整景点')
        self.assertTrue(test_spot['imageUrl'].startswith('http'))
        self.assertTrue(test_spot['audioUrl'].startswith('http'))
        self.assertEqual(test_spot['isActive'], True)
        self.assertEqual(test_spot['triggerRadius'], 60)

        spot.image.delete(save=True)
        spot.audio.delete(save=True)

    # ═══════════════════════════════════════════════════════
    # 3. MIME 白名单：直接测试校验函数（绕过 HTTP 层）
    # ═══════════════════════════════════════════════════════

    def test_mime_accepts_png(self):
        """image/png 在白名单中 → 通过"""
        f = SimpleUploadedFile('ok.png', _make_test_image(), content_type='image/png')
        _validate_file_mime(f, ALLOWED_IMAGE_MIME, '图片')

    def test_mime_accepts_jpeg(self):
        """image/jpeg 在白名单中 → 通过"""
        f = SimpleUploadedFile('ok.jpg', _make_test_image(), content_type='image/jpeg')
        _validate_file_mime(f, ALLOWED_IMAGE_MIME, '图片')

    def test_mime_accepts_webp(self):
        """image/webp 在白名单中 → 通过"""
        f = SimpleUploadedFile('ok.webp', _make_test_image(), content_type='image/webp')
        _validate_file_mime(f, ALLOWED_IMAGE_MIME, '图片')

    def test_mime_rejects_text_plain(self):
        """text/plain 不在图片白名单 → ValidationError"""
        f = SimpleUploadedFile('bad.png', _make_test_image(), content_type='text/plain')
        with self.assertRaises(ValidationError) as ctx:
            _validate_file_mime(f, ALLOWED_IMAGE_MIME, '图片')
        self.assertIn('文件类型不支持', str(ctx.exception))

    def test_mime_rejects_application_zip(self):
        """application/zip 不在图片白名单 → ValidationError"""
        f = SimpleUploadedFile('bad.zip', b'PK\x03\x04', content_type='application/zip')
        with self.assertRaises(ValidationError):
            _validate_file_mime(f, ALLOWED_IMAGE_MIME, '图片')

    def test_mime_accepts_audio_mpeg(self):
        """audio/mpeg 在音频白名单中 → 通过"""
        f = SimpleUploadedFile('ok.mp3', b'\xff\xfb', content_type='audio/mpeg')
        _validate_file_mime(f, ALLOWED_AUDIO_MIME, '音频')

    def test_mime_accepts_audio_wav(self):
        """audio/wav 在音频白名单中 → 通过"""
        f = SimpleUploadedFile('ok.wav', b'RIFF', content_type='audio/wav')
        _validate_file_mime(f, ALLOWED_AUDIO_MIME, '音频')

    def test_mime_accepts_audio_mp3_alias(self):
        """audio/mp3（非标准别名）在白名单中 → 通过"""
        f = SimpleUploadedFile('ok.mp3', b'\xff\xfb', content_type='audio/mp3')
        _validate_file_mime(f, ALLOWED_AUDIO_MIME, '音频')

    def test_mime_rejects_octet_stream(self):
        """application/octet-stream 不在音频白名单 → ValidationError"""
        f = SimpleUploadedFile('bad.mp3', b'\xff\xfb', content_type='application/octet-stream')
        with self.assertRaises(ValidationError) as ctx:
            _validate_file_mime(f, ALLOWED_AUDIO_MIME, '音频')
        self.assertIn('文件类型不支持', str(ctx.exception))

    # ═══════════════════════════════════════════════════════
    # 4. 批量启用/禁用 action + 保存并编辑下一个（_savenext）
    # ═══════════════════════════════════════════════════════

    def _spot_form_data(self, **overrides):
        """change 页 POST 所需的最小表单字段"""
        data = {
            'name': '编辑甲',
            'category': 'architecture',
            'lat': '34.816',
            'lng': '113.534',
            'trigger_radius': '50',
            'summary': '',
            'description': '编辑页介绍',
            'is_active': '1',
        }
        data.update(overrides)
        return data

    def test_bulk_disable_action(self):
        """列表页勾选多行执行“批量禁用”→ 这些景点 is_active=False"""
        s1 = Spot.objects.create(name='批量禁用甲', lat=34.816, lng=113.534)
        s2 = Spot.objects.create(name='批量禁用乙', lat=34.816, lng=113.534)
        resp = self.admin_client.post('/manage/spots/spot/', {
            'action': 'disable_spots',
            '_selected_action': [str(s1.id), str(s2.id)],
            'index': '0',
        })
        self.assertEqual(resp.status_code, 302)
        self.assertFalse(Spot.objects.get(id=s1.id).is_active)
        self.assertFalse(Spot.objects.get(id=s2.id).is_active)

    def test_bulk_enable_action(self):
        """列表页勾选执行“批量启用”→ is_active=True"""
        s1 = Spot.objects.create(name='批量启用甲', lat=34.816, lng=113.534, is_active=False)
        resp = self.admin_client.post('/manage/spots/spot/', {
            'action': 'enable_spots',
            '_selected_action': [str(s1.id)],
            'index': '0',
        })
        self.assertEqual(resp.status_code, 302)
        self.assertTrue(Spot.objects.get(id=s1.id).is_active)

    def test_save_next_redirects_to_next_spot(self):
        """点击“保存并编辑下一个”→ 保存成功并 302 跳到 id 相邻的下一个景点"""
        s1 = Spot.objects.create(name='编辑甲', lat=34.816, lng=113.534)
        s2 = Spot.objects.create(name='编辑乙', lat=34.816, lng=113.534)
        resp = self.admin_client.post(
            f'/manage/spots/spot/{s1.id}/change/',
            self._spot_form_data(name='编辑甲改', _savenext='保存并编辑下一个'),
        )
        self.assertEqual(resp.status_code, 302)
        self.assertEqual(resp.url, f'/manage/spots/spot/{s2.id}/change/')
        # 数据已落库（不是仅跳转）
        self.assertTrue(Spot.objects.filter(id=s1.id, name='编辑甲改').exists())

    def test_save_next_last_spot_returns_to_list(self):
        """已是最后一个景点时点“保存并编辑下一个”→ 正常保存并回列表页"""
        s1 = Spot.objects.create(name='唯一景', lat=34.816, lng=113.534)
        resp = self.admin_client.post(
            f'/manage/spots/spot/{s1.id}/change/',
            self._spot_form_data(name='唯一景改', _savenext='保存并编辑下一个'),
        )
        self.assertEqual(resp.status_code, 302)
        # 最后一个 → super().response_change 默认回列表页（含 filters 空串）
        self.assertEqual(resp.url, '/manage/spots/spot/')
        self.assertTrue(Spot.objects.filter(id=s1.id, name='唯一景改').exists())
