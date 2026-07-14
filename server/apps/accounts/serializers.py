"""
用户认证 — Serializer
"""
from rest_framework import serializers
from .models import User


class WechatLoginSerializer(serializers.Serializer):
    """微信登录请求"""
    code = serializers.CharField(required=True, max_length=256)


class UserSerializer(serializers.ModelSerializer):
    """用户信息输出（camelCase）"""

    class Meta:
        model = User
        fields = ['id', 'username', 'nickname', 'avatar_url']

    def to_representation(self, instance):
        return {
            'id': instance.id,
            'username': instance.username,
            'nickname': instance.nickname or instance.username,
            'avatarUrl': instance.avatar_url or '',
        }
