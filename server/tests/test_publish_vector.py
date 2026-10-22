"""
文脉叙事引擎 T2 — Chroma 向量库 + 发布命令测试

测试全程使用 EphemeralClient + 假 embedding 函数，不联网、不下载默认模型。
"""
import uuid

import chromadb
import pytest
from chromadb import EmbeddingFunction
from django.core.management import call_command

from apps.narrative import vector_store
from apps.narrative.models import KnowledgeItem
from apps.spots.models import Spot

pytestmark = pytest.mark.django_db


class FakeEmbeddingFunction(EmbeddingFunction):
    """确定性假 embedding：只用于测试，避免 Chroma 首次运行下载模型。"""

    def __init__(self):
        pass

    def __call__(self, input):
        return [
            [float(len(text)), float(text.count('钟')), 1.0]
            for text in input
        ]

    @staticmethod
    def name():
        return 'fake-test-embedding'

    def get_config(self):
        return {}

    @staticmethod
    def build_from_config(config):
        return FakeEmbeddingFunction()


@pytest.fixture
def collection():
    """每个用例一个全新的内存 collection（随机名，避免用例间串数据）。"""
    client = chromadb.EphemeralClient()
    return client.get_or_create_collection(
        name=f'test_knowledge_items_{uuid.uuid4().hex}',
        metadata={'hnsw:space': 'cosine'},
        embedding_function=FakeEmbeddingFunction(),
    )


@pytest.fixture
def patched_collection(monkeypatch, collection):
    """让 vector_store 的所有读写都落到测试 collection。"""
    monkeypatch.setattr(
        vector_store, 'get_collection', lambda *args, **kwargs: collection,
    )
    return collection


@pytest.fixture
def spot():
    return Spot.objects.create(
        name='钟楼', lat=34.8166, lng=113.5345,
        description='郑州大学主校区钟楼。',
    )


@pytest.fixture
def other_spot():
    return Spot.objects.create(
        name='眉湖', lat=34.8150, lng=113.5330,
        description='郑州大学主校区眉湖。',
    )


def make_item(spot, *, status='approved', dimension='architecture', depth=1,
              fact_text='钟楼是郑州大学主校区的标志性建筑。', confidence='single'):
    return KnowledgeItem.objects.create(
        spot=spot, dimension=dimension, depth=depth, fact_text=fact_text,
        status=status, confidence=confidence,
    )


# ═══════════════════════════════════════════════════════════
# vector_store 基础读写
# ═══════════════════════════════════════════════════════════

def test_collection_uses_cosine_space(patched_collection):
    assert patched_collection.metadata.get('hnsw:space') == 'cosine'


def test_get_collection_uses_contract_name():
    """生产路径：collection 名固定为 knowledge_items，cosine 空间。"""
    calls = {}

    class FakeClient:
        def get_or_create_collection(self, name, metadata=None, **kwargs):
            calls['name'] = name
            calls['metadata'] = metadata
            calls['kwargs'] = kwargs
            return object()

    vector_store.get_collection(
        client=FakeClient(), embedding_function=FakeEmbeddingFunction(),
    )
    assert calls['name'] == 'knowledge_items'
    assert calls['metadata'] == {'hnsw:space': 'cosine'}


def test_upsert_item_writes_document_and_metadata(patched_collection, spot):
    item = make_item(spot, depth=2, confidence='cross')
    vector_store.upsert_item(item)

    result = patched_collection.get(ids=[str(item.id)])
    assert result['ids'] == [str(item.id)]
    assert result['documents'] == [item.fact_text]
    assert result['metadatas'][0] == {
        'knowledge_id': item.id,
        'spot_id': spot.id,
        'dimension': 'architecture',
        'depth': 2,
        'confidence': 'cross',
    }


def test_upsert_item_updates_existing_entry(patched_collection, spot):
    item = make_item(spot)
    vector_store.upsert_item(item)

    item.fact_text = '钟楼建于 1956 年，是主校区最早建成的建筑之一。'
    item.depth = 3
    item.save(update_fields=['fact_text', 'depth'])
    vector_store.upsert_item(item)

    result = patched_collection.get(ids=[str(item.id)])
    assert len(result['ids']) == 1
    assert result['documents'] == [item.fact_text]
    assert result['metadatas'][0]['depth'] == 3


