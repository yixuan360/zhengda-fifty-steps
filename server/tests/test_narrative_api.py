"""
文脉叙事引擎 T5 — 记账 API 测试
覆盖：201 写入 / 400 字段校验 / 429 限流。
"""
import json

from django.core.cache import cache
from django.test import Client, TestCase

from apps.narrative.models import NarrativeLog

LOG_URL = '/api/v2/narrative/log/'

FULL_PAYLOAD = {
    'spot_id': 16,
    'dimension': 'history',
    'depth': 2,
    'request_params': {'current_depth': 1, 'max_seconds': 60},
    'fact_ids': [101, 102],
    'output_text': '钟楼建于 1956 年。[k101]',
    'validation_passed': True,
    'fallback': False,
    'latency_ms': 1234,
}


class NarrativeLogApiTest(TestCase):

    def setUp(self):
        cache.clear()   # 隔离 DRF 限流计数

    def _post(self, payload, client=None):
        client = client or Client()
        return client.post(
            LOG_URL,
            data=json.dumps(payload),
            content_type='application/json',
        )

    # ── 201 ──────────────────────────────────────────────

    def test_create_log_returns_201(self):
        response = self._post(FULL_PAYLOAD)
        self.assertEqual(response.status_code, 201)
        self.assertTrue(response.json()['ok'])

        self.assertEqual(NarrativeLog.objects.count(), 1)
        log = NarrativeLog.objects.get()
        self.assertEqual(log.spot_id, 16)
        self.assertEqual(log.dimension, 'history')
        self.assertEqual(log.depth, 2)
        self.assertEqual(log.request_params, {'current_depth': 1, 'max_seconds': 60})
        self.assertEqual(log.fact_ids, [101, 102])
        self.assertEqual(log.output_text, '钟楼建于 1956 年。[k101]')
        self.assertTrue(log.validation_passed)
        self.assertFalse(log.fallback)
        self.assertEqual(log.latency_ms, 1234)
        self.assertIsNotNone(log.created_at)

    def test_minimal_payload_uses_model_defaults(self):
        """只有 spot_id + dimension 也合法，其余字段取默认值。"""
        response = self._post({'spot_id': 16, 'dimension': 'nature'})
        self.assertEqual(response.status_code, 201)

        log = NarrativeLog.objects.get()
        self.assertEqual(log.depth, 0)
        self.assertEqual(log.request_params, {})
        self.assertEqual(log.fact_ids, [])
        self.assertEqual(log.output_text, '')
        self.assertFalse(log.validation_passed)
        self.assertFalse(log.fallback)
        self.assertEqual(log.latency_ms, 0)

    # ── 400 ──────────────────────────────────────────────

    def test_missing_spot_id_returns_400(self):
        payload = dict(FULL_PAYLOAD)
        payload.pop('spot_id')
        self.assertEqual(self._post(payload).status_code, 400)
        self.assertEqual(NarrativeLog.objects.count(), 0)

    def test_missing_dimension_returns_400(self):
        payload = dict(FULL_PAYLOAD)
        payload.pop('dimension')
        self.assertEqual(self._post(payload).status_code, 400)
        self.assertEqual(NarrativeLog.objects.count(), 0)

    def test_invalid_field_types_return_400(self):
        cases = [
            {'spot_id': 'abc', 'dimension': 'history'},
            {'spot_id': 16, 'dimension': 'history', 'depth': 9},
            {'spot_id': 16, 'dimension': 'history', 'fact_ids': 'not-a-list'},
            {'spot_id': 16, 'dimension': 'unknown-dimension'},
        ]
        for payload in cases:
            with self.subTest(payload=payload):
                self.assertEqual(self._post(payload).status_code, 400)
        self.assertEqual(NarrativeLog.objects.count(), 0)

    # ── 429 ──────────────────────────────────────────────

    def test_rate_limit_returns_429(self):
        client = Client()
        payload = {'spot_id': 16, 'dimension': 'history'}

        for index in range(30):
            response = self._post(payload, client=client)
            self.assertEqual(
                response.status_code, 201, msg=f'第 {index + 1} 次请求',
            )

        response = self._post(payload, client=client)
        self.assertEqual(response.status_code, 429)
        self.assertFalse(response.json()['ok'])
        self.assertEqual(NarrativeLog.objects.count(), 30)
