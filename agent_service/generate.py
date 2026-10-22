"""检索 → 受限生成 → 引用校验 → 音频合成。

任何一步失败都返回契约中的降级响应，保证 App 不会“点了没反应”。
"""
import asyncio
import hashlib
import logging
import math
import os
import re
from pathlib import Path

from . import llm
from .retrieve import get_facts

logger = logging.getLogger(__name__)

CITATION_THRESHOLD = 0.75
MAX_ATTEMPTS = 2
VOICE = 'zh-CN-XiaoxiaoNeural'
MARKER_RE = re.compile(r'\[k(\d+)\]')

# 可在测试中替换为 tmp_path；生产可用 NARRATIVE_MEDIA_CACHE 覆盖
_MEDIA_CACHE_ENV = os.environ.get('NARRATIVE_MEDIA_CACHE', '').strip()
MEDIA_CACHE = (
    Path(_MEDIA_CACHE_ENV)
    if _MEDIA_CACHE_ENV
    else Path(__file__).resolve().parent / 'media_cache'
)

_embedding_function = None


def fallback_response():
    return {
        'text': '',
        'citations': [],
        'depth': 0,
        'audio_url': None,
        'fallback': True,
    }


def _system_prompt(max_seconds):
    return (
        '你是郑州大学校园导览讲解员。只能使用给定的事实卡片组织讲解，'
        '不得新增事实，不得推测或补充卡片之外的信息。'
        '每陈述一条事实，就在该句末尾标注引用，格式为 [k<卡片编号>]。'
        f'语气亲切自然，适合步行收听，时长预算为 {max_seconds} 秒。'
    )


def _user_prompt(facts, max_seconds):
    lines = ['可用事实卡片（只能使用以下内容）：']
    for fact in facts:
        lines.append(
            f"[k{fact['fact_id']}]"
            f"（{fact['dimension']} / 深度{fact['depth']}）{fact['fact_text']}"
        )
    lines.append('')
    lines.append(
        f'请生成一段约 {max_seconds} 秒的中文讲解，句末用 [k编号] 标注引用。'
    )
    return '\n'.join(lines)


def _last_sentence(chunk):
    """取 chunk 中最后一句（按中英文句末标点切分）。"""
    parts = re.split(r'(?<=[。！？!?；;])', chunk)
    for part in reversed(parts):
        text = part.strip()
        if text:
            return text
    return ''


def _parse_citations(raw_text):
    """返回 [(fact_id, 引用句)]；标记前无内容时沿用上一句。"""
    pairs = []
    last_end = 0
    last_sentence = ''

    for match in MARKER_RE.finditer(raw_text):
        chunk = raw_text[last_end:match.start()].strip()
        sentence = _last_sentence(chunk) or last_sentence
        if sentence:
            last_sentence = sentence
        pairs.append((int(match.group(1)), sentence))
        last_end = match.end()

    return pairs


def _clean_text(raw_text):
    text = MARKER_RE.sub('', raw_text)
    text = re.sub(r'[ \t]+', ' ', text)
    return text.strip()


def _embed(texts):
    """Chroma 默认 embedding（首次调用会下载模型）。测试中 monkeypatch。"""
    global _embedding_function
    if _embedding_function is None:
        from chromadb.utils.embedding_functions import DefaultEmbeddingFunction
        _embedding_function = DefaultEmbeddingFunction()
    return _embedding_function(list(texts))


def _cosine(left, right):
    dot = sum(float(x) * float(y) for x, y in zip(left, right))
    left_norm = math.sqrt(sum(float(x) * float(x) for x in left))
    right_norm = math.sqrt(sum(float(y) * float(y) for y in right))
    if not left_norm or not right_norm:
        return 0.0
    return dot / (left_norm * right_norm)


