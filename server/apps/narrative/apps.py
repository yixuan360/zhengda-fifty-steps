"""文脉叙事引擎 — 应用配置"""
from django.apps import AppConfig


class NarrativeConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.narrative'
    verbose_name = '文脉叙事'
