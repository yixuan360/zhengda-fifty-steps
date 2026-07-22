"""
全局配置 + 设备统计 — Django Admin 注册
"""
from datetime import date, timedelta
from django.contrib import admin
from django.utils.html import format_html
from .models import GlobalConfig, DevicePing


@admin.register(GlobalConfig)
class GlobalConfigAdmin(admin.ModelAdmin):
    list_display = ['key', 'value_summary', 'updated_at']
    search_fields = ['key']

    @admin.display(description='配置值')
    def value_summary(self, obj):
        val = str(obj.value)
        return val[:80] + ('...' if len(val) > 80 else '')


@admin.register(DevicePing)
class DevicePingAdmin(admin.ModelAdmin):
    list_display = ['device_id', 'app_version', 'created_at']
    list_filter = ['app_version', 'created_at']
    search_fields = ['device_id']
    ordering = ['-created_at']
    date_hierarchy = 'created_at'

    def has_add_permission(self, request):
        return False

    def changelist_view(self, request, extra_context=None):
        extra_context = extra_context or {}
        today = date.today()
        extra_context['today_count'] = DevicePing.objects.filter(
            created_at__date=today,
        ).values('device_id').distinct().count()
        extra_context['week_count'] = DevicePing.objects.filter(
            created_at__date__gte=today - timedelta(days=7),
        ).values('device_id').distinct().count()
        extra_context['total_count'] = DevicePing.objects.values('device_id').distinct().count()
        extra_context['today'] = today
        return super().changelist_view(request, extra_context=extra_context)
