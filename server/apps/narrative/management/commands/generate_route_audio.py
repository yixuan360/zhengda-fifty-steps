"""V3 — 为已发布的路线文案预生成 edge-tts 音频。

用法：
    python manage.py generate_route_audio --all
    python manage.py generate_route_audio --route meihu-8
    python manage.py generate_route_audio --all --dry-run
    python manage.py generate_route_audio --route meihu-8 --force
"""
import asyncio
import re
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from apps.narrative.models import RouteNarrative

VOICE = 'zh-CN-XiaoxiaoNeural'


def _synthesize(text, path):
    import edge_tts

    async def run():
        communicate = edge_tts.Communicate(text, VOICE)
        await communicate.save(str(path))

    asyncio.run(run())


def _audio_dir():
    return Path(settings.MEDIA_ROOT) / 'audio' / 'narrative' / 'routes'


def _safe_component(value):
    cleaned = re.sub(r'[^A-Za-z0-9_-]', '_', value)
    return cleaned[:80] or 'item'


def _media_url(filename):
    prefix = settings.MEDIA_URL.strip('/')
    return f'/{prefix}/audio/narrative/routes/{filename}'


class Command(BaseCommand):
    help = '为已发布路线文案预生成 TTS 音频（edge-tts）。'

    def add_arguments(self, parser):
        parser.add_argument(
            '--route', default=None,
            help='只处理指定路线 code（如 meihu-8）',
        )
        parser.add_argument('--all', action='store_true')
        parser.add_argument('--force', action='store_true')
        parser.add_argument('--dry-run', action='store_true')

    def handle(self, *args, **options):
        queryset = (
            RouteNarrative.objects
            .filter(status='approved', route__status='approved')
            .select_related('route')
            .order_by('route__code', 'key')
        )
        if options['route']:
            queryset = queryset.filter(route__code=options['route'])
        if not options['route'] and not options['all']:
            raise CommandError('请指定 --all，或 --route <code>')

        narratives = list(queryset)
        if not narratives:
            self.stdout.write('没有符合条件的已发布路线文案。')
            return

        out_dir = _audio_dir()
        generated = 0
        skipped = 0
        failed = 0
        first_error = None

        for narrative in narratives:
            route_code = narrative.route.code
            # 用 route_id + 安全化 key 组文件名，避免 code/key 路径穿越。
            filename = (
                f'{narrative.route_id}_{_safe_component(narrative.key)}'
                f'_v{narrative.version}.mp3'
            )
            path = out_dir / filename
            if (
                not options['force']
                and narrative.audio_path
                and path.exists()
                and path.stat().st_size > 0
            ):
                skipped += 1
                continue

            if options['dry_run']:
                text = narrative.audio_script or narrative.text
                self.stdout.write(
                    f"[dry-run] route={route_code} key={narrative.key} "
                    f"chars={len(text)} path={path}"
                )
                continue

            text = (narrative.audio_script or narrative.text).strip()
            if not text:
                failed += 1
                first_error = first_error or ValueError('路线文案为空')
                continue

            try:
                out_dir.mkdir(parents=True, exist_ok=True)
                _synthesize(text, path)
                if not path.exists() or path.stat().st_size == 0:
                    raise RuntimeError('TTS 未生成有效文件')
                narrative.audio_path = _media_url(filename)
                narrative.save(update_fields=['audio_path', 'updated_at'])
                generated += 1
            except Exception as exc:
                failed += 1
                first_error = first_error or exc
                self.stderr.write(self.style.WARNING(
                    f'路线文案 #{narrative.id} 音频生成失败：{exc}'
                ))

        if options['dry_run']:
            self.stdout.write(f'共 {len(narratives)} 条，dry-run 未合成。')
            return

        self.stdout.write(self.style.SUCCESS(
            f'路线音频生成完成：成功 {generated} 条，跳过 {skipped} 条，失败 {failed} 条。'
        ))
        if failed and generated == 0:
            raise CommandError(f'路线音频生成失败：{first_error}')
