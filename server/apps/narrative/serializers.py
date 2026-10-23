"""文脉叙事引擎 — DRF 序列化器"""
from rest_framework import serializers

from .models import DeepContent, DeepContentLog, KnowledgeItem, NarrativeLog

VALID_DIMENSIONS = {key for key, _ in KnowledgeItem.DIMENSIONS}
VALID_CATEGORIES = {key for key, _ in DeepContent.CATEGORIES}


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


class SpotQuerySerializer(serializers.Serializer):
    """GET /api/v2/narrative/categories/ 的查询参数。"""

    spot_id = serializers.IntegerField(min_value=1)


class DeepContentQuerySerializer(serializers.Serializer):
    """GET /api/v2/narrative/deep/ 的查询参数。"""

    spot_id = serializers.IntegerField(min_value=1)
    category = serializers.ChoiceField(choices=list(VALID_CATEGORIES))


class DeepContentSerializer(serializers.ModelSerializer):
    """对外只暴露已审深度稿的阅读字段。"""

    audio_url = serializers.SerializerMethodField()

    class Meta:
        model = DeepContent
        fields = [
            'id', 'spot_id', 'category', 'title', 'body',
            'sources', 'fact_notes', 'audio_url', 'version', 'updated_at',
        ]

    def get_audio_url(self, obj):
        return obj.audio_path or None


class DeepContentLogSerializer(serializers.ModelSerializer):
    """V2 记账：content_id 可选，事件只允许 view/play/complete/fallback。"""

    content_id = serializers.IntegerField(required=False, allow_null=True)
    category = serializers.CharField(max_length=20, required=False, allow_blank=True)
    latency_ms = serializers.IntegerField(required=False, default=0, min_value=0)

    class Meta:
        model = DeepContentLog
        fields = ['spot_id', 'content_id', 'category', 'event', 'latency_ms']

    def validate_category(self, value):
        if value and value not in VALID_CATEGORIES:
            raise serializers.ValidationError(
                'category 必须是 architecture/history/academy/nature/activity 之一'
            )
        return value

    def create(self, validated_data):
        content_id = validated_data.pop('content_id', None)
        content = None
        if content_id:
            content = DeepContent.objects.filter(id=content_id).first()
        return DeepContentLog.objects.create(content=content, **validated_data)