def _passes_citation_check(pairs, fact_by_id):
    """逐条计算引用句与卡片原文的余弦相似度，全部 >= 阈值才算通过。"""
    if not pairs:
        return False
    for _, sentence in pairs:
        if not sentence:
            return False

    sentences = [sentence for _, sentence in pairs]
    fact_texts = [fact_by_id[fact_id]['fact_text'] for fact_id, _ in pairs]
    vectors = _embed(sentences + fact_texts)
    total = len(pairs)

    for index in range(total):
        if _cosine(vectors[index], vectors[total + index]) < CITATION_THRESHOLD:
            return False
    return True


def _cache_key(spot_id, dimension, depth, text):
    raw = f'{spot_id}|{dimension}|{depth}|{text}'.encode('utf-8')
    return hashlib.sha1(raw).hexdigest()


def _synthesize(text, path):
    import edge_tts

    async def run():
        communicate = edge_tts.Communicate(text, VOICE)
        await communicate.save(str(path))

    asyncio.run(run())


def _ensure_audio(spot_id, dimension, depth, text):
    """命中缓存直接返回 URL；合成失败返回 None，不阻塞叙事。"""
    key = _cache_key(spot_id, dimension, depth, text)
    path = MEDIA_CACHE / f'{key}.mp3'

    if path.exists() and path.stat().st_size > 0:
        return f'/narrative-media/{path.name}'

    try:
        MEDIA_CACHE.mkdir(parents=True, exist_ok=True)
        _synthesize(text, path)
    except Exception as exc:
        logger.warning('TTS 合成失败：%s', exc)
        try:
            path.unlink(missing_ok=True)
        except OSError:
            pass
        return None

    if not path.exists() or path.stat().st_size == 0:
        logger.warning('TTS 未生成有效音频：%s', path)
        return None

    return f'/narrative-media/{path.name}'


def generate_narrative(spot_id, dimension, current_depth,
                       listened_fact_ids, max_seconds):
    """返回与 HTTP 契约一致的 dict。"""
    try:
        facts = get_facts(
            spot_id, dimension, current_depth, listened_fact_ids,
        )
    except Exception as exc:
        logger.warning('事实检索异常：%s', exc)
        return fallback_response()

    if not facts:
        return fallback_response()

    fact_by_id = {fact['fact_id']: fact for fact in facts}
    system_prompt = _system_prompt(max_seconds)
    user_prompt = _user_prompt(facts, max_seconds)

    for attempt in range(MAX_ATTEMPTS):
        try:
            raw_text = llm.generate(system_prompt, user_prompt)
        except Exception as exc:
            logger.warning('LLM 生成失败（第 %s 次）：%s', attempt + 1, exc)
            continue

        pairs = _parse_citations(raw_text)
        if not pairs or any(fact_id not in fact_by_id for fact_id, _ in pairs):
            logger.info('引用缺失或含未知 id（第 %s 次）', attempt + 1)
            continue

        try:
            if not _passes_citation_check(pairs, fact_by_id):
                logger.info('引用相似度校验未通过（第 %s 次）', attempt + 1)
                continue
        except Exception as exc:
            logger.warning('引用校验异常（第 %s 次）：%s', attempt + 1, exc)
            continue

        text = _clean_text(raw_text)
        if not text:
            continue

        cited_ids = []
        seen = set()
        for fact_id, _ in pairs:
            if fact_id not in seen:
                seen.add(fact_id)
                cited_ids.append(fact_id)

        citations = [
            {'fact_id': fact_id, 'fact_text': fact_by_id[fact_id]['fact_text']}
            for fact_id in cited_ids
        ]
        depth = max(fact_by_id[fact_id]['depth'] for fact_id in cited_ids)

        try:
            audio_url = _ensure_audio(spot_id, dimension, depth, text)
        except Exception as exc:
            logger.warning('音频处理异常：%s', exc)
            audio_url = None

        return {
            'text': text,
            'citations': citations,
            'depth': depth,
            'audio_url': audio_url,
            'fallback': False,
        }

    return fallback_response()
