"""V3 — 导入路线级内容 JSON（Route / RouteStop / RouteNarrative）。

用法：
    python manage.py load_routes --dry-run
    python manage.py load_routes --approve
    python manage.py load_routes --path docs/content/routes.json --approve --force

JSON 结构：[{code, name, subtitle, theme, total_minutes, walking_km, stops, narratives}]
"""
import json
import re
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.narrative.models import (
    DeepContent,
    Route,
    RouteNarrative,
    RouteStop,
)
from apps.spots.models import Spot

VALID_CATEGORIES = {key for key, _ in DeepContent.CATEGORIES}
VALID_KINDS = {key for key, _ in RouteNarrative.KINDS}
SAFE_KEY_RE = re.compile(r'^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$')
ROUTE_FIELDS = ['name', 'subtitle', 'theme', 'total_minutes', 'walking_km']
STOP_FIELDS = [
    'order', 'spot_id', 'category', 'duration_seconds',
    'optional', 'indoor', 'note',
]
NARRATIVE_FIELDS = [
    'key', 'kind', 'from_order', 'to_order', 'text',
    'audio_script', 'sources', 'fact_notes',
]
NARRATIVE_CONTENT_FIELDS = [
    field for field in NARRATIVE_FIELDS if field != 'key'
]


def _default_path():
    return Path(settings.BASE_DIR).parent / 'docs' / 'content' / 'routes.json'


def _km(value):
    return round(float(value), 2)


