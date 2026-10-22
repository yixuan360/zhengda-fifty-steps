"""文脉叙事引擎 — DRF 序列化器"""
from rest_framework import serializers

from .models import KnowledgeItem, NarrativeLog

VALID_DIMENSIONS = {key for key, _ in KnowledgeItem.DIMENSIONS}


class DimensionQuerySerializer(serializers.Serializer):
    """GET /api/v2/narrative/dimensions/ 的查询参数。"""

    spot_id = serializers.IntegerField(min_value=1)


class NarrativeLogSerializer(serializers.ModelSerializer):
    """T5 记账接口：body 为 NarrativeLog 字段子集，created_at 由服务器补。"""

    spot_id = serializers.IntegerField()
    dimension = serializers.CharField(max_length=20, allow_blank=False)
    depth = serializers.IntegerField(
        required=False, default=0, min_value=0, max_value=5,
    )
    request_params = serializers.DictField(required=False, default=dict)
    fact_ids = serializers.ListField(
        child=serializers.IntegerField(), required=False, default=list,
    )
    output_text = serializers.CharField(
        required=False, allow_blank=True, default='',
    )
    validation_passed = serializers.BooleanField(required=False, default=False)
    fallback = serializers.BooleanField(required=False, default=False)
    latency_ms = serializers.IntegerField(
        required=False, default=0, min_value=0,
    )

    class Meta:
        model = NarrativeLog
        fields = [
            'spot_id', 'dimension', 'depth', 'request_params', 'fact_ids',
            'output_text', 'validation_passed', 'fallback', 'latency_ms',
        ]

    def validate_dimension(self, value):
        if value not in VALID_DIMENSIONS:
            raise serializers.ValidationError(
                'dimension 必须是 nature/architecture/academy/history 之一'
            )
        return value
