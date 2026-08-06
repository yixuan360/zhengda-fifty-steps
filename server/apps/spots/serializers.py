"""
景点管理 — Serializer（snake_case → camelCase 转换）
"""
from rest_framework import serializers
from .models import Spot


class SpotSerializer(serializers.ModelSerializer):
    """景点序列化器，输出 camelCase 字段（v4.0 §7.2）"""

    class Meta:
        model = Spot
        # to_representation 已整体覆盖输出；声明 fields 满足 DRF 断言，
        # 避免 BrowsableAPI 等路径访问 serializer.fields 时抛异常
        fields = '__all__'

    def to_representation(self, instance):
        request = self.context.get('request')
        image_url = instance.image_url or ''
        audio_url = instance.audio_url or ''

        # 🟡#1: FileField.url 是相对路径，客户端需要完整 URL
        if image_url and request:
            image_url = request.build_absolute_uri(image_url)
        if audio_url and request:
            audio_url = request.build_absolute_uri(audio_url)

        return {
            'id': instance.id,
            'name': instance.name,
            'lat': instance.lat,
            'lng': instance.lng,
            'triggerRadius': instance.trigger_radius,
            'trigger': instance.trigger or None,  # v4.1 触发几何，None = 圆形
            'summary': instance.summary,
            'description': instance.description,
            'imageUrl': image_url,
            'audioUrl': audio_url,
            'category': instance.category or 'architecture',
            'isActive': instance.is_active,
            'updatedAt': int(instance.updated_at.timestamp() * 1000) if instance.updated_at else None,
        }
