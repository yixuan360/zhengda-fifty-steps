"""
文脉叙事引擎 — Chroma 向量库封装（T2）

只存已发布（approved）的事实卡片；collection 名固定为 knowledge_items，
document = fact_text，metadata = {knowledge_id, spot_id, dimension, depth, confidence}。

T4 的 Agent 服务直接读取同一持久化目录，不经过 Django；本模块只负责写入与
供 T3 复用的读取工具。
"""
from django.conf import settings

COLLECTION_NAME = 'knowledge_items'


def get_collection(embedding_function=None, client=None):
    """获取或创建 knowledge_items collection。

    生产调用不传参数：使用 Chroma 默认 embedding（首次会下载模型）。
    embedding_function / client 仅用于测试注入，避免测试联网下载模型。
    """
    import chromadb

    if client is None:
        client = chromadb.PersistentClient(path=str(settings.NARRATIVE_VECTOR_DIR))

    kwargs = {}
    if embedding_function is not None:
        kwargs['embedding_function'] = embedding_function

    return client.get_or_create_collection(
        name=COLLECTION_NAME,
        metadata={'hnsw:space': 'cosine'},
        **kwargs,
    )


def _item_metadata(item):
    """Chroma metadata 只接受标量，字段与 T4 检索契约保持一致。"""
    return {
        'knowledge_id': item.id,
        'spot_id': item.spot_id,
        'dimension': item.dimension,
        'depth': item.depth,
        'confidence': item.confidence,
    }


def upsert_item(item, collection=None):
    """写入/更新一张事实卡片（document=fact_text）。"""
    collection = collection or get_collection()
    collection.upsert(
        ids=[str(item.id)],
        documents=[item.fact_text],
        metadatas=[_item_metadata(item)],
    )


def delete_item(knowledge_id, collection=None):
    """从向量库移除一张卡片；id 不存在时为无害空操作。"""
    collection = collection or get_collection()
    collection.delete(ids=[str(knowledge_id)])


def get_spot_items(spot_id, dimension=None, depth_max=None, collection=None):
    """按 spot / dimension / depth 上限过滤读取事实卡片。

    返回 [{'fact_id', 'knowledge_id', 'fact_text', 'spot_id', 'dimension',
    'depth', 'confidence'}]，按 (depth, fact_id) 升序，供 T4 检索使用。
    """
    collection = collection or get_collection()
    result = collection.get(where=_build_where(spot_id, dimension, depth_max))

    ids = result.get('ids') or []
    documents = result.get('documents') or []
    metadatas = result.get('metadatas') or []

    items = []
    for index, doc_id in enumerate(ids):
        metadata = metadatas[index] if index < len(metadatas) else {}
        metadata = metadata or {}
        items.append({
            'fact_id': int(doc_id),
            'knowledge_id': int(doc_id),
            'fact_text': documents[index] if index < len(documents) else '',
            'spot_id': metadata.get('spot_id'),
            'dimension': metadata.get('dimension'),
            'depth': metadata.get('depth'),
            'confidence': metadata.get('confidence'),
        })

    items.sort(key=lambda entry: (entry['depth'], entry['fact_id']))
    return items


def _build_where(spot_id, dimension=None, depth_max=None):
    """构造 Chroma metadata 过滤条件（spot 必选）。"""
    conditions = [{'spot_id': spot_id}]
    if dimension:
        conditions.append({'dimension': dimension})
    if depth_max is not None:
        conditions.append({'depth': {'$lte': depth_max}})
    return conditions[0] if len(conditions) == 1 else {'$and': conditions}
