"""
全局配置 — Django Admin 注册
"""
from django.contrib import admin
from .models import GlobalConfig


@admin.register(GlobalConfig)
class GlobalConfigAdmin(admin.ModelAdmin):
    list_display = ['key', 'updated_at']
    search_fields = ['key']
