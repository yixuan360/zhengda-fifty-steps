"""
批量生成景点音频

将景点的"详细介绍"（description）字段转为语音，上传到数据库的 audio 字段。
使用 edge-tts 实现文字转语音，音色默认为 zh-CN-XiaoxiaoNeural（女声，温柔自然）。

用法：
    # 为所有缺少音频的景点生成音频
    python manage.py generate_audio

    # 覆盖已有音频
    python manage.py generate_audio --force

    # 指定音色
    python manage.py generate_audio --voice zh-CN-YunxiNeural

    # 为单个景点生成
    python manage.py generate_audio --spot-id 12
"""

import asyncio
import logging
import os
import tempfile

import edge_tts
from django.core.files import File
from django.core.management.base import BaseCommand

from apps.spots.models import Spot

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = '批量生成景点音频（description → audio）'

    def add_arguments(self, parser):
        parser.add_argument(
            '--voice',
            default='zh-CN-XiaoxiaoNeural',
            help='edge-tts 音色（默认：zh-CN-XiaoxiaoNeural，女声温柔）',
        )
        parser.add_argument(
            '--force',
            action='store_true',
            help='覆盖已有音频',
        )
        parser.add_argument(
            '--spot-id',
            type=int,
            help='指定景点ID，不指定则处理所有景点',
        )
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='仅显示将处理的景点，不实际生成音频',
        )

    def handle(self, *args, **options):
        voice = options['voice']
        force = options['force']
        spot_id = options['spot_id']
        dry_run = options['dry_run']

        # 构建查询：有 description 且非空
        queryset = Spot.objects.filter(description__isnull=False).exclude(description='')

        if spot_id:
            queryset = queryset.filter(id=spot_id)
        elif not force:
            # 默认跳过已有音频的景点
            queryset = queryset.filter(audio__isnull=True)

        spots = list(queryset)

        if not spots:
            self.stdout.write(self.style.WARNING('没有需要处理的景点'))
            return

        self.stdout.write(f'找到 {len(spots)} 个景点需要处理')
        self.stdout.write(f'音色：{voice}')
        self.stdout.write(f'模式：{"覆盖" if force else "仅生成缺失"}')
        self.stdout.write('-' * 50)

        if dry_run:
            for spot in spots:
                self.stdout.write(f'  [{spot.id}] {spot.name}')
            return

        success_count = 0
        fail_count = 0

        for spot in spots:
            try:
                self._generate_audio(spot, voice)
                success_count += 1
                self.stdout.write(self.style.SUCCESS(f'[OK] [{spot.id}] {spot.name}'))
            except Exception as e:
                fail_count += 1
                logger.error(f'生成音频失败 [{spot.id}] {spot.name}: {e}')
                self.stdout.write(self.style.ERROR(f'[FAIL] [{spot.id}] {spot.name}: {e}'))

        self.stdout.write('-' * 50)
        self.stdout.write(f'完成：{success_count} 成功，{fail_count} 失败')

    def _generate_audio(self, spot: Spot, voice: str):
        """为单个景点生成音频"""
        # 使用临时文件保存生成的音频
        with tempfile.NamedTemporaryFile(suffix='.mp3', delete=False) as tmp_file:
            tmp_path = tmp_file.name

        try:
            # 调用 edge-tts 生成音频
            asyncio.run(self._tts_generate(spot.description, tmp_path, voice))

            # 上传到数据库
            self._upload_audio(spot, tmp_path)
        finally:
            # 清理临时文件
            if os.path.exists(tmp_path):
                os.unlink(tmp_path)

    async def _tts_generate(self, text: str, output_path: str, voice: str):
        """异步调用 edge-tts 生成音频"""
        communicate = edge_tts.Communicate(text, voice)
        await communicate.save(output_path)

    def _upload_audio(self, spot: Spot, audio_path: str):
        """上传音频文件到 Spot.audio 字段"""
        file_size = os.path.getsize(audio_path)
        if file_size == 0:
            raise ValueError('生成的音频文件为空')

        with open(audio_path, 'rb') as f:
            django_file = File(f)
            filename = f'spot_{spot.id}.mp3'
            spot.audio.save(filename, django_file, save=True)
