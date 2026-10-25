"""
文脉叙事引擎 — Admin 人审队列

- KnowledgeItem：按 status / dimension / depth / spot 过滤，批量采纳/驳回并写 ReviewTask
- ReviewTask：只读人审留痕
- NarrativeLog：只读生成日志，供人工观察 fallback / 校验 / 延迟
"""
from datetime import timedelta

from django.contrib import admin, messages
from django.db import transaction
from django.db.models import Avg, Count, Q
from django.template.response import TemplateResponse
from django.urls import path
from django.utils import timezone

from .models import (
    DeepContent,
    DeepContentLog,
    KnowledgeItem,
    NarrativeLog,
    ReviewTask,
    Route,
    RouteLog,
    RouteNarrative,
    RouteStop,
)


class ReviewTaskInline(admin.TabularInline):
    """事实卡片详情页内联展示人审历史（只读）。"""

    model = ReviewTask
    extra = 0
    fields = ['decision', 'reviewer_note', 'created_at']
    readonly_fields = fields
    can_delete = False

    def has_add_permission(self, request, obj=None):
        return False


@admin.register(KnowledgeItem)
class KnowledgeItemAdmin(admin.ModelAdmin):
    list_display = [
        'id', 'spot', 'dimension', 'depth', 'short_fact',
        'confidence', 'status', 'version', 'created_by', 'updated_at',
    ]
    list_display_links = ['id', 'short_fact']
    list_filter = ['status', 'dimension', 'depth', 'spot']
    search_fields = ['fact_text']
    ordering = ['spot_id', 'dimension', 'depth']
    readonly_fields = ['created_at', 'updated_at']
    inlines = [ReviewTaskInline]
    actions = ['approve_selected', 'reject_selected']

    @admin.display(description='事实陈述')
    def short_fact(self, obj):
        text = obj.fact_text
        return text if len(text) <= 50 else f'{text[:50]}…'

    def has_delete_permission(self, request, obj=None):
        """禁止物理删除：下架统一走状态改为 rejected，由 publish_vector 清理向量。"""
        return False

    # ── Admin Actions ─────────────────────────────────────

    @admin.action(description='批量采纳所选事实卡片（待人审 → 已发布）')
    def approve_selected(self, request, queryset):
        self._review_pending(request, queryset, decision='approve')

    @admin.action(description='批量驳回所选事实卡片（待人审 → 已驳回）')
    def reject_selected(self, request, queryset):
        self._review_pending(request, queryset, decision='reject')

    def _review_pending(self, request, queryset, decision):
        """只处理 pending 项：状态流转 + 逐条写 ReviewTask。"""
        total = queryset.count()
        pending = list(queryset.filter(status='pending'))
        with transaction.atomic():
            for item in pending:
                item.status = 'approved' if decision == 'approve' else 'rejected'
                item.save(update_fields=['status', 'updated_at'])
                ReviewTask.objects.create(item=item, decision=decision)

        done = len(pending)
        action_label = '采纳' if decision == 'approve' else '驳回'
        if done:
            self.message_user(
                request, f'已{action_label} {done} 张事实卡片。', messages.SUCCESS,
            )
        skipped = total - done
        if skipped:
            self.message_user(
                request,
                f'{skipped} 张卡片不是“待人审”状态，已跳过。',
                messages.WARNING,
            )


@admin.register(ReviewTask)
class ReviewTaskAdmin(admin.ModelAdmin):
    list_display = ['id', 'item', 'decision', 'reviewer_note', 'created_at']
    list_filter = ['decision']
    search_fields = ['item__fact_text', 'reviewer_note']
    ordering = ['-created_at']
    readonly_fields = ['item', 'decision', 'reviewer_note', 'created_at']

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(NarrativeLog)
class NarrativeLogAdmin(admin.ModelAdmin):
    change_list_template = 'admin/narrative/narrative_log_change_list.html'
    list_display = [
        'id', 'spot_id', 'dimension', 'depth', 'fallback',
        'validation_passed', 'latency_ms', 'created_at',
    ]
    list_filter = ['fallback', 'validation_passed', 'dimension']
    search_fields = ['spot_id', 'output_text']
    ordering = ['-created_at']
    readonly_fields = [
        'spot_id', 'dimension', 'depth', 'request_params', 'fact_ids',
        'output_text', 'validation_passed', 'fallback', 'latency_ms',
        'created_at',
    ]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

    # ── 只读统计页（T7）──────────────────────────────────

    def get_urls(self):
        urls = super().get_urls()
        custom = [
            path(
                'stats/',
                self.admin_site.admin_view(self.stats_view),
                name='narrative_narrativelog_stats',
            ),
        ]
        return custom + urls

    def stats_view(self, request):
        """按 spot / dimension 聚合生成次数、fallback 率、平均延迟与近 7 天趋势。"""
        since = timezone.now() - timedelta(days=7)

        rows = (
            NarrativeLog.objects
            .values('spot_id', 'dimension')
            .annotate(
                total=Count('id'),
                fallbacks=Count('id', filter=Q(fallback=True)),
                avg_latency=Avg('latency_ms'),
                recent_total=Count('id', filter=Q(created_at__gte=since)),
                recent_fallbacks=Count(
                    'id', filter=Q(created_at__gte=since, fallback=True),
                ),
            )
            .order_by('spot_id', 'dimension')
        )

        stats = []
        for row in rows:
            total = row['total'] or 0
            stats.append({
                **row,
                'fallback_rate': row['fallbacks'] / total * 100 if total else 0,
                'avg_latency': row['avg_latency'] or 0,
            })

        context = {
            **self.admin_site.each_context(request),
            'title': '叙事生成统计',
            'opts': self.model._meta,
            'stats': stats,
            'since': since,
        }
        return TemplateResponse(
            request, 'admin/narrative/narrative_stats.html', context,
        )


