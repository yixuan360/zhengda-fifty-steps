"""V2 — 为已发布的深度稿预生成 edge-tts 音频。

用法：
    python manage.py generate_deep_audio --all
    python manage.py generate_deep_audio --spot-id 16 --category architecture
    python manage.py generate_deep_audio --all --dry-run
    python manage.py generate_deep_audio --spot-id 16 --force

音频写入 MEDIA_ROOT/audio/narrative/deep/，并把相对 URL 写回 audio_path。
运行时不再合成，保证 App 一次点击即可播放。
"""
import asyncio
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from apps.narrative.models import DeepContent

VOICE = 'zh-CN-XiaoxiaoNeural'
VALID_CATEGORIES = {key for key, _ in DeepContent.CATEGORIES}


def _synthesize(text, path):
    import edge_tts

    async def run():
        communicate = edge_tts.Communicate(text, VOICE)
        await communicate.save(str(path))

    asyncio.run(run())


def _audio_dir():
    return Path(settings.MEDIA_ROOT) / 'audio' / 'narrative' / 'deep'


def _media_url(filename):
    prefix = settings.MEDIA_URL.strip('/')
    return f'/{prefix}/audio/narrative/deep/{filename}'


class Command(BaseCommand):
    help = '为已发布深度稿预生成 TTS 音频（edge-tts）。'

    def add_arguments(self, parser):
        parser.add_argument(
            '--spot-id', dest='spot_id', action='append', type=int, default=None,
            help='景点 id，可重复传入；不传则处理全部',
        )
        parser.add_argument(
            '--category', choices=sorted(VALID_CATEGORIES), default=None,
            help='只处理指定分类',
        )
        parser.add_argument(
            '--all', action='store_true', help='处理所有已发布深度稿',
        )
        parser.add_argument(
            '--force', action='store_true', help='已有音频也重新生成',
        )
        parser.add_argument(
            '--dry-run', action='store_true', help='只打印目标路径，不合成',
        )

    def handle(self, *args, **options):
        queryset = DeepContent.objects.filter(status='approved').order_by(
            'spot_id', 'category',
        )
        if options['spot_id']:
            queryset = queryset.filter(spot_id__in=options['spot_id'])
        if options['category']:
            queryset = queryset.filter(category=options['category'])
        if not options['spot_id'] and not options['category'] and not options['all']:
            raise CommandError('请指定 --all，或 --spot-id/--category')

        contents = list(queryset)
        if not contents:
            self.stdout.write('没有符合条件的已发布深度稿。')
            return

        out_dir = _audio_dir()
        generated = 0
        skipped = 0
        failed = 0
        first_error = None

        for content in contents:
            filename = f'{content.spot_id}_{content.category}_v{content.version}.mp3'
            path = out_dir / filename
            if (
                not options['force']
                and content.audio_path
                and path.exists()
                and path.stat().st_size > 0
            ):
                skipped += 1
                continue

            if options['dry_run']:
                self.stdout.write(
                    f"[dry-run] spot={content.spot_id} category={content.category} "
                    f"chars={len(content.audio_script or content.body)} path={path}"
                )
                continue

            text = (content.audio_script or content.body).strip()
            if not text:
                failed += 1
                first_error = first_error or ValueError('音频稿为空')
                continue

            try:
                out_dir.mkdir(parents=True, exist_ok=True)
                _synthesize(text, path)
                if not path.exists() or path.stat().st_size == 0:
                    raise RuntimeError('TTS 未生成有效文件')
                content.audio_path = _media_url(filename)
                content.save(update_fields=['audio_path', 'updated_at'])
                generated += 1
            except Exception as exc:
                failed += 1
                first_error = first_error or exc
                self.stderr.write(self.style.WARNING(
                    f'深度稿 #{content.id} 音频生成失败：{exc}'
                ))

        if options['dry_run']:
            self.stdout.write(f'共 {len(contents)} 篇，dry-run 未合成。')
            return

        self.stdout.write(self.style.SUCCESS(
            f'音频生成完成：成功 {generated} 篇，跳过 {skipped} 篇，失败 {failed} 篇。'
        ))
        if failed and generated == 0:
            raise CommandError(f'音频生成失败：{first_error}')
