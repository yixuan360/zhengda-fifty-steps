"""
T3 — 为待审事实卡片补充可核验的公开来源。

用法：
    python manage.py enrich_sources --spot-id 12
    python manage.py enrich_sources --spot-id 12 --status approved

默认处理 status=pending 的卡片；--status approved 可对人审通过的卡片补源。
合并后来源数 >= 2 升级为 cross，= 1 保持 single，confidence=human 不改。
"""
from django.core.management.base import BaseCommand, CommandError

from apps.narrative import llm_client
from apps.narrative.models import KnowledgeItem

SYSTEM_PROMPT = """你是郑州大学校史与校园文化的资料核验员。请为给定的事实陈述补充最多 2 个公开、可核验的来源。
来源优先级依次为：校史馆或档案馆、学校官网、地方志、权威百科。
只输出 JSON，不要输出任何解释文字。"""

SOURCE_SCHEMA = {
    'type': 'object',
    'properties': {
        'sources': {
            'type': 'array',
            'maxItems': 2,
            'items': {
                'type': 'object',
                'properties': {
                    'title': {'type': 'string'},
                    'url': {'type': 'string'},
                },
                'required': ['title', 'url'],
                'additionalProperties': False,
            },
        },
    },
    'required': ['sources'],
    'additionalProperties': False,
}


def _user_prompt(item):
    existing = [
        f'- {ref.get("title", "")}：{ref.get("url", "")}'
        for ref in item.source_refs
        if isinstance(ref, dict)
    ]
    existing_text = '\n'.join(existing) if existing else '（暂无）'
    return (
        f'事实陈述：{item.fact_text}\n'
        f'已有来源：\n{existing_text}\n\n'
        '请给出最多 2 个新的公开来源，形如 '
        '{"sources": [{"title": "来源标题", "url": "来源链接"}]}；'
        '如果没有可靠来源，输出 {"sources": []}。'
    )


def _extract_sources(payload):
    if isinstance(payload, dict):
        sources = payload.get('sources', [])
    elif isinstance(payload, list):
        sources = payload
    else:
        sources = []
    return sources if isinstance(sources, list) else []


def _clean_sources(sources):
    """只保留 title/url 均非空的来源，最多 2 条。"""
    cleaned = []
    for source in sources:
        if not isinstance(source, dict):
            continue
        title = source.get('title')
        url = source.get('url')
        if not isinstance(title, str) or not isinstance(url, str):
            continue
        title = title.strip()
        url = url.strip()
        if not title or not url:
            continue
        cleaned.append({'title': title, 'url': url})
        if len(cleaned) == 2:
            break
    return cleaned


def _merge_sources(existing, additions):
    """按 url（以及 title）去重后合并。"""
    merged = [ref for ref in existing if isinstance(ref, dict)]
    seen_urls = {ref.get('url') for ref in merged if ref.get('url')}
    seen_pairs = {(ref.get('title'), ref.get('url')) for ref in merged}

    for source in additions:
        pair = (source['title'], source['url'])
        if source['url'] in seen_urls or pair in seen_pairs:
            continue
        merged.append(source)
        seen_urls.add(source['url'])
        seen_pairs.add(pair)
    return merged


STATUS_LABELS = {
    'pending': '待审',
    'approved': '已发布',
}


class Command(BaseCommand):
    help = '为事实卡片补充公开可核验来源，并更新 confidence。'

    def add_arguments(self, parser):
        parser.add_argument(
            '--spot-id', dest='spot_id', action='append', type=int,
            required=True, help='景点 id，可重复传入',
        )
        parser.add_argument(
            '--status', choices=list(STATUS_LABELS), default='pending',
            help='处理的卡片状态（默认 pending，可选 approved）',
        )

    def handle(self, *args, **options):
        spot_ids = options['spot_id']
        status = options['status']
        items = list(
            KnowledgeItem.objects
            .filter(spot_id__in=spot_ids, status=status)
            .order_by('id')
        )
        if not items:
            label = STATUS_LABELS[status]
            self.stdout.write(
                f'没有「{label}」状态的卡片需要补源（景点 {spot_ids}）。'
            )
            return

        updated = 0
        failed = 0
        first_error = None

        for item in items:
            try:
                payload = llm_client.chat_json(
                    SYSTEM_PROMPT, _user_prompt(item), SOURCE_SCHEMA,
                )
            except Exception as exc:
                failed += 1
                first_error = first_error or exc
                self.stderr.write(self.style.WARNING(
                    f'卡片 #{item.id} 补源失败：{exc}'
                ))
                continue

            additions = _clean_sources(_extract_sources(payload))
            old_refs = [ref for ref in item.source_refs if isinstance(ref, dict)]
            merged = _merge_sources(old_refs, additions)

            changed = merged != old_refs
            if changed:
                item.source_refs = merged
                update_fields = ['source_refs', 'updated_at']

                # 双源及以上视为双源印证；人工确认过的卡片不改
                if item.confidence != 'human':
                    if len(merged) >= 2:
                        new_confidence = 'cross'
                    elif len(merged) == 1:
                        new_confidence = 'single'
                    else:
                        new_confidence = item.confidence
                    if new_confidence != item.confidence:
                        item.confidence = new_confidence
                        update_fields.append('confidence')

                item.save(update_fields=update_fields)
                updated += 1

        self.stdout.write(self.style.SUCCESS(
            f'补源完成：处理 {len(items)} 条，更新 {updated} 条，失败 {failed} 条。'
        ))
        if failed == len(items):
            raise CommandError(f'全部卡片补源失败：{first_error}')
