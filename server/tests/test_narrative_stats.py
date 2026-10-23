"""
文脉叙事引擎 T7 — 度量闭环测试
覆盖：Admin 统计聚合正确性、只读、近 7 天口径、上报接口 201。
"""
import json
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import Client, TestCase
from django.utils import timezone

from apps.narrative.models import NarrativeLog

User = get_user_model()

STATS_URL = '/manage/narrative/narrativelog/stats/'
LOG_URL = '/api/v2/narrative/log/'


class NarrativeStatsTest(TestCase):

    @classmethod
    def setUpTestData(cls):
        cls.admin_user = User.objects.create_superuser(
            username='stats_admin',
            email='stats@zhengda.com',
            password='stats_pass_123',
        )

    def setUp(self):
        self.client = Client()
        self.client.login(username='stats_admin', password='stats_pass_123')

    def _log(self, spot_id=16, dimension='history', fallback=False,
             latency_ms=100, days_ago=0):
        log = NarrativeLog.objects.create(
            spot_id=spot_id, dimension=dimension, depth=1,
            fallback=fallback, latency_ms=latency_ms,
        )
        if days_ago:
            NarrativeLog.objects.filter(id=log.id).update(
                created_at=timezone.now() - timedelta(days=days_ago),
            )
        return log

    def _stats(self):
        response = self.client.get(STATS_URL)
        self.assertEqual(response.status_code, 200)
        return {
            (row['spot_id'], row['dimension']): row
            for row in response.context_data['stats']
        }

    # ── 聚合正确性 ────────────────────────────────────────

    def test_aggregates_by_spot_and_dimension(self):
        self._log(spot_id=16, dimension='history', latency_ms=100)
        self._log(spot_id=16, dimension='history', fallback=True, latency_ms=200)
        self._log(spot_id=16, dimension='history', latency_ms=300)
        self._log(spot_id=6, dimension='nature', latency_ms=50)

        stats = self._stats()
        self.assertEqual(set(stats), {(16, 'history'), (6, 'nature')})

        history = stats[(16, 'history')]
        self.assertEqual(history['total'], 3)
        self.assertEqual(history['fallbacks'], 1)
        self.assertAlmostEqual(history['fallback_rate'], 100 / 3, places=4)
        self.assertEqual(history['avg_latency'], 200)

        nature = stats[(6, 'nature')]
        self.assertEqual(nature['total'], 1)
        self.assertEqual(nature['fallbacks'], 0)
        self.assertEqual(nature['fallback_rate'], 0)

    def test_recent_seven_days_window(self):
        self._log(spot_id=16, days_ago=1)
        self._log(spot_id=16, fallback=True, days_ago=3)
        self._log(spot_id=16, days_ago=10)

        row = self._stats()[(16, 'history')]
        self.assertEqual(row['total'], 3)
        self.assertEqual(row['recent_total'], 2)
        self.assertEqual(row['recent_fallbacks'], 1)

    def test_stats_view_is_read_only(self):
        self._log()
        before = NarrativeLog.objects.count()
        self._stats()
        self.assertEqual(NarrativeLog.objects.count(), before)

    def test_stats_requires_admin_login(self):
        anonymous = Client()
        response = anonymous.get(STATS_URL)
        self.assertEqual(response.status_code, 302)
        self.assertIn('/manage/login/', response.url)

    def test_empty_stats_renders(self):
        response = self.client.get(STATS_URL)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.context_data['stats'], [])

    # ── 上报接口 ──────────────────────────────────────────

    def test_report_endpoint_returns_201(self):
        client = Client()
        payload = {
            'spot_id': 16,
            'dimension': 'architecture',
            'depth': 1,
            'request_params': {'current_depth': 0, 'max_seconds': 60},
            'fact_ids': [1],
            'output_text': '钟楼高56米。',
            'validation_passed': True,
            'fallback': False,
            'latency_ms': 6092,
        }
        response = client.post(
            LOG_URL, data=json.dumps(payload),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 201)
        log = NarrativeLog.objects.get()
        self.assertEqual(log.spot_id, 16)
        self.assertEqual(log.fact_ids, [1])
        self.assertEqual(log.latency_ms, 6092)

        # 上报后统计页应立即体现这次调用
        self.client.login(username='stats_admin', password='stats_pass_123')
        row = self._stats()[(16, 'architecture')]
        self.assertEqual(row['total'], 1)
        self.assertEqual(row['avg_latency'], 6092)
