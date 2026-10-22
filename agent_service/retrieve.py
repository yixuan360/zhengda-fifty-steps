"""只读 Chroma 检索（不经过 Django，不写任何数据库）。"""
import logging
import os
from pathlib import Path

logger = logging.getLogger(__name__)

COLLECTION_NAME = 'knowledge_items'

_collection = None


def _vector_dir():
    override = os.environ.get('NARRATIVE_VECTOR_DIR', '').strip()
    if override:
        return Path(override)
    # 仓库根/server/vector_db
    return Path(__file__).resolve().parent.parent / 'server' / 'vector_db'


def _get_collection():
    """惰性打开 collection；失败时返回 None，由上层走降级。"""
    global _collection
    if _collection is not None:
        return _collection

    import chromadb

    client = chromadb.PersistentClient(path=str(_vector_dir()))
    try:
        _collection = client.get_collection(COLLECTION_NAME)
    except Exception as exc:
        logger.warning('读取 Chroma collection 失败：%s', exc)
        return None
    return _collection


def get_facts(spot_id, dimension, current_depth, exclude_ids=(), collection=None):
    """按 spot / dimension / depth <= current_depth+1 过滤，并排除已听卡片。

    返回 [{'fact_id', 'fact_text', 'dimension', 'depth'}]，按 (depth, fact_id) 升序。
    """
    if collection is None:
        collection = _get_collection()
    if collection is None:
        return []

    where = {
        '$and': [
            {'spot_id': spot_id},
            {'dimension': dimension},
            {'depth': {'$lte': current_depth + 1}},
        ],
    }

    try:
        result = collection.get(where=where)
    except Exception as exc:
        logger.warning('Chroma 检索失败：%s', exc)
        return []

    exclude = set(exclude_ids or ())
    ids = result.get('ids') or []
    documents = result.get('documents') or []
    metadatas = result.get('metadatas') or []

    facts = []
    for index, raw_id in enumerate(ids):
        try:
            fact_id = int(raw_id)
        except (TypeError, ValueError):
            continue
        if fact_id in exclude:
            continue

        metadata = metadatas[index] if index < len(metadatas) else {}
        metadata = metadata or {}
        try:
            depth = int(metadata.get('depth') or 0)
        except (TypeError, ValueError):
            depth = 0

        facts.append({
            'fact_id': fact_id,
            'fact_text': documents[index] if index < len(documents) else '',
            'dimension': metadata.get('dimension', dimension),
            'depth': depth,
        })

    facts.sort(key=lambda fact: (fact['depth'], fact['fact_id']))
    return facts