def test_delete_item_removes_entry(patched_collection, spot):
    item = make_item(spot)
    vector_store.upsert_item(item)
    vector_store.delete_item(item.id)
    assert patched_collection.get(ids=[str(item.id)])['ids'] == []


def test_delete_missing_item_is_noop(patched_collection):
    vector_store.delete_item(999999)
    assert patched_collection.count() == 0


# ═══════════════════════════════════════════════════════════
# 过滤读取（T4 复用）
# ═══════════════════════════════════════════════════════════

def test_get_spot_items_filters_by_spot(patched_collection, spot, other_spot):
    mine = make_item(spot, fact_text='钟楼的卡片')
    theirs = make_item(other_spot, fact_text='眉湖的卡片')
    vector_store.upsert_item(mine)
    vector_store.upsert_item(theirs)

    items = vector_store.get_spot_items(spot.id)
    assert [entry['fact_id'] for entry in items] == [mine.id]


def test_get_spot_items_filters_dimension_and_depth(patched_collection, spot):
    nature_l1 = make_item(spot, dimension='nature', depth=1, fact_text='自然一')
    nature_l3 = make_item(spot, dimension='nature', depth=3, fact_text='自然三')
    arch_l2 = make_item(spot, dimension='architecture', depth=2, fact_text='建筑二')
    for item in (nature_l1, nature_l3, arch_l2):
        vector_store.upsert_item(item)

    nature_all = vector_store.get_spot_items(spot.id, dimension='nature')
    assert [entry['fact_id'] for entry in nature_all] == [nature_l1.id, nature_l3.id]

    nature_shallow = vector_store.get_spot_items(
        spot.id, dimension='nature', depth_max=2,
    )
    assert [entry['fact_id'] for entry in nature_shallow] == [nature_l1.id]

    everything = vector_store.get_spot_items(spot.id, depth_max=2)
    assert [entry['fact_id'] for entry in everything] == [nature_l1.id, arch_l2.id]


def test_get_spot_items_returns_fact_text(patched_collection, spot):
    item = make_item(spot, fact_text='钟楼南侧正对主校门。')
    vector_store.upsert_item(item)

    entry = vector_store.get_spot_items(spot.id)[0]
    assert entry['fact_id'] == item.id
    assert entry['knowledge_id'] == item.id
    assert entry['fact_text'] == '钟楼南侧正对主校门。'
    assert entry['spot_id'] == spot.id
    assert entry['dimension'] == 'architecture'
    assert entry['depth'] == 1
    assert entry['confidence'] == 'single'


# ═══════════════════════════════════════════════════════════
# publish_vector 命令
# ═══════════════════════════════════════════════════════════

def test_publish_only_syncs_approved_items(patched_collection, spot, capsys):
    approved_a = make_item(spot, fact_text='已发布甲')
    approved_b = make_item(spot, fact_text='已发布乙')
    pending = make_item(spot, status='pending', fact_text='待人审')
    rejected = make_item(spot, status='rejected', fact_text='已驳回')

    call_command('publish_vector')

    stored_ids = set(patched_collection.get()['ids'])
    assert stored_ids == {str(approved_a.id), str(approved_b.id)}
    assert str(pending.id) not in stored_ids
    assert str(rejected.id) not in stored_ids

    output = capsys.readouterr().out
    assert 'upsert 2 条' in output
    assert 'delete 2 条' in output


def test_publish_removes_items_after_status_change(patched_collection, spot):
    item = make_item(spot)
    call_command('publish_vector')
    assert patched_collection.get(ids=[str(item.id)])['ids'] == [str(item.id)]

    item.status = 'rejected'
    item.save(update_fields=['status'])
    call_command('publish_vector')

    assert patched_collection.get(ids=[str(item.id)])['ids'] == []


def test_publish_spot_id_limits_scope(patched_collection, spot, other_spot):
    mine = make_item(spot, fact_text='钟楼的卡片')
    theirs = make_item(other_spot, fact_text='眉湖的卡片')

    call_command('publish_vector', spot_id=spot.id)

    stored_ids = set(patched_collection.get()['ids'])
    assert str(mine.id) in stored_ids
    assert str(theirs.id) not in stored_ids


def test_publish_is_idempotent(patched_collection, spot):
    item = make_item(spot)
    call_command('publish_vector')
    call_command('publish_vector')
    result = patched_collection.get(ids=[str(item.id)])
    assert result['ids'] == [str(item.id)]
    assert patched_collection.count() == 1
