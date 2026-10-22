"""
文脉叙事引擎 — 事实卡片知识库模型

字段定义以实施计划「接口契约」一节为唯一真源，字段名与 choices 取值不得改动。
spots 表零迁移：KnowledgeItem 通过外键引用现有 spots.Spot。
"""
from django.db import models


class KnowledgeItem(models.Model):
    """一张可独立引用、可被来源证实的事实卡片。"""

    DIMENSIONS = [
        ('nature', '自然山水'),
        ('architecture', '建筑肌理'),
        ('academy', '学科人文'),
        ('history', '校史城史'),
    ]
    STATUSES = [
        ('pending', '待人审'),
        ('approved', '已发布'),
        ('rejected', '已驳回'),
    ]
    CONFIDENCES = [
        ('single', '单源'),
        ('cross', '双源印证'),
        ('human', '人审确认'),
    ]

    spot = models.ForeignKey(
        'spots.Spot', on_delete=models.CASCADE, related_name='knowledge_items',
        verbose_name='景点',
    )
    dimension = models.CharField('维度', max_length=20, choices=DIMENSIONS)
    depth = models.PositiveSmallIntegerField('深度（1~5）')
    fact_text = models.TextField('事实陈述')
    source_refs = models.JSONField('来源', default=list)
    confidence = models.CharField(
        '可信度', max_length=20, choices=CONFIDENCES, default='single',
    )
    status = models.CharField(
        '状态', max_length=20, choices=STATUSES, default='pending',
    )
    version = models.PositiveIntegerField('版本', default=1)
    created_by = models.CharField(
        '创建者', max_length=10, choices=[('ai', 'AI'), ('human', '人工')],
        default='ai',
    )
    created_at = models.DateTimeField('创建时间', auto_now_add=True)
    updated_at = models.DateTimeField('更新时间', auto_now=True)

    class Meta:
        verbose_name = '事实卡片'
        verbose_name_plural = '事实卡片'
        indexes = [models.Index(fields=['spot', 'dimension', 'depth', 'status'])]

    def __str__(self):
        return f'[{self.spot_id}/{self.dimension}/L{self.depth}] {self.fact_text[:40]}'


class ReviewTask(models.Model):
    """人审记录：每次采纳/驳回/修改后采纳留痕。"""

    DECISIONS = [
        ('approve', '采纳'),
        ('reject', '驳回'),
        ('edit', '修改后采纳'),
    ]

    item = models.ForeignKey(
        KnowledgeItem, on_delete=models.CASCADE, related_name='review_tasks',
        verbose_name='事实卡片',
    )
    decision = models.CharField('结论', max_length=20, choices=DECISIONS)
    reviewer_note = models.TextField('审阅备注', blank=True)
    created_at = models.DateTimeField('创建时间', auto_now_add=True)

    class Meta:
        verbose_name = '人审记录'
        verbose_name_plural = '人审记录'

    def __str__(self):
        return f'#{self.item_id} {self.get_decision_display()}'


class NarrativeLog(models.Model):
    """运行时生成日志，供度量闭环统计。"""

    spot_id = models.IntegerField('景点 id')
    dimension = models.CharField('维度', max_length=20)
    depth = models.PositiveSmallIntegerField('深度')
    request_params = models.JSONField('请求参数', default=dict)
    fact_ids = models.JSONField('命中事实卡片 id', default=list)
    output_text = models.TextField('生成文案', blank=True)
    validation_passed = models.BooleanField('引用校验通过', default=False)
    fallback = models.BooleanField('是否降级', default=False)
    latency_ms = models.IntegerField('耗时（毫秒）', default=0)
    created_at = models.DateTimeField('创建时间', auto_now_add=True)

    class Meta:
        verbose_name = '生成日志'
        verbose_name_plural = '生成日志'

    def __str__(self):
        return f'#{self.spot_id}/{self.dimension}/L{self.depth}'
