"""V2 比赛版 — 深度稿模型 / API / Admin / 导入与音频命令测试。"""
import json
import os
import tempfile
from pathlib import Path
from unittest.mock import patch

from django.contrib import admin
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import IntegrityError
from django.test import Client, RequestFactory, TestCase, override_settings

from apps.narrative.admin import DeepContentAdmin
from apps.narrative.models import DeepContent, DeepContentLog
from apps.spots.models import Spot

User = get_user_model()

CATEGORIES_URL = '/api/v2/narrative/categories/'
DEEP_URL = '/api/v2/narrative/deep/'
DEEP_LOG_URL = '/api/v2/narrative/deep/log/'
ADMIN_URL = '/manage/narrative/deepcontent/'


class DeepContentModelTest(TestCase):

    @classmethod
    def setUpTestData(cls):
        cls.spot = Spot.objects.create(
            name='钟楼', lat=34.8166, lng=113.5345, description='钟楼介绍',
        )

    def _make(self, **overrides):
        data = {
            'spot': self.spot,
            'category': 'architecture',
            'title': '一座新建的老传统',
            'body': '钟楼正文',
        }
        data.update(overrides)
        return DeepContent.objects.create(**data)

    def test_defaults_pending_and_version_one(self):
        content = self._make()
        self.assertEqual(content.status, 'pending')
        self.assertEqual(content.version, 1)
        self.assertEqual(content.beats, [])
        self.assertEqual(content.sources, [])
        self.assertEqual(content.audio_path, '')

    def test_unique_spot_category(self):
        self._make()
        with self.assertRaises(IntegrityError):
            self._make(title='重复')


