"""
景点管理 — Serializer（snake_case → camelCase 转换）
"""
from rest_framework import serializers
from .models import Spot


class SpotSerializer(serializers.ModelSerializer):
    """景点序列化器，输出 camelCase 字段（v4.0 §7.2）"""

    class Meta:
        model = Spot
        fields = '__all__'

    def to_representation(self, instance):
        return {
            'id': instance.id,
            'name': instance.name,
            'lat': instance.lat,
            'lng': instance.lng,
            'triggerRadius': instance.trigger_radius,
            'summary': instance.summary,
            'description': instance.description,
            'imageUrl': instance.image_url,
            'audioUrl': instance.audio_url,
            'isActive': instance.is_active,
            'updatedAt': int(instance.updated_at.timestamp() * 1000) if instance.updated_at else None,
        }
