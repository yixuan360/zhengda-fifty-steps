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


class DeepContent(models.Model):
    """一篇按“景点 × 分类”组织的深度稿（V2 比赛版）。

    与 KnowledgeItem 独立：DeepContent 是人工审过的成稿，运行时只读，
    不再经过 LLM 重组；旧事实卡片与旧叙事链路保持原样。
    """

    CATEGORIES = [
        ('architecture', '建筑'),
        ('history', '历史'),
        ('academy', '学科'),
        ('nature', '自然'),
        ('activity', '活动'),
    ]
    STATUSES = [
        ('draft', '草稿'),
        ('pending', '待人审'),
        ('approved', '已发布'),
        ('rejected', '已驳回'),
    ]

    spot = models.ForeignKey(
        'spots.Spot', on_delete=models.CASCADE, related_name='deep_contents',
        verbose_name='景点',
    )
    category = models.CharField('分类', max_length=20, choices=CATEGORIES)
    title = models.CharField('标题', max_length=120)
    body = models.TextField('正文（600~800 字）')
    beats = models.JSONField('内容节拍', default=list, blank=True)
    sources = models.JSONField('来源', default=list, blank=True)
    fact_notes = models.JSONField('事实核对备注', default=list, blank=True)
    audio_script = models.TextField('音频稿', blank=True)
    audio_path = models.CharField('音频路径', max_length=255, blank=True)
    status = models.CharField(
        '状态', max_length=20, choices=STATUSES, default='pending',
    )
    version = models.PositiveIntegerField('版本', default=1)
    review_note = models.TextField('审阅备注', blank=True)
    created_by = models.CharField(
        '创建者', max_length=10, choices=[('ai', 'AI'), ('human', '人工')],
        default='ai',
    )
    reviewed_by = models.CharField('审核人', max_length=150, blank=True)
    created_at = models.DateTimeField('创建时间', auto_now_add=True)
    updated_at = models.DateTimeField('更新时间', auto_now=True)

    class Meta:
        verbose_name = '深度稿'
        verbose_name_plural = '深度稿'
        unique_together = [('spot', 'category')]
        indexes = [models.Index(fields=['spot', 'category', 'status'])]

    def __str__(self):
        return f'[{self.spot_id}/{self.category}] {self.title[:30]}'


class DeepContentLog(models.Model):
    """V2 深度稿的查看/播放/降级日志，供比赛演示与统计。"""

    EVENTS = [
        ('view', '查看'),
        ('play', '播放'),
        ('complete', '播完'),
        ('fallback', '降级'),
    ]

    spot_id = models.IntegerField('景点 id')
    content = models.ForeignKey(
        DeepContent, null=True, blank=True, on_delete=models.SET_NULL,
        related_name='logs', verbose_name='深度稿',
    )
    category = models.CharField('分类', max_length=20, blank=True)
    event = models.CharField('事件', max_length=20, choices=EVENTS)
    latency_ms = models.IntegerField('耗时（毫秒）', default=0)
    created_at = models.DateTimeField('创建时间', auto_now_add=True)

    class Meta:
        verbose_name = '深度稿日志'
        verbose_name_plural = '深度稿日志'
        indexes = [models.Index(fields=['spot_id', 'category', 'event'])]

    def __str__(self):
        return f'#{self.spot_id}/{self.category}/{self.event}'


class Route(models.Model):
    """V3 — 一条可演示的校园叙事路线（如眉湖八景、中轴三章）。"""

    STATUSES = DeepContent.STATUSES

    code = models.CharField('路线 code', max_length=40, unique=True)
    name = models.CharField('路线名', max_length=80)
    subtitle = models.CharField('副标题', max_length=160, blank=True)
    theme = models.CharField('主题', max_length=80, blank=True)
    total_minutes = models.PositiveSmallIntegerField('总时长（分钟）', default=0)
    walking_km = models.DecimalField(
        '步行距离（km）', max_digits=5, decimal_places=2, default=0,
    )
    status = models.CharField(
        '状态', max_length=20, choices=STATUSES, default='pending',
    )
    version = models.PositiveIntegerField('版本', default=1)
    review_note = models.TextField('审阅备注', blank=True)
    reviewed_by = models.CharField('审核人', max_length=150, blank=True)
    created_at = models.DateTimeField('创建时间', auto_now_add=True)
    updated_at = models.DateTimeField('更新时间', auto_now=True)

    class Meta:
        verbose_name = '路线'
        verbose_name_plural = '路线'
        ordering = ['code']

    def __str__(self):
        return f'{self.code} {self.name}'


