"""
景点管理 — Django Admin 注册（v4.0 §4.3 / §10.1）
- fieldsets 分组字段
- list_display 含图片/音频链接
- MIME 白名单校验
- mark_audio_ready 批量 action
"""
from django.contrib import admin, messages
from django.core.exceptions import ValidationError
from django.db.models import Q
from django.utils.html import format_html
from .models import Spot

# ── MIME 白名单 ──────────────────────────────────────────
ALLOWED_IMAGE_MIME = {'image/png', 'image/jpeg', 'image/webp'}
ALLOWED_AUDIO_MIME = {'audio/mpeg', 'audio/mp3', 'audio/wav'}

MIME_VALIDATION_ENABLED = True


def _validate_file_mime(file, allowed_mimes, label):
    """校验上传文件的 MIME 类型是否在白名单内。"""
    if not MIME_VALIDATION_ENABLED or not file:
        return
    mime = getattr(file, 'content_type', None)
    if mime and mime not in allowed_mimes:
        raise ValidationError(
            f'{label} 文件类型不支持：{mime}。允许的类型：{", ".join(sorted(allowed_mimes))}'
        )


@admin.register(Spot)
class SpotAdmin(admin.ModelAdmin):
    list_display = [
        'id', 'image_thumb', 'name', 'category', 'lat', 'lng',
        'trigger_radius', 'is_active', 'updated_at',
    ]
    list_display_links = ['id', 'name']
    list_filter = ['category', 'is_active']
    search_fields = ['name', 'summary', 'description']
    ordering = ['id']
    readonly_fields = ['created_at', 'updated_at']

    fieldsets = (
        ('基本信息', {
            'fields': ('name', 'category', 'lat', 'lng', 'trigger_radius'),
        }),
        ('内容', {
            'fields': ('summary', 'description'),
        }),
        ('媒体文件（V1 一图一音频）', {
            'fields': ('image', 'audio'),
            'description': '支持格式：图片 png/jpeg/webp，音频 mp3/wav',
        }),
        ('状态', {
            'fields': ('is_active', 'created_at', 'updated_at'),
        }),
    )

    # ── list_display 辅助方法 ─────────────────────────────

    @admin.display(description='图片')
    def image_thumb(self, obj):
        if obj.image and obj.image.name:
            return format_html(
                '<a href="{}" target="_blank">'
                '<img src="{}" style="width:60px;height:45px;object-fit:cover;border-radius:4px;" />'
                '</a>',
                obj.image.url, obj.image.url,
            )
        return format_html(
            '<span style="color:#999;font-size:11px;">暂无图片</span>'
        )

    # ── 文件保存 MIME 校验 ───────────────────────────────

    def save_model(self, request, obj, form, change):
        """保存前校验上传文件的 MIME 类型。"""
        if 'image' in form.changed_data and obj.image:
            _validate_file_mime(obj.image, ALLOWED_IMAGE_MIME, '图片')
        if 'audio' in form.changed_data and obj.audio:
            _validate_file_mime(obj.audio, ALLOWED_AUDIO_MIME, '音频')
        super().save_model(request, obj, form, change)

    # ── Admin Actions ─────────────────────────────────────

    @admin.action(description='标记为音频就绪')
    def mark_audio_ready(self, request, queryset):
        """
        批量标记景点音频为就绪状态。
        V1 中通过 is_active 字段间接实现——有音频的景点标记为启用。
        """
        # 🟡#3: 用 Q 对象同时判空和判 null，比 audio='' 更健壮
        has_audio = ~Q(audio='') & ~Q(audio__isnull=True)
        updated = queryset.filter(has_audio).update(is_active=True)
        no_audio = queryset.exclude(has_audio).count()
        if updated:
            self.message_user(
                request,
                f'已将 {updated} 个景点标记为启用（音频就绪）。',
                messages.SUCCESS,
            )
        if no_audio:
            self.message_user(
                request,
                f'{no_audio} 个景点尚无音频文件，未做变更。',
                messages.WARNING,
            )

    actions = ['mark_audio_ready']
