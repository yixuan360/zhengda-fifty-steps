"""
全局配置 — GlobalConfig 模型（v4.0 §8.1）
key-value 结构，value 使用 JSON 类型。
"""
from django.db import models


class GlobalConfig(models.Model):
    """全局配置 — key-json 存储"""

    key = models.CharField('配置键', max_length=100, primary_key=True)
    value = models.JSONField('配置值')
    updated_at = models.DateTimeField('更新时间', auto_now=True)

    class Meta:
        db_table = 'global_config'
        verbose_name = '全局配置'
        verbose_name_plural = '全局配置'

    def __str__(self):
        return self.key