class Command(BaseCommand):
    help = '导入 V3 路线内容（按 code upsert）。'

    def add_arguments(self, parser):
        parser.add_argument(
            '--path', default=str(_default_path()),
            help='JSON 文件路径（默认 docs/content/routes.json）',
        )
        parser.add_argument('--approve', action='store_true')
        parser.add_argument('--force', action='store_true')
        parser.add_argument('--dry-run', action='store_true')

    def handle(self, *args, **options):
        path = Path(options['path'])
        if not path.exists():
            raise CommandError(f'找不到路线文件：{path}')
        try:
            payload = json.loads(path.read_text(encoding='utf-8'))
        except (OSError, json.JSONDecodeError) as exc:
            raise CommandError(f'读取路线文件失败：{exc}') from exc
        if not isinstance(payload, list):
            raise CommandError('路线文件顶层必须是数组')

        rows = [self._validate(row, index) for index, row in enumerate(payload)]
        codes = [row['code'] for row in rows]
        if len(codes) != len(set(codes)):
            raise CommandError('路线 code 重复')
        if options['dry_run']:
            for row in rows:
                self.stdout.write(
                    f"[dry-run] route={row['code']} stops={len(row['stops'])} "
                    f"narratives={len(row['narratives'])}"
                )
            self.stdout.write(f'共 {len(rows)} 条路线，未写入数据库。')
            return

        created = 0
        updated = 0
        skipped = 0
        with transaction.atomic():
            for row in rows:
                route = Route.objects.filter(code=row['code']).first()
                desired_status = 'approved' if options['approve'] else 'pending'

                if route is None:
                    route = Route.objects.create(
                        code=row['code'],
                        status=desired_status,
                        version=1,
                        reviewed_by='import' if options['approve'] else '',
                        **{field: row[field] for field in ROUTE_FIELDS},
                    )
                    self._replace_children(
                        route, row, desired_status, force=options['force'],
                    )
                    created += 1
                    continue

                changed = (
                    self._route_snapshot(route) != self._desired_snapshot(row)
                )
                if not changed and not options['force']:
                    if options['approve']:
                        if self._approve_all(route):
                            updated += 1
                        else:
                            skipped += 1
                    else:
                        skipped += 1
                    continue

                was_rejected = route.status == 'rejected'
                for field in ROUTE_FIELDS:
                    setattr(route, field, row[field])
                route.version += 1
                if was_rejected:
                    # 已驳回内容改稿后回到待审，不能借 --approve/--force 复活。
                    route.status = 'pending'
                    route.reviewed_by = ''
                else:
                    route.status = desired_status
                    route.reviewed_by = 'import' if options['approve'] else ''
                route.save()
                self._replace_children(
                    route, row,
                    'pending' if was_rejected else desired_status,
                    force=options['force'],
                )
                updated += 1

        self.stdout.write(self.style.SUCCESS(
            f'路线导入完成：新建 {created} 条，更新 {updated} 条，跳过 {skipped} 条。'
        ))

    def _replace_children(self, route, row, status, force=False):
        route.stops.all().delete()
        RouteStop.objects.bulk_create([
            RouteStop(route=route, **stop) for stop in row['stops']
        ])

        # 文案按 key upsert：内容变化时升版本，避免音频文件名回到 v1 被缓存命中。
        existing = {item.key: item for item in route.narratives.all()}
        desired_keys = set()
        for data in row['narratives']:
            key = data['key']
            desired_keys.add(key)
            narrative = existing.get(key)
            if narrative is None:
                RouteNarrative.objects.create(
                    route=route,
                    status=status,
                    version=1,
                    reviewed_by='import' if status == 'approved' else '',
                    **data,
                )
                continue

            changed = any(
                getattr(narrative, field) != data[field]
                for field in NARRATIVE_CONTENT_FIELDS
            )
            if changed or force:
                for field in NARRATIVE_CONTENT_FIELDS:
                    setattr(narrative, field, data[field])
                narrative.version += 1
                narrative.audio_path = ''
                if narrative.status == 'rejected':
                    # 已驳回文案改稿后回到待审，不自动重新发布。
                    narrative.status = 'pending'
                    narrative.reviewed_by = ''
                else:
                    narrative.status = status
                    narrative.reviewed_by = (
                        'import' if status == 'approved' else ''
                    )
                narrative.save()
            elif status == 'approved' and narrative.status == 'pending':
                narrative.status = 'approved'
                narrative.reviewed_by = 'import'
                narrative.save(update_fields=[
                    'status', 'reviewed_by', 'updated_at',
                ])

        route.narratives.exclude(key__in=desired_keys).delete()

    def _approve_all(self, route):
        changed = False
        if route.status == 'pending':
            route.status = 'approved'
            route.reviewed_by = 'import'
            route.save(update_fields=['status', 'reviewed_by', 'updated_at'])
            changed = True
        # 只提升“待人审”，绝不把已驳回的内容重新发布。
        pending = route.narratives.filter(status='pending')
        if pending.exists():
            pending.update(status='approved', reviewed_by='import')
            changed = True
        return changed

    def _route_snapshot(self, route):
        return {
            'name': route.name,
            'subtitle': route.subtitle,
            'theme': route.theme,
            'total_minutes': route.total_minutes,
            'walking_km': _km(route.walking_km),
            'stops': [
                {field: getattr(stop, field) for field in STOP_FIELDS}
                for stop in route.stops.order_by('order')
            ],
            'narratives': [
                {field: getattr(narrative, field) for field in NARRATIVE_FIELDS}
                for narrative in route.narratives.order_by('key')
            ],
        }

    @staticmethod
    def _desired_snapshot(row):
        return {
            **{field: row[field] for field in ROUTE_FIELDS},
            'stops': row['stops'],
            'narratives': row['narratives'],
        }

    def _validate(self, row, index):
        if not isinstance(row, dict):
            raise CommandError(f'第 {index + 1} 条不是对象')
        code = row.get('code')
        name = row.get('name')
        if not isinstance(code, str) or not code.strip():
            raise CommandError(f'第 {index + 1} 条 code 为空')
        if not isinstance(name, str) or not name.strip():
            raise CommandError(f'第 {index + 1} 条 name 为空')
        code = code.strip()
        name = name.strip()
        if len(code) > 40:
            raise CommandError(f'第 {index + 1} 条 code 超过 40 字符')
        if not SAFE_KEY_RE.fullmatch(code):
            raise CommandError(f'第 {index + 1} 条 code 含非法字符')
        if len(name) > 80:
            raise CommandError(f'第 {index + 1} 条 name 超过 80 字符')

        subtitle = str(row.get('subtitle') or '').strip()
        theme = str(row.get('theme') or '').strip()
        if len(subtitle) > 160:
            raise CommandError(f'第 {index + 1} 条 subtitle 超过 160 字符')
        if len(theme) > 80:
            raise CommandError(f'第 {index + 1} 条 theme 超过 80 字符')

        stops = row.get('stops')
        if not isinstance(stops, list) or not stops:
            raise CommandError(f'第 {index + 1} 条 stops 必须是非空数组')
        if 'narratives' not in row:
            raise CommandError(
                f'第 {index + 1} 条缺少 narratives（显式写 [] 才能清空）'
            )
        narratives = row['narratives']
        if not isinstance(narratives, list):
            raise CommandError(f'第 {index + 1} 条 narratives 必须是数组')

        normalized_stops = [
            self._validate_stop(stop, index, item_index)
            for item_index, stop in enumerate(stops)
        ]
        orders = [stop['order'] for stop in normalized_stops]
        if len(orders) != len(set(orders)):
            raise CommandError(f'第 {index + 1} 条 stops.order 重复')
        stop_orders = set(orders)

        normalized_narratives = [
            self._validate_narrative(narrative, index, item_index)
            for item_index, narrative in enumerate(narratives)
        ]
        keys = [narrative['key'] for narrative in normalized_narratives]
        if len(keys) != len(set(keys)):
            raise CommandError(f'第 {index + 1} 条 narratives.key 重复')
        for narrative in normalized_narratives:
            if narrative['kind'] != 'transition':
                continue
            if (
                narrative['from_order'] not in stop_orders
                or narrative['to_order'] not in stop_orders
            ):
                raise CommandError(
                    f"第 {index + 1} 条 {narrative['key']} 的站序不在 stops 中"
                )
            if narrative['from_order'] == narrative['to_order']:
                raise CommandError(
                    f"第 {index + 1} 条 {narrative['key']} 的起止站相同"
                )

        try:
            total_minutes = int(row.get('total_minutes') or 0)
            walking_km = _km(row.get('walking_km') or 0)
        except (TypeError, ValueError) as exc:
            raise CommandError(
                f'第 {index + 1} 条 total_minutes/walking_km 非法'
            ) from exc
        if total_minutes < 0 or walking_km < 0:
            raise CommandError(
                f'第 {index + 1} 条 total_minutes/walking_km 不能为负'
            )
        if total_minutes > 32767:
            raise CommandError(f'第 {index + 1} 条 total_minutes 超出范围')
        if walking_km > 999.99:
            raise CommandError(f'第 {index + 1} 条 walking_km 超出范围')

        return {
            'code': code,
            'name': name,
            'subtitle': subtitle,
            'theme': theme,
            'total_minutes': total_minutes,
            'walking_km': walking_km,
            'stops': sorted(normalized_stops, key=lambda item: item['order']),
            'narratives': sorted(
                normalized_narratives, key=lambda item: item['key'],
            ),
        }

    def _validate_stop(self, stop, index, item_index):
        prefix = f'第 {index + 1} 条 stops[{item_index}]'
        if not isinstance(stop, dict):
            raise CommandError(f'{prefix} 必须是对象')
        order = stop.get('order')
        spot_id = stop.get('spot_id')
        duration = stop.get('duration_seconds', 90)
        category = stop.get('category') or ''
        if isinstance(order, bool) or not isinstance(order, int) or not 1 <= order <= 32767:
            raise CommandError(f'{prefix}.order 非法')
        if isinstance(spot_id, bool) or not isinstance(spot_id, int):
            raise CommandError(f'{prefix}.spot_id 非法')
        if not Spot.objects.filter(id=spot_id).exists():
            raise CommandError(f'{prefix}.spot_id 不存在：{spot_id}')
        if category and category not in VALID_CATEGORIES:
            raise CommandError(f'{prefix}.category 非法：{category}')
        if (
            isinstance(duration, bool)
            or not isinstance(duration, int)
            or not 1 <= duration <= 32767
        ):
            raise CommandError(f'{prefix}.duration_seconds 非法')
        optional = stop.get('optional', False)
        indoor = stop.get('indoor', False)
        for label, value in (('optional', optional), ('indoor', indoor)):
            if not isinstance(value, bool):
                raise CommandError(f'{prefix}.{label} 必须是布尔值')
        note = str(stop.get('note') or '').strip()
        if len(note) > 160:
            raise CommandError(f'{prefix}.note 超过 160 字符')
        return {
            'order': order,
            'spot_id': spot_id,
            'category': category,
            'duration_seconds': duration,
            'optional': optional,
            'indoor': indoor,
            'note': note,
        }

    def _validate_narrative(self, narrative, index, item_index):
        prefix = f'第 {index + 1} 条 narratives[{item_index}]'
        if not isinstance(narrative, dict):
            raise CommandError(f'{prefix} 必须是对象')
        key = narrative.get('key')
        kind = narrative.get('kind')
        text = narrative.get('text')
        if not isinstance(key, str) or not key.strip():
            raise CommandError(f'{prefix}.key 为空')
        key = key.strip()
        if len(key) > 40:
            raise CommandError(f'{prefix}.key 超过 40 字符')
        if not SAFE_KEY_RE.fullmatch(key):
            raise CommandError(f'{prefix}.key 含非法字符')
        if kind not in VALID_KINDS:
            raise CommandError(f'{prefix}.kind 非法：{kind}')
        if not isinstance(text, str) or not text.strip():
            raise CommandError(f'{prefix}.text 为空')

        from_order = narrative.get('from_order')
        to_order = narrative.get('to_order')
        for label, value in (('from_order', from_order), ('to_order', to_order)):
            if value is not None and (
                isinstance(value, bool)
                or not isinstance(value, int)
                or not 1 <= value <= 32767
            ):
                raise CommandError(f'{prefix}.{label} 非法')
        if kind == 'transition' and (from_order is None or to_order is None):
            raise CommandError(f'{prefix} 过渡段必须有 from_order/to_order')

        sources = narrative.get('sources') or []
        fact_notes = narrative.get('fact_notes') or []
        if not isinstance(sources, list) or not isinstance(fact_notes, list):
            raise CommandError(f'{prefix}.sources/fact_notes 必须是数组')
        for source in sources:
            if not isinstance(source, dict) or not isinstance(source.get('title'), str):
                raise CommandError(f'{prefix}.sources 元素非法')
            if not isinstance(source.get('url'), str):
                source['url'] = ''
            if not isinstance(source.get('status'), str):
                source['status'] = 'unverified'
        for note in fact_notes:
            if not isinstance(note, dict) or not isinstance(note.get('claim'), str):
                raise CommandError(f'{prefix}.fact_notes 元素非法')
            if not isinstance(note.get('status'), str):
                note['status'] = 'unverified'
            if not isinstance(note.get('note'), str):
                note['note'] = ''

        return {
            'key': key.strip(),
            'kind': kind,
            'from_order': from_order,
            'to_order': to_order,
            'text': text.strip(),
            'audio_script': str(narrative.get('audio_script') or '').strip(),
            'sources': sources,
            'fact_notes': fact_notes,
        }
