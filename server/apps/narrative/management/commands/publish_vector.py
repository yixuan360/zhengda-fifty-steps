"""
把事实卡片同步到 Chroma 向量库。

approved → upsert；pending / rejected → delete（含已下架卡片）。
可用 --spot-id 只同步指定景点。
"""
from django.core.management.base import BaseCommand

from apps.narrative import vector_store
from apps.narrative.models import KnowledgeItem


class Command(BaseCommand):
    help = '同步已发布的事实卡片到 Chroma 向量库；非 approved 的卡片从向量库移除。'

    def add_arguments(self, parser):
        parser.add_argument(
            '--spot-id', type=int, default=None,
            help='仅同步指定景点的卡片（默认全量）',
        )

    def handle(self, *args, **options):
        queryset = KnowledgeItem.objects.all().order_by('id')
        spot_id = options['spot_id']
        if spot_id is not None:
            queryset = queryset.filter(spot_id=spot_id)

        upserted = 0
        deleted = 0
        for item in queryset.iterator():
            if item.status == 'approved':
                vector_store.upsert_item(item)
                upserted += 1
            else:
                vector_store.delete_item(item.id)
                deleted += 1

        self.stdout.write(self.style.SUCCESS(
            f'同步完成：upsert {upserted} 条，delete {deleted} 条。'
        ))
