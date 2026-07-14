"""
用户认证 — User 模型（v4.0 §9.1）
扩展 AbstractUser，添加微信登录字段。
"""
from django.contrib.auth.models import AbstractUser
from django.db import models


class User(AbstractUser):
    """扩展用户模型：openid / unionid / nickname / avatar_url"""

    openid = models.CharField('微信 OpenID', max_length=128, unique=True, blank=True, null=True)
    unionid = models.CharField('微信 UnionID', max_length=128, blank=True, null=True)
    nickname = models.CharField('昵称', max_length=100, blank=True, default='')
    avatar_url = models.CharField('头像 URL', max_length=500, blank=True, default='')

    class Meta:
        db_table = 'auth_user'
        verbose_name = '用户'
        verbose_name_plural = '用户'

    def __str__(self):
        return self.nickname or self.username