@admin.register(DeepContent)
class DeepContentAdmin(admin.ModelAdmin):
    """V2 深度稿人审队列：草稿/待人审 → 已发布/已驳回。"""

    list_display = [
        'id', 'spot', 'category', 'title', 'status', 'version',
        'has_audio', 'reviewed_by', 'updated_at',
    ]
    list_display_links = ['id', 'title']
    list_filter = ['status', 'category', 'spot']
    search_fields = ['title', 'body']
    ordering = ['spot_id', 'category']
    readonly_fields = [
        'version', 'audio_path', 'reviewed_by', 'created_at', 'updated_at',
    ]
    actions = ['approve_selected', 'reject_selected']

    @admin.display(boolean=True, description='有音频')
    def has_audio(self, obj):
        return bool(obj.audio_path)

    def has_delete_permission(self, request, obj=None):
        """下架走 rejected，保留审稿痕迹。"""
        return False

    def save_model(self, request, obj, form, change):
        """人审改正文/音频稿时，旧音频立即失效并升版本。"""
        if change and any(
            field in form.changed_data for field in ('body', 'audio_script')
        ):
            obj.version += 1
            obj.audio_path = ''
        super().save_model(request, obj, form, change)

    def _review(self, request, queryset, decision):
        pending = list(queryset.filter(status='pending'))
        reviewer = request.user.get_username()
        with transaction.atomic():
            for content in pending:
                content.status = 'approved' if decision == 'approve' else 'rejected'
                content.reviewed_by = reviewer
                content.save(update_fields=['status', 'reviewed_by', 'updated_at'])
        label = '采纳' if decision == 'approve' else '驳回'
        self.message_user(
            request, f'已{label} {len(pending)} 篇深度稿。', messages.SUCCESS,
        )
        skipped = queryset.count() - len(pending)
        if skipped:
            self.message_user(
                request, f'{skipped} 篇不是“待人审”状态，已跳过。',
                messages.WARNING,
            )

    @admin.action(description='批量采纳深度稿（待人审 → 已发布）')
    def approve_selected(self, request, queryset):
        self._review(request, queryset, 'approve')

    @admin.action(description='批量驳回深度稿（待人审 → 已驳回）')
    def reject_selected(self, request, queryset):
        self._review(request, queryset, 'reject')


@admin.register(DeepContentLog)
class DeepContentLogAdmin(admin.ModelAdmin):
    """V2 深度稿事件日志（只读）。"""

    list_display = [
        'id', 'spot_id', 'category', 'event', 'content', 'latency_ms',
        'created_at',
    ]
    list_filter = ['event', 'category']
    search_fields = ['spot_id', 'content__title']
    ordering = ['-created_at']
    readonly_fields = [
        'spot_id', 'content', 'category', 'event', 'latency_ms', 'created_at',
    ]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


class RouteStopInline(admin.TabularInline):
    """站点由 load_routes 导入，Admin 只读，避免绕过路线审核。"""

    model = RouteStop
    extra = 0
    fields = [
        'order', 'spot', 'category', 'duration_seconds',
        'optional', 'indoor', 'note',
    ]
    readonly_fields = fields
    ordering = ['order']
    raw_id_fields = ['spot']
    can_delete = False

    def has_add_permission(self, request, obj=None):
        return False


