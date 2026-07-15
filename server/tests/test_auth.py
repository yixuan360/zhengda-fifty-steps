"""
Mock 认证接口测试（v4.0 §9.3 / §7.2 #4）
测试 /login/mock 返回固定 JWT + Token 刷新逻辑。
"""
import time
from django.test import TestCase, Client


class MockLoginTest(TestCase):
    """POST /api/v1/auth/login/mock/ 接口测试"""

    def setUp(self):
        self.client = Client()

    def test_mock_login_returns_jwt(self):
        """Mock 登录应返回 access + refresh JWT 及用户信息"""
        response = self.client.post(
            '/api/v1/auth/login/mock/',
            content_type='application/json',
        )
        assert response.status_code == 200

        body = response.json()
        assert body['ok'] is True
        assert len(body['data']['access']) > 0
        assert len(body['data']['refresh']) > 0
        assert body['data']['user']['username'] == 'mock_user'
        assert body['data']['user']['nickname'] == '测试用户'

    def test_mock_login_idempotent(self):
        """多次 Mock 登录应返回同一个用户（不会重复创建）"""
        resp1 = self.client.post(
            '/api/v1/auth/login/mock/',
            content_type='application/json',
        )
        resp2 = self.client.post(
            '/api/v1/auth/login/mock/',
            content_type='application/json',
        )

        user1 = resp1.json()['data']['user']
        user2 = resp2.json()['data']['user']
        assert user1['id'] == user2['id']
        assert user1['username'] == user2['username']


class TokenRefreshTest(TestCase):
    """POST /api/v1/auth/refresh/ 接口测试"""

    def setUp(self):
        self.client = Client()

    def _get_tokens(self):
        """通过 Mock 登录获取 token 对"""
        resp = self.client.post(
            '/api/v1/auth/login/mock/',
            content_type='application/json',
        )
        return resp.json()['data']

    def test_refresh_returns_new_access_token(self):
        """有效 refresh token 应返回新的 access token"""
        tokens = self._get_tokens()

        # JWT iat 精度是秒，同秒内签发的新 token 可能与旧 token 完全一致。
        # 等待 > 1s + 最多重试一次，消除 CI 偶发失败。
        time.sleep(1.1)

        response = self.client.post(
            '/api/v1/auth/refresh/',
            {'refresh': tokens['refresh']},
            content_type='application/json',
        )
        assert response.status_code == 200

        body = response.json()
        assert body['ok'] is True
        assert len(body['data']['access']) > 0

        if body['data']['access'] == tokens['access']:
            # 极低概率：同秒签发导致完全相同，sleep 再次重试
            time.sleep(1.5)
            response = self.client.post(
                '/api/v1/auth/refresh/',
                {'refresh': tokens['refresh']},
                content_type='application/json',
            )
            body = response.json()

        assert body['data']['access'] != tokens['access']

    def test_invalid_refresh_token_returns_401(self):
        """无效 refresh token 应返回 401"""
        response = self.client.post(
            '/api/v1/auth/refresh/',
            {'refresh': 'this-is-not-a-valid-token'},
            content_type='application/json',
        )
        assert response.status_code == 401
        assert response.json()['ok'] is False

    def test_missing_refresh_token_returns_400(self):
        """缺少 refresh 参数应返回 400"""
        response = self.client.post(
            '/api/v1/auth/refresh/',
            {},
            content_type='application/json',
        )
        assert response.status_code == 400
        assert response.json()['ok'] is False
