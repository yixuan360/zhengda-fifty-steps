"""V3 — 路线模型 / API / Admin / 导入与音频命令测试。"""
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

from apps.narrative.admin import RouteNarrativeAdmin
from apps.narrative.models import Route, RouteLog, RouteNarrative, RouteStop
from apps.spots.models import Spot

User = get_user_model()

ROUTES_URL = '/api/v2/narrative/routes/'
ROUTE_LOG_URL = '/api/v2/narrative/routes/log/'
ADMIN_ROUTES = '/manage/narrative/route/'
ADMIN_NARRATIVES = '/manage/narrative/routenarrative/'


class RouteModelTest(TestCase):

    @classmethod
    def setUpTestData(cls):
        cls.spot = Spot.objects.create(
            name='河源', lat=34.8153, lng=113.5350, description='河源介绍',
        )

    def _make_route(self, code='meihu-test'):
        return Route.objects.create(
            code=code, name='眉湖测试', subtitle='副标题', theme='水脉线',
            total_minutes=30, walking_km=0.9,
        )

    def test_defaults(self):
        route = self._make_route()
        self.assertEqual(route.status, 'pending')
        self.assertEqual(route.version, 1)
        self.assertEqual(route.stops.count(), 0)
        self.assertEqual(route.narratives.count(), 0)

    def test_route_code_unique(self):
        self._make_route()
        with self.assertRaises(IntegrityError):
            self._make_route()

    def test_stop_order_unique(self):
        route = self._make_route()
        RouteStop.objects.create(route=route, spot=self.spot, order=1)
        with self.assertRaises(IntegrityError):
            RouteStop.objects.create(route=route, spot=self.spot, order=1)

    def test_narrative_key_unique(self):
        route = self._make_route()
        RouteNarrative.objects.create(
            route=route, key='intro', kind='intro', text='开场',
        )
        with self.assertRaises(IntegrityError):
            RouteNarrative.objects.create(
                route=route, key='intro', kind='intro', text='重复',
            )


