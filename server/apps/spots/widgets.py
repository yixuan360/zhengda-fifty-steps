"""
景点管理 — Admin 触发区域地图编辑器 Widget
- 高德 JS API 2.0 在地图上直接绘制/编辑 trigger 几何（圆形/走廊/多边形）
- textarea 保留为 JSON 同步目标，高级用户仍可直接改 JSON
"""
from django import forms
from django.conf import settings


class TriggerMapWidget(forms.Textarea):
    """trigger JSONField 的地图编辑器 Widget（模板内自带全部 JS/CSS）。"""

    template_name = 'admin/spots/trigger_map_widget.html'

    def get_context(self, name, value, attrs):
        context = super().get_context(name, value, attrs)
        # 高德 Web 端 key / 安全密钥注入模板；为空时模板显示提示横幅
        context['amap_web_key'] = getattr(settings, 'AMAP_WEB_KEY', '')
        context['amap_security_code'] = getattr(settings, 'AMAP_WEB_SECURITY_CODE', '')
        return context
