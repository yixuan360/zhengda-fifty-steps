"""V2 — 导入按“景点 × 分类”组织的深度稿 JSON。

用法：
    # 预览
    python manage.py load_deep_content --path docs/content/deep_content.json --dry-run

    # 导入并直接发布（内容已人审时）
    python manage.py load_deep_content --path docs/content/deep_content.json --approve

    # 导入为待人审
    python manage.py load_deep_content --path docs/content/deep_content.json

JSON 结构：[{spot_id, category, title, body, beats?, sources?, fact_notes?, audio_script?}, ...]
"""
import json
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.narrative.models import DeepContent
from apps.spots.models import Spot

VALID_CATEGORIES = {key for key, _ in DeepContent.CATEGORIES}
CONTENT_FIELDS = [
    'title', 'body', 'beats', 'sources', 'fact_notes', 'audio_script',
]


def _default_path():
    return Path(settings.BASE_DIR).parent / 'docs' / 'content' / 'deep_content.json'


class Command(BaseCommand):
    help = '导入 V2 深度稿 JSON（按 spot + category upsert）。'

    def add_arguments(self, parser):
        parser.add_argument(
            '--path', default=str(_default_path()),
            help='JSON 文件路径（默认 docs/content/deep_content.json）',
        )
        parser.add_argument(
            '--approve', action='store_true',
            help='导入后直接置为 approved（内容已人审）',
        )
        parser.add_argument(
            '--force', action='store_true',
            help='内容未变化也更新版本并清空音频缓存',
        )
        parser.add_argument(
            '--dry-run', action='store_true',
            help='只打印将要执行的操作，不写数据库',
        )

    def handle(self, *args, **options):
        path = Path(options['path'])
        if not path.exists():
            raise CommandError(f'找不到内容文件：{path}')

        try:
            payload = json.loads(path.read_text(encoding='utf-8'))
        except (OSError, json.JSONDecodeError) as exc:
            raise CommandError(f'读取内容文件失败：{exc}') from exc

        if not isinstance(payload, list):
            raise CommandError('内容文件顶层必须是数组')

        rows = [self._validate(row, index) for index, row in enumerate(payload)]
        if options['dry_run']:
            for row in rows:
                self.stdout.write(
                    f"[dry-run] spot={row['spot_id']} category={row['category']} "
                    f"title={row['title']}"
                )
            self.stdout.write(f'共 {len(rows)} 篇，未写入数据库。')
            return

        created = 0
        updated = 0
        skipped = 0
        with transaction.atomic():
            for row in rows:
                spot = Spot.objects.filter(id=row['spot_id']).first()
                if spot is None:
                    raise CommandError(f"景点不存在：{row['spot_id']}")

                existing = DeepContent.objects.filter(
                    spot=spot, category=row['category'],
                ).first()
                desired_status = 'approved' if options['approve'] else 'pending'

                if existing is None:
                    DeepContent.objects.create(
                        spot=spot,
                        category=row['category'],
                        status=desired_status,
                        version=1,
                        created_by='ai',
                        reviewed_by='import' if options['approve'] else '',
                        **{field: row[field] for field in CONTENT_FIELDS},
                    )
                    created += 1
                    continue

                changed = any(
                    getattr(existing, field) != row[field]
                    for field in CONTENT_FIELDS
                )

                # 内容没变：不把已发布稿打回待审；只有显式 --approve 才做状态提升。
                if not changed and not options['force']:
                    if options['approve'] and existing.status != 'approved':
                        existing.status = 'approved'
                        existing.reviewed_by = 'import'
                        existing.save(update_fields=[
                            'status', 'reviewed_by', 'updated_at',
                        ])
                        updated += 1
                    else:
                        skipped += 1
                    continue

                for field in CONTENT_FIELDS:
                    setattr(existing, field, row[field])
                existing.version += 1
                existing.status = desired_status
                existing.reviewed_by = 'import' if options['approve'] else ''
                # 正文/音频稿变化后旧音频不可再用，交给 generate_deep_audio 重建。
                existing.audio_path = ''
                existing.save()
                updated += 1

        self.stdout.write(self.style.SUCCESS(
            f'导入完成：新建 {created} 篇，更新 {updated} 篇，跳过 {skipped} 篇。'
        ))

    def _validate(self, row, index):
        if not isinstance(row, dict):
            raise CommandError(f'第 {index + 1} 条不是对象')

        spot_id = row.get('spot_id')
        if isinstance(spot_id, bool) or not isinstance(spot_id, int):
            raise CommandError(f'第 {index + 1} 条 spot_id 非法')

        category = row.get('category')
        if category not in VALID_CATEGORIES:
            raise CommandError(f'第 {index + 1} 条 category 非法：{category}')

        title = row.get('title')
        body = row.get('body')
        if not isinstance(title, str) or not title.strip():
            raise CommandError(f'第 {index + 1} 条 title 为空')
        if not isinstance(body, str) or not body.strip():
            raise CommandError(f'第 {index + 1} 条 body 为空')

        audio_script = row.get('audio_script') or ''
        if not isinstance(audio_script, str):
            raise CommandError(f'第 {index + 1} 条 audio_script 必须是字符串')

        data = {
            'spot_id': spot_id,
            'category': category,
            'title': title.strip(),
            'body': body.strip(),
            'beats': row.get('beats') or [],
            'sources': row.get('sources') or [],
            'fact_notes': row.get('fact_notes') or [],
            'audio_script': audio_script.strip(),
        }
        data['beats'] = self._validate_objects(
            data['beats'], 'beats', ('heading', 'text', 'kind'), index,
        )
        for beat in data['beats']:
            if beat['kind'] not in ('fact', 'interpretation'):
                raise CommandError(
                    f'第 {index + 1} 条 beats.kind 必须是 fact/interpretation'
                )
        data['sources'] = self._validate_objects(
            data['sources'], 'sources', ('title', 'url'), index,
        )
        for source in data['sources']:
            source.setdefault('status', 'unverified')
        data['fact_notes'] = self._validate_objects(
            data['fact_notes'], 'fact_notes', ('claim', 'status', 'note'), index,
        )
        return data

    @staticmethod
    def _validate_objects(value, field, required, index):
        if not isinstance(value, list):
            raise CommandError(f'第 {index + 1} 条 {field} 必须是数组')
        for item_index, item in enumerate(value):
            if not isinstance(item, dict):
                raise CommandError(
                    f'第 {index + 1} 条 {field}[{item_index}] 必须是对象'
                )
            for key in required:
                if not isinstance(item.get(key), str):
                    raise CommandError(
                        f'第 {index + 1} 条 {field}[{item_index}].{key} 必须是字符串'
                    )
        return value