class DeepContentApiTest(TestCase):

    @classmethod
    def setUpTestData(cls):
        cls.spot = Spot.objects.create(
            name='图书馆', lat=34.8166, lng=113.5345, description='图书馆介绍',
        )
        cls.other = Spot.objects.create(
            name='河源', lat=34.8150, lng=113.5330, description='河源介绍',
        )
        DeepContent.objects.create(
            spot=cls.spot, category='architecture', title='一本打开的书',
            body='图书馆正文', status='approved',
            sources=[{'title': '官网', 'url': 'https://example.com', 'status': 'verified'}],
            fact_notes=[{'claim': '示例', 'status': 'corrected', 'note': '备注'}],
        )
        DeepContent.objects.create(
            spot=cls.spot, category='history', title='2005',
            body='历史正文', status='pending',
        )
        DeepContent.objects.create(
            spot=cls.other, category='academy', title='超算',
            body='其他景点', status='approved',
        )

    def setUp(self):
        cache.clear()
        self.client = Client()

    def test_categories_only_approved_and_counted(self):
        response = self.client.get(CATEGORIES_URL, {'spot_id': self.spot.id})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['data'], [
            {'category': 'architecture', 'label': '建筑', 'approved_count': 1},
        ])

    def test_categories_missing_spot_returns_400(self):
        self.assertEqual(self.client.get(CATEGORIES_URL).status_code, 400)

    def test_deep_returns_approved_content(self):
        response = self.client.get(
            DEEP_URL, {'spot_id': self.spot.id, 'category': 'architecture'},
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()['data']
        self.assertEqual(data['title'], '一本打开的书')
        self.assertEqual(data['body'], '图书馆正文')
        self.assertIsNone(data['audio_url'])
        self.assertEqual(data['sources'][0]['status'], 'verified')

    def test_deep_pending_returns_404(self):
        response = self.client.get(
            DEEP_URL, {'spot_id': self.spot.id, 'category': 'history'},
        )
        self.assertEqual(response.status_code, 404)
        self.assertFalse(response.json()['ok'])

    def test_deep_invalid_category_returns_400(self):
        response = self.client.get(
            DEEP_URL, {'spot_id': self.spot.id, 'category': 'unknown'},
        )
        self.assertEqual(response.status_code, 400)

    def test_deep_log_created_and_linked(self):
        content = DeepContent.objects.get(
            spot=self.spot, category='architecture',
        )
        response = self.client.post(
            DEEP_LOG_URL,
            data=json.dumps({
                'spot_id': self.spot.id, 'content_id': content.id,
                'category': 'architecture', 'event': 'play', 'latency_ms': 120,
            }),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 201)
        log = DeepContentLog.objects.get()
        self.assertEqual(log.event, 'play')
        self.assertEqual(log.content_id, content.id)
        self.assertEqual(log.latency_ms, 120)

    def test_deep_log_invalid_event_returns_400(self):
        response = self.client.post(
            DEEP_LOG_URL,
            data=json.dumps({
                'spot_id': self.spot.id, 'category': 'architecture',
                'event': 'unknown',
            }),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(DeepContentLog.objects.count(), 0)


class DeepContentAdminTest(TestCase):

    @classmethod
    def setUpTestData(cls):
        cls.spot = Spot.objects.create(
            name='计算机学院', lat=34.8166, lng=113.5345, description='学院介绍',
        )
        cls.admin_user = User.objects.create_superuser(
            username='deep_admin', email='deep@zhengda.com', password='deep_pass_123',
        )
        cls.admin_client = Client()
        cls.admin_client.login(username='deep_admin', password='deep_pass_123')

    def _make(self, status='pending'):
        return DeepContent.objects.create(
            spot=self.spot, category='academy', title='一台超算',
            body='正文', status=status,
        )

    def _run_action(self, action, items):
        return self.admin_client.post(ADMIN_URL, {
            'action': action,
            '_selected_action': [str(item.id) for item in items],
            'index': '0',
        })

    def test_approve_sets_reviewer(self):
        content = self._make()
        response = self._run_action('approve_selected', [content])
        self.assertEqual(response.status_code, 302)
        content.refresh_from_db()
        self.assertEqual(content.status, 'approved')
        self.assertEqual(content.reviewed_by, 'deep_admin')

    def test_reject_sets_rejected(self):
        content = self._make()
        self._run_action('reject_selected', [content])
        content.refresh_from_db()
        self.assertEqual(content.status, 'rejected')

    def test_delete_is_forbidden(self):
        content = self._make()
        self.admin_client.post(ADMIN_URL, {
            'action': 'delete_selected',
            '_selected_action': [str(content.id)],
            'index': '0',
            'post': 'yes',
        })
        self.assertTrue(DeepContent.objects.filter(id=content.id).exists())

    def test_edit_body_bumps_version_and_clears_audio(self):
        content = self._make(status='approved')
        content.audio_path = '/media/old.mp3'
        content.save(update_fields=['audio_path'])

        request = RequestFactory().get('/')
        request.user = self.admin_user
        form = type('FakeForm', (), {'changed_data': ['body']})()
        DeepContentAdmin(DeepContent, admin.site).save_model(
            request, content, form, change=True,
        )

        content.refresh_from_db()
        self.assertEqual(content.version, 2)
        self.assertEqual(content.audio_path, '')


class LoadDeepContentCommandTest(TestCase):

    @classmethod
    def setUpTestData(cls):
        cls.spot = Spot.objects.create(
            name='钟楼', lat=34.8166, lng=113.5345, description='钟楼介绍',
        )

    def setUp(self):
        self.tmp_path = None

    def tearDown(self):
        if self.tmp_path and os.path.exists(self.tmp_path):
            os.remove(self.tmp_path)

    def _write(self, payload):
        handle = tempfile.NamedTemporaryFile(
            mode='w', suffix='.json', delete=False, encoding='utf-8',
        )
        json.dump(payload, handle, ensure_ascii=False)
        handle.close()
        self.tmp_path = handle.name
        return handle.name

    def test_create_and_approve(self):
        path = self._write([{
            'spot_id': self.spot.id, 'category': 'architecture',
            'title': '标题', 'body': '正文',
            'sources': [{'title': '官网', 'url': 'https://example.com'}],
        }])
        call_command('load_deep_content', path=path, approve=True)
        content = DeepContent.objects.get()
        self.assertEqual(content.status, 'approved')
        self.assertEqual(content.version, 1)
        self.assertEqual(content.reviewed_by, 'import')

    def test_reimport_increments_version_and_clears_audio(self):
        path = self._write([{
            'spot_id': self.spot.id, 'category': 'architecture',
            'title': '标题', 'body': '正文',
        }])
        call_command('load_deep_content', path=path, approve=True)
        content = DeepContent.objects.get()
        content.audio_path = '/media/old.mp3'
        content.save(update_fields=['audio_path'])

        path = self._write([{
            'spot_id': self.spot.id, 'category': 'architecture',
            'title': '标题 v2', 'body': '正文 v2',
        }])
        call_command('load_deep_content', path=path, approve=True)
        content.refresh_from_db()
        self.assertEqual(content.version, 2)
        self.assertEqual(content.title, '标题 v2')
        self.assertEqual(content.audio_path, '')

    def test_reimport_without_approve_keeps_approved_content(self):
        path = self._write([{
            'spot_id': self.spot.id, 'category': 'architecture',
            'title': '标题', 'body': '正文',
        }])
        call_command('load_deep_content', path=path, approve=True)
        content = DeepContent.objects.get()
        content.audio_path = '/media/old.mp3'
        content.save(update_fields=['audio_path'])

        call_command('load_deep_content', path=path, approve=False)

        content.refresh_from_db()
        self.assertEqual(content.status, 'approved')
        self.assertEqual(content.version, 1)
        self.assertEqual(content.audio_path, '/media/old.mp3')

    def test_approve_promotes_pending_without_version_bump(self):
        path = self._write([{
            'spot_id': self.spot.id, 'category': 'architecture',
            'title': '标题', 'body': '正文',
        }])
        call_command('load_deep_content', path=path, approve=False)
        call_command('load_deep_content', path=path, approve=True)

        content = DeepContent.objects.get()
        self.assertEqual(content.status, 'approved')
        self.assertEqual(content.version, 1)
        self.assertEqual(content.reviewed_by, 'import')

    def test_null_source_element_raises(self):
        path = self._write([{
            'spot_id': self.spot.id, 'category': 'architecture',
            'title': '标题', 'body': '正文',
            'sources': [None],
        }])
        with self.assertRaises(CommandError):
            call_command('load_deep_content', path=path)

    def test_force_updates_unchanged_and_clears_audio(self):
        path = self._write([{
            'spot_id': self.spot.id, 'category': 'architecture',
            'title': '标题', 'body': '正文',
        }])
        call_command('load_deep_content', path=path, approve=True)
        content = DeepContent.objects.get()
        content.audio_path = '/media/old.mp3'
        content.save(update_fields=['audio_path'])

        call_command('load_deep_content', path=path, approve=True, force=True)

        content.refresh_from_db()
        self.assertEqual(content.version, 2)
        self.assertEqual(content.audio_path, '')

    def test_invalid_category_raises(self):
        path = self._write([{
            'spot_id': self.spot.id, 'category': 'unknown',
            'title': '标题', 'body': '正文',
        }])
        with self.assertRaises(CommandError):
            call_command('load_deep_content', path=path)


class GenerateDeepAudioCommandTest(TestCase):

    @classmethod
    def setUpTestData(cls):
        cls.spot = Spot.objects.create(
            name='图书馆', lat=34.8166, lng=113.5345, description='图书馆介绍',
        )
        DeepContent.objects.create(
            spot=cls.spot, category='architecture', title='一本打开的书',
            body='正文', status='approved',
        )

    def test_dry_run_prints_target_without_tts(self):
        from io import StringIO

        out = StringIO()
        call_command('generate_deep_audio', all=True, dry_run=True, stdout=out)
        self.assertIn('dry-run', out.getvalue())
        self.assertIn('architecture', out.getvalue())

    def test_requires_scope(self):
        with self.assertRaises(CommandError):
            call_command('generate_deep_audio')

    def test_all_failed_raises_even_when_some_are_skipped(self):
        skipped = DeepContent.objects.create(
            spot=self.spot, category='history', title='历史',
            body='正文', status='approved', audio_path='/media/old.mp3',
        )
        with tempfile.TemporaryDirectory() as media_root:
            target = (
                Path(media_root) / 'audio' / 'narrative' / 'deep'
                / f'{skipped.spot_id}_history_v1.mp3'
            )
            target.parent.mkdir(parents=True)
            target.write_bytes(b'x')

            with override_settings(MEDIA_ROOT=media_root):
                with patch(
                    'apps.narrative.management.commands.generate_deep_audio._synthesize',
                    side_effect=RuntimeError('tts down'),
                ):
                    with self.assertRaises(CommandError):
                        call_command('generate_deep_audio', all=True)