class RouteStop(models.Model):
    """路线中的一个站点；optional 表示时间不够时可删。"""

    route = models.ForeignKey(
        Route, on_delete=models.CASCADE, related_name='stops',
        verbose_name='路线',
    )
    spot = models.ForeignKey(
        'spots.Spot', on_delete=models.CASCADE, related_name='route_stops',
        verbose_name='景点',
    )
    order = models.PositiveSmallIntegerField('顺序')
    category = models.CharField(
        '深度稿分类', max_length=20, choices=DeepContent.CATEGORIES,
        blank=True, default='',
    )
    duration_seconds = models.PositiveSmallIntegerField('建议时长（秒）', default=90)
    optional = models.BooleanField('可选站', default=False)
    indoor = models.BooleanField('室内/可避雨', default=False)
    note = models.CharField('备注', max_length=160, blank=True)

    class Meta:
        verbose_name = '路线站点'
        verbose_name_plural = '路线站点'
        unique_together = [('route', 'order')]
        ordering = ['route', 'order']

    def __str__(self):
        return f'{self.route.code}#{self.order} {self.spot_id}'


class RouteNarrative(models.Model):
    """路线级文案：开场、站点间过渡、收尾。"""

    KINDS = [
        ('intro', '开场'),
        ('transition', '过渡'),
        ('outro', '收尾'),
    ]
    STATUSES = DeepContent.STATUSES

    route = models.ForeignKey(
        Route, on_delete=models.CASCADE, related_name='narratives',
        verbose_name='路线',
    )
    key = models.CharField('内容 key', max_length=40)
    kind = models.CharField('类型', max_length=20, choices=KINDS)
    from_order = models.PositiveSmallIntegerField('起始站序', null=True, blank=True)
    to_order = models.PositiveSmallIntegerField('到达站序', null=True, blank=True)
    text = models.TextField('文字稿')
    audio_script = models.TextField('音频稿', blank=True)
    audio_path = models.CharField('音频路径', max_length=255, blank=True)
    sources = models.JSONField('来源', default=list, blank=True)
    fact_notes = models.JSONField('事实核对备注', default=list, blank=True)
    status = models.CharField(
        '状态', max_length=20, choices=STATUSES, default='pending',
    )
    version = models.PositiveIntegerField('版本', default=1)
    review_note = models.TextField('审阅备注', blank=True)
    reviewed_by = models.CharField('审核人', max_length=150, blank=True)
    created_at = models.DateTimeField('创建时间', auto_now_add=True)
    updated_at = models.DateTimeField('更新时间', auto_now=True)

    class Meta:
        verbose_name = '路线文案'
        verbose_name_plural = '路线文案'
        unique_together = [('route', 'key')]
        ordering = ['route', 'key']

    def __str__(self):
        return f'{self.route.code}/{self.key}'


class RouteLog(models.Model):
    """V3 路线事件：规划、开始、调整、完成、降级。"""

    EVENTS = [
        ('plan', '规划'),
        ('view', '查看'),
        ('start', '开始'),
        ('stop', '停止'),
        ('complete', '完成'),
        ('adapt', '调整'),
        ('fallback', '降级'),
    ]

    route_code = models.CharField('路线 code', max_length=40)
    event = models.CharField('事件', max_length=20, choices=EVENTS)
    spot_id = models.IntegerField('当前景点 id', null=True, blank=True)
    payload = models.JSONField('请求参数', default=dict, blank=True)
    latency_ms = models.IntegerField('耗时（毫秒）', default=0)
    created_at = models.DateTimeField('创建时间', auto_now_add=True)

    class Meta:
        verbose_name = '路线日志'
        verbose_name_plural = '路线日志'
        indexes = [models.Index(fields=['route_code', 'event'])]

    def __str__(self):
        return f'{self.route_code}/{self.event}'
