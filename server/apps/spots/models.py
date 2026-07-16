"""
景点管理 — Spot 模型（v4.0 §8.1 / §4.3 / §10.1）
V1 单表设计：image / audio 直接存表中，通过 ImageField/FileField 支持 Admin 上传。
"""
import uuid
from django.db import models


def _spot_upload_path(instance, filename, folder):
    """生成上传路径：media/<folder>/<spot_id>_<timestamp>_<uuid>.<ext>"""
    import time
    ext = filename.split('.')[-1] if '.' in filename else 'bin'
    uid = uuid.uuid4().hex[:6]
    return f'{folder}/{instance.id}_{int(time.time())}_{uid}.{ext}'


def image_upload_path(instance, filename):
    return _spot_upload_path(instance, filename, 'images')


def audio_upload_path(instance, filename):
    return _spot_upload_path(instance, filename, 'audio')


class Spot(models.Model):
    """景点模型 — 一景点一图一音频"""

    name = models.CharField('景点名称', max_length=100)
    lat = models.FloatField('纬度（GCJ-02）')
    lng = models.FloatField('经度（GCJ-02）')
    trigger_radius = models.IntegerField('触发半径（米）', default=50)
    summary = models.TextField('摘要', blank=True, default='')
    description = models.TextField('详细介绍')
    image = models.ImageField('景点图片', upload_to=image_upload_path, max_length=500, blank=True)
    audio = models.FileField('音频文件', upload_to=audio_upload_path, max_length=500, blank=True)
    is_active = models.BooleanField('启用', default=True)
    created_at = models.DateTimeField('创建时间', auto_now_add=True)
    updated_at = models.DateTimeField('更新时间', auto_now=True)

    class Meta:
        db_table = 'spots'
        ordering = ['id']
        verbose_name = '景点'
        verbose_name_plural = '景点'

    def __str__(self):
        return self.name

    @property
    def image_url(self):
        """返回图片相对 URL，用于 API 序列化"""
        return self.image.url if self.image else ''

    @property
    def audio_url(self):
        """返回音频相对 URL，用于 API 序列化"""
        return self.audio.url if self.audio else ''
