"""
景点管理 — Django Admin 注册（v4.0 §4.3 / §10.1）
- fieldsets 分组字段
- list_display 含图片/音频链接
- MIME 白名单校验
- mark_audio_ready / 批量启用 / 批量禁用 action
- trigger 字段使用高德地图可视化编辑器（TriggerMapWidget）
- 编辑页支持“保存并编辑下一个”（_savenext）
"""
from django.contrib import admin, messages
from django.core.exceptions import ValidationError
from django.db.models import Q
from django.http import HttpResponseRedirect
from django.urls import reverse
from django.utils.html import format_html
from django import forms
from .models import Spot
from .widgets import TriggerMapWidget
from .trigger_validation import validate_trigger
from apps.config.models import Category

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


class SpotAdminForm(forms.ModelForm):
    """Spot 后台表单：trigger 换成地图编辑器，提交时做结构校验兜底。"""

    class Meta:
        model = Spot
        fields = '__all__'
        widgets = {'trigger': TriggerMapWidget}

    def clean_trigger(self):
        # 规则与写 API（views.validate_trigger）一致，共用同一函数避免漂移
        value = self.cleaned_data.get('trigger')
        if not validate_trigger(value):
            raise forms.ValidationError(
                '触发区域结构无效：type 仅支持 circle/corridor/polygon；'
                '走廊至少 2 个顶点、多边形至少 3 个顶点，'
                '顶点须为 {"lat","lng"} 且为有限数，halfWidth 须为正数。'
            )
        return value


@admin.register(Spot)
class SpotAdmin(admin.ModelAdmin):
    form = SpotAdminForm
    list_display = [
        'id', 'image_thumb', 'name', 'category', 'lat', 'lng',
        'trigger_radius', 'audio_link', 'is_active', 'updated_at',
    ]
    list_display_links = ['id', 'name']
    list_editable = ['is_active']  # 列表页直接勾选启用/禁用，不必进编辑页
    list_filter = ['category', 'is_active']
    search_fields = ['name', 'summary', 'description']
    ordering = ['id']
    readonly_fields = ['created_at', 'updated_at']
    save_on_top = True   # 长表单顶部也放保存按钮，不用滑到底
    list_per_page = 200  # 大于现有景点数，一页显示全部，不出现分页/“显示全部”

    def get_form(self, request, obj=None, **kwargs):
        form = super().get_form(request, obj, **kwargs)
        cats = Category.objects.all().order_by('sort_order')
        choices = [(c.key, c.label) for c in cats] or [('architecture', '默认')]
        if obj and obj.category:
            seen = {k for k, _ in choices}
            if obj.category not in seen:
                choices.insert(0, (obj.category, f'{obj.category}（已删除）'))
        form.base_fields['category'] = forms.ChoiceField(
            label='分类', choices=choices, initial='architecture',
        )
        return form

    fieldsets = (
        ('基本信息', {
            'fields': ('name', 'category', 'lat', 'lng', 'trigger_radius'),
        }),
        ('触发区域（v4.1 几何）', {
            'fields': ('trigger',),
            'description': '在下方地图上直接绘制触发区域；留空 = 圆形（用上方 trigger_radius）。'
                           '走廊/多边形顶点为 GCJ-02 坐标。',
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
                '<a href="{}" target="_blank" rel="noopener noreferrer">'
                '<img src="{}" style="width:60px;height:45px;object-fit:cover;border-radius:4px;" />'
                '</a>',
                obj.image.url, obj.image.url,
            )
        return format_html(
            '<span style="color:#999;font-size:11px;">暂无图片</span>'
        )

    @admin.display(description='音频')
    def audio_link(self, obj):
        if obj.audio and obj.audio.name:
            return format_html(
                '<a href="{}" target="_blank" rel="noopener noreferrer">试听</a>',
                obj.audio.url,
            )
        return '—'

    # ── 文件保存 MIME 校验 ───────────────────────────────

    def save_model(self, request, obj, form, change):
        """保存前校验上传文件的 MIME 类型。"""
        if 'image' in form.changed_data and obj.image:
            _validate_file_mime(obj.image, ALLOWED_IMAGE_MIME, '图片')
        if 'audio' in form.changed_data and obj.audio:
            _validate_file_mime(obj.audio, ALLOWED_AUDIO_MIME, '音频')
        super().save_model(request, obj, form, change)

    # ── 保存并编辑下一个 ─────────────────────────────────
    # 配合 templates/admin/spots/spot/submit_line.html 的 _savenext 按钮

    def response_change(self, request, obj):
        if '_savenext' in request.POST:
            # 先走默认流程（产生“修改成功”消息），再把跳转目标换成下一个景点
            response = super().response_change(request, obj)
            next_spot = Spot.objects.filter(id__gt=obj.id).order_by('id').first()
            if next_spot is not None:
                url = reverse(
                    f'admin:{self.opts.app_label}_{self.opts.model_name}_change',
                    args=[next_spot.pk],
                )
                return HttpResponseRedirect(url + self.get_preserved_filters(request))
            # 已是最后一个 → 回列表页
            return response
        return super().response_change(request, obj)

    # ── Admin Actions ─────────────────────────────────────

    @admin.action(description='批量启用所选景点')
    def enable_spots(self, request, queryset):
        updated = queryset.update(is_active=True)
        self.message_user(request, f'已启用 {updated} 个景点。', messages.SUCCESS)

    @admin.action(description='批量禁用所选景点')
    def disable_spots(self, request, queryset):
        updated = queryset.update(is_active=False)
        self.message_user(request, f'已禁用 {updated} 个景点。', messages.SUCCESS)

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

    actions = ['enable_spots', 'disable_spots', 'mark_audio_ready']