class RouteApiTest(TestCase):

    @classmethod
    def setUpTestData(cls):
        cls.spot1 = Spot.objects.create(
            name='河源', lat=34.8153, lng=113.5350, description='河源介绍',
        )
        cls.spot2 = Spot.objects.create(
            name='问鼎', lat=34.8156, lng=113.5350, description='问鼎介绍',
        )
        cls.route = Route.objects.create(
            code='meihu-test', name='眉湖八景', subtitle='从河源到凤台荷香',
            theme='水脉线', total_minutes=30, walking_km=0.9,
            status='approved',
        )
        RouteStop.objects.create(
            route=cls.route, spot=cls.spot1, order=1,
            category='history', duration_seconds=90,
        )
        RouteStop.objects.create(
            route=cls.route, spot=cls.spot2, order=2,
            category='history', duration_seconds=75, optional=True,
        )
        RouteNarrative.objects.create(
            route=cls.route, key='intro', kind='intro', text='开场',
            status='approved',
        )
        RouteNarrative.objects.create(
            route=cls.route, key='t1', kind='transition',
            from_order=1, to_order=2, text='过渡', status='approved',
        )
        cls.pending = Route.objects.create(
            code='pending-route', name='未发布', status='pending',
        )

    def setUp(self):
        cache.clear()
        self.client = Client()

    def test_list_only_approved(self):
        response = self.client.get(ROUTES_URL)
        self.assertEqual(response.status_code, 200)
        data = response.json()['data']
        self.assertEqual(len(data), 1)
        self.assertEqual(data[0]['code'], 'meihu-test')
        self.assertEqual(data[0]['stops_count'], 2)
        self.assertEqual(data[0]['optional_count'], 1)
        self.assertEqual(data[0]['walking_km'], 0.9)

    def test_detail_returns_stops_and_narratives(self):
        response = self.client.get(f'/api/v2/narrative/routes/{self.route.code}/')
        self.assertEqual(response.status_code, 200)
        data = response.json()['data']
        self.assertEqual(len(data['stops']), 2)
        self.assertEqual(data['stops'][0]['spot_id'], self.spot1.id)
        self.assertEqual(data['walking_km'], 0.9)
        self.assertEqual(len(data['narratives']), 2)
        self.assertEqual(
            [item['key'] for item in data['narratives']],
            ['intro', 't1'],
        )

    def test_pending_route_returns_404(self):
        response = self.client.get('/api/v2/narrative/routes/pending-route/')
        self.assertEqual(response.status_code, 404)
        self.assertFalse(response.json()['ok'])

    def test_unknown_route_returns_404(self):
        response = self.client.get('/api/v2/narrative/routes/nope/')
        self.assertEqual(response.status_code, 404)

    def test_route_log_created(self):
        response = self.client.post(
            ROUTE_LOG_URL,
            data=json.dumps({
                'route_code': self.route.code,
                'event': 'start',
                'spot_id': self.spot1.id,
                'payload': {'minutes': 30},
                'latency_ms': 120,
            }),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 201)
        log = RouteLog.objects.get()
        self.assertEqual(log.event, 'start')
        self.assertEqual(log.spot_id, self.spot1.id)

    def test_route_log_invalid_event_returns_400(self):
        response = self.client.post(
            ROUTE_LOG_URL,
            data=json.dumps({
                'route_code': self.route.code,
                'event': 'unknown',
            }),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(RouteLog.objects.count(), 0)

    def test_route_log_payload_too_large_returns_400(self):
        response = self.client.post(
            ROUTE_LOG_URL,
            data=json.dumps({
                'route_code': self.route.code,
                'event': 'start',
                'payload': {'x': 'a' * 5000},
            }),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(RouteLog.objects.count(), 0)

    def test_num_proxies_configured_for_nginx(self):
        from rest_framework.settings import api_settings
        self.assertEqual(api_settings.NUM_PROXIES, 1)

    def test_route_log_invalid_fields_return_400(self):
        cases = [
            {
                'route_code': self.route.code, 'event': 'start',
                'latency_ms': -1,
            },
            {
                'route_code': self.route.code, 'event': 'start',
                'spot_id': -3,
            },
            {
                'route_code': self.route.code, 'event': 'start',
                'payload': 'oops',
            },
        ]
        for payload in cases:
            with self.subTest(payload=payload):
                response = self.client.post(
                    ROUTE_LOG_URL,
                    data=json.dumps(payload),
                    content_type='application/json',
                )
                self.assertEqual(response.status_code, 400)
        self.assertEqual(RouteLog.objects.count(), 0)


class RouteAdminTest(TestCase):

    @classmethod
    def setUpTestData(cls):
        cls.spot = Spot.objects.create(
            name='河源', lat=34.8153, lng=113.5350, description='河源介绍',
        )
        cls.admin_user = User.objects.create_superuser(
            username='route_admin', email='route@zhengda.com',
            password='route_pass_123',
        )
        cls.admin_client = Client()
        cls.admin_client.login(
            username='route_admin', password='route_pass_123',
        )

    def _make_route(self, status='pending'):
        return Route.objects.create(
            code='meihu-test', name='眉湖测试', status=status,
        )

    def _make_narrative(self, route, status='pending'):
        return RouteNarrative.objects.create(
            route=route, key='intro', kind='intro', text='开场',
            status=status,
        )

    def _run_action(self, url, action, items):
        return self.admin_client.post(url, {
            'action': action,
            '_selected_action': [str(item.id) for item in items],
            'index': '0',
        })

    def test_approve_route(self):
        route = self._make_route()
        response = self._run_action(
            ADMIN_ROUTES, 'approve_selected', [route],
        )
        self.assertEqual(response.status_code, 302)
        route.refresh_from_db()
        self.assertEqual(route.status, 'approved')
        self.assertEqual(route.reviewed_by, 'route_admin')

    def test_approve_route_promotes_pending_narratives(self):
        route = self._make_route()
        narrative = self._make_narrative(route, status='pending')
        self._run_action(ADMIN_ROUTES, 'approve_selected', [route])
        route.refresh_from_db()
        narrative.refresh_from_db()
        self.assertEqual(route.status, 'approved')
        self.assertEqual(narrative.status, 'approved')
        self.assertEqual(narrative.reviewed_by, 'route_admin')

    def test_reject_narrative(self):
        route = self._make_route(status='approved')
        narrative = self._make_narrative(route)
        self._run_action(
            ADMIN_NARRATIVES, 'reject_selected', [narrative],
        )
        narrative.refresh_from_db()
        self.assertEqual(narrative.status, 'rejected')

    def test_edit_narrative_text_bumps_version_and_clears_audio(self):
        route = self._make_route(status='approved')
        narrative = self._make_narrative(route, status='approved')
        narrative.audio_path = '/media/old.mp3'
        narrative.save(update_fields=['audio_path'])

        request = RequestFactory().get('/')
        request.user = self.admin_user
        form = type('FakeForm', (), {'changed_data': ['text']})()
        RouteNarrativeAdmin(RouteNarrative, admin.site).save_model(
            request, narrative, form, change=True,
        )

        narrative.refresh_from_db()
        self.assertEqual(narrative.version, 2)
        self.assertEqual(narrative.audio_path, '')
        self.assertEqual(narrative.status, 'pending')
        self.assertEqual(narrative.reviewed_by, '')

    def test_delete_is_forbidden(self):
        route = self._make_route()
        self.admin_client.post(ADMIN_ROUTES, {
            'action': 'delete_selected',
            '_selected_action': [str(route.id)],
            'index': '0',
            'post': 'yes',
        })
        self.assertTrue(Route.objects.filter(id=route.id).exists())


class LoadRoutesCommandTest(TestCase):

    @classmethod
    def setUpTestData(cls):
        cls.spot1 = Spot.objects.create(
            name='河源', lat=34.8153, lng=113.5350, description='河源介绍',
        )
        cls.spot2 = Spot.objects.create(
            name='问鼎', lat=34.8156, lng=113.5350, description='问鼎介绍',
        )

    def setUp(self):
        self.tmp_path = None

    def tearDown(self):
        if self.tmp_path and os.path.exists(self.tmp_path):
            os.remove(self.tmp_path)

    def _payload(self, name='眉湖测试'):
        return [{
            'code': 'meihu-test',
            'name': name,
            'subtitle': '从河源到凤台荷香',
            'theme': '水脉线',
            'total_minutes': 30,
            'walking_km': 0.9,
            'stops': [
                {
                    'order': 1, 'spot_id': self.spot1.id,
                    'category': 'history', 'duration_seconds': 90,
                },
                {
                    'order': 2, 'spot_id': self.spot2.id,
                    'category': 'history', 'duration_seconds': 75,
                    'optional': True,
                },
            ],
            'narratives': [
                {'key': 'intro', 'kind': 'intro', 'text': '开场'},
                {
                    'key': 't1', 'kind': 'transition',
                    'from_order': 1, 'to_order': 2, 'text': '过渡',
                },
                {'key': 'outro', 'kind': 'outro', 'text': '收尾'},
            ],
        }]

    def _write(self, payload):
        handle = tempfile.NamedTemporaryFile(
            mode='w', suffix='.json', delete=False, encoding='utf-8',
        )
        json.dump(payload, handle, ensure_ascii=False)
        handle.close()
        self.tmp_path = handle.name
        return handle.name

    def test_create_and_approve(self):
        path = self._write(self._payload())
        call_command('load_routes', path=path, approve=True)
        route = Route.objects.get(code='meihu-test')
        self.assertEqual(route.status, 'approved')
        self.assertEqual(route.stops.count(), 2)
        self.assertEqual(route.narratives.count(), 3)
        self.assertTrue(
            route.narratives.filter(status='approved').count() == 3
        )

    def test_reimport_unchanged_keeps_approved_and_version(self):
        path = self._write(self._payload())
        call_command('load_routes', path=path, approve=True)
        route = Route.objects.get(code='meihu-test')

        call_command('load_routes', path=path, approve=True)
        route.refresh_from_db()
        self.assertEqual(route.status, 'approved')
        self.assertEqual(route.version, 1)

    def test_reimport_changed_bumps_version_and_replaces_children(self):
        path = self._write(self._payload())
        call_command('load_routes', path=path, approve=True)
        old_stop_ids = set(
            RouteStop.objects.values_list('id', flat=True)
        )

        path = self._write(self._payload(name='眉湖测试 v2'))
        call_command('load_routes', path=path, approve=True)
        route = Route.objects.get(code='meihu-test')
        self.assertEqual(route.name, '眉湖测试 v2')
        self.assertEqual(route.version, 2)
        self.assertNotEqual(
            old_stop_ids,
            set(RouteStop.objects.values_list('id', flat=True)),
        )

    def test_changed_narrative_increments_version_and_clears_audio(self):
        path = self._write(self._payload())
        call_command('load_routes', path=path, approve=True)
        route = Route.objects.get(code='meihu-test')
        narrative = route.narratives.get(key='t1')
        narrative.audio_path = '/media/old.mp3'
        narrative.save(update_fields=['audio_path'])

        payload = self._payload()
        payload[0]['narratives'][1]['text'] = '过渡 v2'
        path = self._write(payload)
        call_command('load_routes', path=path, approve=True)

        narrative.refresh_from_db()
        self.assertEqual(narrative.version, 2)
        self.assertEqual(narrative.audio_path, '')
        self.assertEqual(narrative.text, '过渡 v2')
        self.assertEqual(narrative.status, 'approved')

    def test_unsafe_code_raises(self):
        payload = self._payload()
        payload[0]['code'] = '../evil'
        path = self._write(payload)
        with self.assertRaises(CommandError):
            call_command('load_routes', path=path)

    def test_unsafe_key_raises(self):
        payload = self._payload()
        payload[0]['narratives'][0]['key'] = '../intro'
        path = self._write(payload)
        with self.assertRaises(CommandError):
            call_command('load_routes', path=path)

    def test_force_updates_unchanged(self):
        path = self._write(self._payload())
        call_command('load_routes', path=path, approve=True)
        call_command('load_routes', path=path, approve=True, force=True)
        route = Route.objects.get(code='meihu-test')
        self.assertEqual(route.version, 2)

    def test_dry_run_does_not_write(self):
        path = self._write(self._payload())
        call_command('load_routes', path=path, dry_run=True)
        self.assertEqual(Route.objects.count(), 0)

    def test_approve_does_not_resurrect_rejected_narrative(self):
        path = self._write(self._payload())
        call_command('load_routes', path=path, approve=True)
        route = Route.objects.get(code='meihu-test')
        narrative = route.narratives.get(key='t1')
        narrative.status = 'rejected'
        narrative.reviewed_by = 'reviewer'
        narrative.save(update_fields=['status', 'reviewed_by'])

        call_command('load_routes', path=path, approve=True)

        narrative.refresh_from_db()
        self.assertEqual(narrative.status, 'rejected')
        self.assertEqual(narrative.reviewed_by, 'reviewer')

    def test_changed_rejected_narrative_goes_back_to_pending(self):
        path = self._write(self._payload())
        call_command('load_routes', path=path, approve=True)
        narrative = RouteNarrative.objects.get(
            route__code='meihu-test', key='t1',
        )
        narrative.status = 'rejected'
        narrative.reviewed_by = 'reviewer'
        narrative.save(update_fields=['status', 'reviewed_by'])

        payload = self._payload()
        payload[0]['narratives'][1]['text'] = '过渡改稿'
        path = self._write(payload)
        call_command('load_routes', path=path, approve=True)

        narrative.refresh_from_db()
        self.assertEqual(narrative.status, 'pending')
        self.assertEqual(narrative.reviewed_by, '')
        self.assertEqual(narrative.text, '过渡改稿')

    def test_force_does_not_republish_rejected_route(self):
        path = self._write(self._payload())
        call_command('load_routes', path=path, approve=True)
        route = Route.objects.get(code='meihu-test')
        route.status = 'rejected'
        route.reviewed_by = 'reviewer'
        route.save(update_fields=['status', 'reviewed_by'])

        call_command('load_routes', path=path, approve=True, force=True)

        route.refresh_from_db()
        self.assertEqual(route.status, 'pending')
        self.assertEqual(route.reviewed_by, '')

    def test_missing_narratives_key_does_not_delete_existing(self):
        path = self._write(self._payload())
        call_command('load_routes', path=path, approve=True)
        before = RouteNarrative.objects.count()

        payload = self._payload()
        payload[0].pop('narratives')
        path = self._write(payload)
        with self.assertRaises(CommandError):
            call_command('load_routes', path=path, approve=True)

        self.assertEqual(RouteNarrative.objects.count(), before)

    def test_duplicate_route_code_raises(self):
        payload = self._payload()
        payload.append(dict(payload[0]))
        path = self._write(payload)
        with self.assertRaises(CommandError):
            call_command('load_routes', path=path)

    def test_transition_orders_must_exist(self):
        payload = self._payload()
        payload[0]['narratives'][1]['from_order'] = 9
        payload[0]['narratives'][1]['to_order'] = 10
        path = self._write(payload)
        with self.assertRaises(CommandError):
            call_command('load_routes', path=path)

    def test_overlong_note_raises(self):
        payload = self._payload()
        payload[0]['stops'][0]['note'] = 'x' * 161
        path = self._write(payload)
        with self.assertRaises(CommandError):
            call_command('load_routes', path=path)

    def test_invalid_spot_raises(self):
        payload = self._payload()
        payload[0]['stops'][0]['spot_id'] = 999999
        path = self._write(payload)
        with self.assertRaises(CommandError):
            call_command('load_routes', path=path)

    def test_duplicate_order_raises(self):
        payload = self._payload()
        payload[0]['stops'][1]['order'] = 1
        path = self._write(payload)
        with self.assertRaises(CommandError):
            call_command('load_routes', path=path)

    def test_transition_missing_orders_raises(self):
        payload = self._payload()
        payload[0]['narratives'][1].pop('from_order')
        path = self._write(payload)
        with self.assertRaises(CommandError):
            call_command('load_routes', path=path)


class GenerateRouteAudioCommandTest(TestCase):

    @classmethod
    def setUpTestData(cls):
        cls.spot = Spot.objects.create(
            name='河源', lat=34.8153, lng=113.5350, description='河源介绍',
        )
        cls.route = Route.objects.create(
            code='meihu-test', name='眉湖测试', status='approved',
        )
        RouteNarrative.objects.create(
            route=cls.route, key='intro', kind='intro', text='开场',
            status='approved',
        )
        RouteNarrative.objects.create(
            route=cls.route, key='outro', kind='outro', text='收尾',
            status='approved',
        )

    def test_dry_run_prints_target_without_tts(self):
        from io import StringIO

        out = StringIO()
        call_command(
            'generate_route_audio', route='meihu-test', dry_run=True, stdout=out,
        )
        self.assertIn('dry-run', out.getvalue())
        self.assertIn('intro', out.getvalue())

    def test_requires_scope(self):
        with self.assertRaises(CommandError):
            call_command('generate_route_audio')

    def test_all_failed_raises_even_when_some_are_skipped(self):
        skipped = RouteNarrative.objects.get(route=self.route, key='outro')
        skipped.audio_path = '/media/old.mp3'
        skipped.save(update_fields=['audio_path'])

        with tempfile.TemporaryDirectory() as media_root:
            target = (
                Path(media_root) / 'audio' / 'narrative' / 'routes'
                / f'{self.route.id}_outro_v1.mp3'
            )
            target.parent.mkdir(parents=True)
            target.write_bytes(b'x')

            with override_settings(MEDIA_ROOT=media_root):
                with patch(
                    'apps.narrative.management.commands.generate_route_audio._synthesize',
                    side_effect=RuntimeError('tts down'),
                ):
                    with self.assertRaises(CommandError):
                        call_command(
                            'generate_route_audio', route='meihu-test',
                        )
