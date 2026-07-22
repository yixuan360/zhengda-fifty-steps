"""
全局配置 — GlobalConfig + DevicePing 模型
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


class DevicePing(models.Model):
    """设备心跳 — 匿名统计日活设备数"""

    device_id = models.CharField('设备标识', max_length=64)
    app_version = models.CharField('App 版本', max_length=20, default='1.0.0')
    created_at = models.DateTimeField('首次访问', auto_now_add=True)

    class Meta:
        db_table = 'device_pings'
        verbose_name = '设备访问记录'
        verbose_name_plural = '设备访问记录'
        indexes = [
            models.Index(fields=['device_id']),
            models.Index(fields=['created_at']),
        ]

    def __str__(self):
        return f'{self.device_id} @ {self.created_at.strftime("%m-%d %H:%M")}'