@admin.register(Route)
class RouteAdmin(admin.ModelAdmin):
    """V3 路线人审：路线元数据 + 站点内联。"""

    list_display = [
        'id', 'code', 'name', 'theme', 'total_minutes', 'walking_km',
        'stops_count', 'status', 'version', 'updated_at',
    ]
    list_display_links = ['id', 'code', 'name']
    list_filter = ['status', 'theme']
    search_fields = ['code', 'name', 'subtitle']
    ordering = ['code']
    inlines = [RouteStopInline]
    readonly_fields = ['version', 'reviewed_by', 'created_at', 'updated_at']
    actions = ['approve_selected', 'reject_selected']

    def get_queryset(self, request):
        return (
            super().get_queryset(request)
            .annotate(stops_count_annotated=Count('stops'))
        )

    @admin.display(description='站点数', ordering='stops_count_annotated')
    def stops_count(self, obj):
        return getattr(obj, 'stops_count_annotated', obj.stops.count())

    def has_delete_permission(self, request, obj=None):
        return False

    def _review(self, request, queryset, decision):
        pending = list(queryset.filter(status='pending'))
        reviewer = request.user.get_username()
        narrative_status = 'approved' if decision == 'approve' else 'rejected'
        with transaction.atomic():
            for route in pending:
                route.status = narrative_status
                route.reviewed_by = reviewer
                route.save(update_fields=['status', 'reviewed_by', 'updated_at'])
                route.narratives.filter(status='pending').update(
                    status=narrative_status, reviewed_by=reviewer,
                )
        label = '采纳' if decision == 'approve' else '驳回'
        self.message_user(
            request, f'已{label} {len(pending)} 条路线。', messages.SUCCESS,
        )
        skipped = queryset.count() - len(pending)
        if skipped:
            self.message_user(
                request, f'{skipped} 条不是“待人审”状态，已跳过。',
                messages.WARNING,
            )

    @admin.action(description='批量采纳路线（待人审 → 已发布）')
    def approve_selected(self, request, queryset):
        self._review(request, queryset, 'approve')

    @admin.action(description='批量驳回路线（待人审 → 已驳回）')
    def reject_selected(self, request, queryset):
        self._review(request, queryset, 'reject')


@admin.register(RouteStop)
class RouteStopAdmin(admin.ModelAdmin):
    """路线站点只读；修改走 load_routes 导入，保持可审计。"""

    list_display = [
        'id', 'route', 'order', 'spot', 'category',
        'duration_seconds', 'optional', 'indoor',
    ]
    list_filter = ['route', 'optional', 'indoor', 'category']
    search_fields = ['route__code', 'spot__name']
    ordering = ['route', 'order']
    raw_id_fields = ['spot']
    readonly_fields = [
        'route', 'order', 'spot', 'category', 'duration_seconds',
        'optional', 'indoor', 'note',
    ]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(RouteNarrative)
class RouteNarrativeAdmin(admin.ModelAdmin):
    """V3 路线文案人审：开场/过渡/收尾。"""

    list_display = [
        'id', 'route', 'key', 'kind', 'from_order', 'to_order',
        'status', 'version', 'has_audio', 'updated_at',
    ]
    list_display_links = ['id', 'key']
    list_filter = ['status', 'kind', 'route']
    search_fields = ['route__code', 'key', 'text']
    ordering = ['route', 'key']
    readonly_fields = [
        'version', 'audio_path', 'reviewed_by', 'created_at', 'updated_at',
    ]
    actions = ['approve_selected', 'reject_selected']

    @admin.display(boolean=True, description='有音频')
    def has_audio(self, obj):
        return bool(obj.audio_path)

    def has_delete_permission(self, request, obj=None):
        return False

    def save_model(self, request, obj, form, change):
        if change and any(
            field in form.changed_data for field in ('text', 'audio_script')
        ):
            obj.version += 1
            obj.audio_path = ''
            # 已发布文案被改动后回到待人审，不能带着旧审核直接上线。
            if obj.status == 'approved':
                obj.status = 'pending'
                obj.reviewed_by = ''
        super().save_model(request, obj, form, change)

    def _review(self, request, queryset, decision):
        pending = list(queryset.filter(status='pending'))
        reviewer = request.user.get_username()
        with transaction.atomic():
            for narrative in pending:
                narrative.status = 'approved' if decision == 'approve' else 'rejected'
                narrative.reviewed_by = reviewer
                narrative.save(update_fields=[
                    'status', 'reviewed_by', 'updated_at',
                ])
        label = '采纳' if decision == 'approve' else '驳回'
        self.message_user(
            request, f'已{label} {len(pending)} 条路线文案。', messages.SUCCESS,
        )
        skipped = queryset.count() - len(pending)
        if skipped:
            self.message_user(
                request, f'{skipped} 条不是“待人审”状态，已跳过。',
                messages.WARNING,
            )

    @admin.action(description='批量采纳路线文案（待人审 → 已发布）')
    def approve_selected(self, request, queryset):
        self._review(request, queryset, 'approve')

    @admin.action(description='批量驳回路线文案（待人审 → 已驳回）')
    def reject_selected(self, request, queryset):
        self._review(request, queryset, 'reject')


@admin.register(RouteLog)
class RouteLogAdmin(admin.ModelAdmin):
    list_display = [
        'id', 'route_code', 'event', 'spot_id', 'latency_ms', 'created_at',
    ]
    list_filter = ['event', 'route_code']
    search_fields = ['route_code']
    ordering = ['-created_at']
    readonly_fields = [
        'route_code', 'event', 'spot_id', 'payload', 'latency_ms', 'created_at',
    ]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
