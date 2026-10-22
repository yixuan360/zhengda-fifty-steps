"""
文脉叙事引擎 — Admin 人审队列

- KnowledgeItem：按 status / dimension / depth / spot 过滤，批量采纳/驳回并写 ReviewTask
- ReviewTask：只读人审留痕
- NarrativeLog：只读生成日志，供人工观察 fallback / 校验 / 延迟
"""
from django.contrib import admin, messages
from django.db import transaction

from .models import KnowledgeItem, NarrativeLog, ReviewTask


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
