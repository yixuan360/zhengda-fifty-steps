"""
T3 — 把景点介绍拆解为待审事实卡片。

用法：
    # 先过目（只打印 JSONL，不入库）
    python manage.py ingest_facts --spot-id 12 --dry-run

    # 确认后入库（status=pending，created_by=ai）
    python manage.py ingest_facts --spot-id 12

    # 多个景点 / 限定维度
    python manage.py ingest_facts --spot-id 12 --spot-id 15 --dimension nature
"""
import json

from django.core.management.base import BaseCommand, CommandError

from apps.narrative import llm_client
from apps.narrative.models import KnowledgeItem
from apps.spots.models import Spot

DIMENSION_KEYS = [key for key, _ in KnowledgeItem.DIMENSIONS]
CONFIDENCE_KEYS = ['single', 'cross']

SYSTEM_PROMPT = """你是郑州大学校园导览的知识编辑。请把给定的景点介绍拆解为若干条“事实卡片”。
每张卡片必须满足：
- dimension：只能是 nature（自然山水）、architecture（建筑肌理）、academy（学科人文）、history（校史城史）之一；
- depth：1 到 5 的整数，1=30 秒概览，2=基础介绍，3=细节故事，4=学科或历史纵深，5=中原文明坐标；
- fact_text：一句可以独立引用、可以被来源证实的事实陈述，不要空泛抒情，不要编造；
- source_refs：该事实的公开出处列表，元素形如 {"title": "来源标题", "url": "来源链接"}；不确定时给空列表；
- confidence：single（单源）或 cross（双源印证），只有确实存在两个独立来源时才用 cross。
只输出 JSON，不要输出任何解释文字。"""

