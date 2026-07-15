"""
pytest 配置 — Django 测试基础设施（v4.0 §12）
"""
import os


def pytest_configure():
    """设置 Django 环境变量，由 pytest-django 接管后续初始化。"""
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')

    # 标记测试环境，MockLoginView 据此豁免 DEBUG 守卫
    from django.conf import settings
    settings.TESTING = True
