"""
景点管理 — Django Admin 注册（v4.0 §4.3）
"""
from django.contrib import admin
from .models import Spot


@admin.register(Spot)
class SpotAdmin(admin.ModelAdmin):
    list_display = ['id', 'name', 'lat', 'lng', 'trigger_radius', 'is_active', 'updated_at']
    list_filter = ['is_active']
    search_fields = ['name']
    ordering = ['id']
    readonly_fields = ['created_at', 'updated_at']
    fieldsets = (
        ('基本信息', {'fields': ('name', 'lat', 'lng', 'trigger_radius')}),
        ('内容', {'fields': ('summary', 'description')}),
        ('媒体文件', {'fields': ('image', 'audio')}),
        ('状态', {'fields': ('is_active', 'created_at', 'updated_at')}),
    )