CARD_SCHEMA = {
    'type': 'object',
    'properties': {
        'cards': {
            'type': 'array',
            'items': {
                'type': 'object',
                'properties': {
                    'dimension': {'type': 'string', 'enum': DIMENSION_KEYS},
                    'depth': {'type': 'integer', 'minimum': 1, 'maximum': 5},
                    'fact_text': {'type': 'string'},
                    'source_refs': {
                        'type': 'array',
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
                    'confidence': {'type': 'string', 'enum': CONFIDENCE_KEYS},
                },
                'required': [
                    'dimension', 'depth', 'fact_text', 'source_refs', 'confidence',
                ],
                'additionalProperties': False,
            },
        },
    },
    'required': ['cards'],
    'additionalProperties': False,
}


def _user_prompt(spot, dimension=None):
    lines = [
        f'景点名称：{spot.name}',
        '景点介绍：',
        spot.description,
        '',
    ]
    if dimension:
        lines.append(f'本次只生成 dimension 为 {dimension} 的卡片。')
    lines.append('请输出形如 {"cards": [ ... ]} 的 JSON。')
    return '\n'.join(lines)


def _clean_source_refs(value):
    """返回规范化后的来源列表；结构非法时返回 None。"""
    if value is None:
        return []
    if not isinstance(value, list):
        return None

    refs = []
    for ref in value:
        if not isinstance(ref, dict):
            continue
        title = ref.get('title')
        url = ref.get('url')
        if not isinstance(title, str) or not isinstance(url, str):
            continue
        title = title.strip()
        url = url.strip()
        if not title:
            continue
        refs.append({'title': title, 'url': url})
    return refs


def _normalize_card(raw):
    """校验单张卡片；非法时返回 (None, 原因)。"""
    if not isinstance(raw, dict):
        return None, '不是对象'

    dimension = raw.get('dimension')
    if dimension not in DIMENSION_KEYS:
        return None, 'dimension 非法'

    depth = raw.get('depth')
    if isinstance(depth, bool) or not isinstance(depth, int) or not 1 <= depth <= 5:
        return None, 'depth 非法'

    fact_text = raw.get('fact_text')
    if not isinstance(fact_text, str) or not fact_text.strip():
        return None, 'fact_text 为空'

    source_refs = _clean_source_refs(raw.get('source_refs'))
    if source_refs is None:
        return None, 'source_refs 非法'

    confidence = raw.get('confidence', 'single')
    if confidence not in CONFIDENCE_KEYS:
        return None, 'confidence 非法'

    return {
        'dimension': dimension,
        'depth': depth,
        'fact_text': fact_text.strip(),
        'source_refs': source_refs,
        'confidence': confidence,
    }, None


def _extract_cards(payload):
    """兼容 {"cards": [...]} 与直接返回列表两种形态。"""
    if isinstance(payload, dict):
        cards = payload.get('cards', [])
    elif isinstance(payload, list):
        cards = payload
    else:
        cards = []
    return cards if isinstance(cards, list) else []


def _dedupe_cards(cards):
    """同一 (dimension, depth) 只保留 fact_text 最长的一张。"""
    kept = {}
    for card in cards:
        key = (card['dimension'], card['depth'])
        current = kept.get(key)
        if current is None or len(card['fact_text']) > len(current['fact_text']):
            kept[key] = card
    return list(kept.values())


class Command(BaseCommand):
    help = '把景点介绍拆解为待审事实卡片（LLM），支持 --dry-run 预览。'

    def add_arguments(self, parser):
        parser.add_argument(
            '--spot-id', dest='spot_id', action='append', type=int,
            required=True, help='景点 id，可重复传入',
        )
        parser.add_argument(
            '--dimension', choices=DIMENSION_KEYS, default=None,
            help='只生成指定维度的卡片',
        )
        parser.add_argument(
            '--dry-run', action='store_true',
            help='只打印 JSONL 候选卡片，不写入数据库',
        )

    def handle(self, *args, **options):
        spot_ids = options['spot_id']
        spots = list(Spot.objects.filter(id__in=spot_ids).order_by('id'))
        found_ids = {spot.id for spot in spots}
        missing = [spot_id for spot_id in spot_ids if spot_id not in found_ids]
        if missing:
            raise CommandError(f'景点不存在：{missing}')

        for spot in spots:
            if not spot.description.strip():
                self.stderr.write(self.style.WARNING(
                    f'景点「{spot.name}」(id={spot.id}) 没有介绍，已跳过。'
                ))
                continue
            self._process_spot(spot, options)

    def _process_spot(self, spot, options):
        dimension = options['dimension']
        dry_run = options['dry_run']

        try:
            payload = llm_client.chat_json(
                SYSTEM_PROMPT, _user_prompt(spot, dimension), CARD_SCHEMA,
            )
        except Exception as exc:
            raise CommandError(
                f'景点「{spot.name}」(id={spot.id}) 拆解失败：{exc}'
            ) from exc

        valid_cards = []
        invalid_count = 0
        filtered_count = 0
        for raw in _extract_cards(payload):
            card, reason = _normalize_card(raw)
            if card is None:
                invalid_count += 1
                self._debug_skip(options, reason, raw)
                continue
            if dimension and card['dimension'] != dimension:
                filtered_count += 1
                continue
            valid_cards.append(card)

        deduped = _dedupe_cards(valid_cards)
        dedupe_count = len(valid_cards) - len(deduped)

        if dry_run:
            for card in deduped:
                line = {
                    'spot_id': spot.id,
                    'spot_name': spot.name,
                    **card,
                }
                self.stdout.write(json.dumps(line, ensure_ascii=False))
        else:
            KnowledgeItem.objects.bulk_create([
                KnowledgeItem(
                    spot=spot, status='pending', created_by='ai', **card,
                )
                for card in deduped
            ])

        summary = (
            f'景点「{spot.name}」(id={spot.id})：'
            f'产出 {len(deduped)} 条候选卡片'
            f'（跳过非法 {invalid_count} 条，去重 {dedupe_count} 条'
            + (f'，过滤非指定维度 {filtered_count} 条' if filtered_count else '')
            + ('，dry-run 未入库' if dry_run else '，已写入 pending')
            + '）'
        )
        stream = self.stderr if dry_run else self.stdout
        stream.write(self.style.SUCCESS(summary))
        if invalid_count:
            self.stderr.write(self.style.WARNING(
                f'景点「{spot.name}」共有 {invalid_count} 条非法卡片被跳过。'
            ))

    def _debug_skip(self, options, reason, raw):
        if options.get('verbosity', 1) >= 2:
            preview = json.dumps(raw, ensure_ascii=False)[:200]
            self.stderr.write(f'  跳过卡片（{reason}）：{preview}')
