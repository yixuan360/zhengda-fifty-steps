"""
文脉叙事引擎 T3 — 内容管线测试

覆盖：LLM 客户端缺 key、ingest 正常拆解 / 非法字段跳过 / 去重 / dry-run /
维度过滤 / 异常路径，以及 enrich 补源与 confidence 升级。
LLM 全程 mock，不联网。
"""
import json

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError

from apps.narrative import llm_client
from apps.narrative.models import KnowledgeItem
from apps.spots.models import Spot

pytestmark = pytest.mark.django_db


@pytest.fixture
def spot():
    return Spot.objects.create(
        name='钟楼', lat=34.8166, lng=113.5345,
        description='钟楼是郑州大学主校区的标志性建筑，建于 1956 年。',
    )


@pytest.fixture
def other_spot():
    return Spot.objects.create(
        name='眉湖', lat=34.8150, lng=113.5330,
        description='眉湖是郑州大学主校区的人工湖。',
    )


@pytest.fixture
def llm(monkeypatch):
    """替换 llm_client.chat_json，并记录每次调用的 Prompt。"""
    state = {'calls': [], 'payload': {'cards': []}, 'error': None}

    def fake_chat_json(system_prompt, user_prompt, json_schema):
        state['calls'].append({
            'system': system_prompt,
            'user': user_prompt,
            'schema': json_schema,
        })
        if state['error'] is not None:
            raise state['error']
        return state['payload']

    monkeypatch.setattr(llm_client, 'chat_json', fake_chat_json)
    return state


def make_card(**overrides):
    card = {
        'dimension': 'architecture',
        'depth': 1,
        'fact_text': '钟楼是郑州大学主校区的标志性建筑。',
        'source_refs': [
            {'title': '郑州大学官网', 'url': 'https://www.zzu.edu.cn/'},
        ],
        'confidence': 'single',
    }
    card.update(overrides)
    return card


def make_item(spot, **overrides):
    data = {
        'spot': spot,
        'dimension': 'architecture',
        'depth': 1,
        'fact_text': '钟楼是主校区的标志性建筑。',
        'status': 'pending',
    }
    data.update(overrides)
    return KnowledgeItem.objects.create(**data)


# ═══════════════════════════════════════════════════════════
# llm_client
# ═══════════════════════════════════════════════════════════

def test_chat_json_requires_api_key(monkeypatch):
    monkeypatch.setattr(llm_client, 'config', lambda name, default='': '')
    with pytest.raises(RuntimeError, match='NARRATIVE_LLM_API_KEY 未配置'):
        llm_client.chat_json('系统', '用户', {})


def test_chat_json_requires_model(monkeypatch):
    monkeypatch.setattr(
        llm_client, 'config',
        lambda name, default='': 'test-key' if name.endswith('API_KEY') else '',
    )
    with pytest.raises(RuntimeError, match='NARRATIVE_LLM_MODEL 未配置'):
        llm_client.chat_json('系统', '用户', {})


# ── json_schema 被拒时的 json_object 回退 ─────────────────

SIMPLE_SCHEMA = {
    'type': 'object',
    'properties': {'cards': {'type': 'array'}},
    'required': ['cards'],
    'additionalProperties': False,
}


class FakeBadRequestError(Exception):
    """替代 openai.BadRequestError，避免构造真实 HTTP 响应。"""


class _FakeMessage:
    def __init__(self, content):
        self.content = content


class _FakeChoice:
    def __init__(self, content):
        self.message = _FakeMessage(content)


class _FakeResponse:
    def __init__(self, content):
        self.choices = [_FakeChoice(content)]


class _FakeCompletions:
    def __init__(self, results):
        self.results = results
        self.calls = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        result = self.results[len(self.calls) - 1]
        if isinstance(result, Exception):
            raise result
        return result


class _FakeChat:
    def __init__(self, completions):
        self.completions = completions


class _FakeOpenAI:
    def __init__(self, completions):
        self.chat = _FakeChat(completions)


def _patch_llm_client(monkeypatch, results):
    completions = _FakeCompletions(results)
    monkeypatch.setattr(
        llm_client, 'config', lambda name, default='': 'test-value',
    )
    monkeypatch.setattr(llm_client, 'BadRequestError', FakeBadRequestError)
    monkeypatch.setattr(
        llm_client, 'OpenAI', lambda **kwargs: _FakeOpenAI(completions),
    )
    return completions


def test_chat_json_falls_back_to_json_object_on_bad_request(monkeypatch):
    completions = _patch_llm_client(monkeypatch, [
        FakeBadRequestError('json_schema not supported'),
        _FakeResponse('{"cards": [{"dimension": "nature"}]}'),
    ])

    result = llm_client.chat_json('系统', '用户', SIMPLE_SCHEMA)

    assert result == {'cards': [{'dimension': 'nature'}]}
    assert len(completions.calls) == 2
    assert completions.calls[0]['response_format']['type'] == 'json_schema'
    assert completions.calls[1]['response_format'] == {'type': 'json_object'}


def test_chat_json_fallback_invalid_json_raises(monkeypatch):
    completions = _patch_llm_client(monkeypatch, [
        FakeBadRequestError('json_schema not supported'),
        _FakeResponse('这不是 JSON'),
    ])

    with pytest.raises(json.JSONDecodeError):
        llm_client.chat_json('系统', '用户', SIMPLE_SCHEMA)
    assert len(completions.calls) == 2


def test_chat_json_fallback_schema_mismatch_raises(monkeypatch):
    _patch_llm_client(monkeypatch, [
        FakeBadRequestError('json_schema not supported'),
        _FakeResponse('{"wrong": []}'),
    ])

    with pytest.raises(ValueError, match='缺少字段 cards'):
        llm_client.chat_json('系统', '用户', SIMPLE_SCHEMA)


# ═══════════════════════════════════════════════════════════
# ingest_facts
# ═══════════════════════════════════════════════════════════

def test_ingest_creates_pending_cards(spot, llm):
    llm['payload'] = {'cards': [
        make_card(depth=1),
        make_card(
            dimension='history', depth=2,
            fact_text='钟楼建于 1956 年，是主校区最早建成的建筑之一。',
            source_refs=[], confidence='single',
        ),
    ]}

    call_command('ingest_facts', '--spot-id', str(spot.id))

    items = KnowledgeItem.objects.filter(spot=spot).order_by('depth')
    assert items.count() == 2
    for item in items:
        assert item.status == 'pending'
        assert item.created_by == 'ai'
    assert items[0].fact_text == make_card()['fact_text']
    assert items[0].source_refs == make_card()['source_refs']
    assert items[1].dimension == 'history'


def test_ingest_prompts_are_chinese_and_include_description(spot, llm):
    llm['payload'] = {'cards': [make_card()]}
    call_command('ingest_facts', '--spot-id', str(spot.id))

    call = llm['calls'][0]
    assert '事实卡片' in call['system']
    assert '只能' in call['system']
    assert 'source_refs' in call['system']
    assert '景点介绍' in call['user']
    assert spot.description in call['user']


def test_ingest_skips_invalid_cards_and_warns(spot, llm, capsys):
    llm['payload'] = {'cards': [
        make_card(dimension='bogus'),
        make_card(depth=9),
        make_card(fact_text='   '),
        make_card(fact_text='一条合法的事实卡片。'),
    ]}

    call_command('ingest_facts', '--spot-id', str(spot.id))

    assert KnowledgeItem.objects.filter(spot=spot).count() == 1
    captured = capsys.readouterr()
    assert '跳过非法 3 条' in captured.out
    assert '3 条非法卡片被跳过' in captured.err


def test_ingest_dedupes_same_dimension_and_depth_keeping_longest(spot, llm):
    short_text = '钟楼是标志性建筑。'
    long_text = '钟楼是郑州大学主校区的标志性建筑，也是校徽图案的原型。'
    llm['payload'] = {'cards': [
        make_card(depth=2, fact_text=short_text),
        make_card(depth=2, fact_text=long_text),
    ]}

    call_command('ingest_facts', '--spot-id', str(spot.id))

    items = KnowledgeItem.objects.filter(spot=spot)
    assert items.count() == 1
    assert items.get().fact_text == long_text


def test_ingest_dry_run_prints_jsonl_without_writing(spot, llm, capsys):
    llm['payload'] = {'cards': [
        make_card(depth=1, fact_text='卡片甲'),
        make_card(depth=2, fact_text='卡片乙'),
    ]}

    call_command('ingest_facts', '--spot-id', str(spot.id), '--dry-run')

    assert KnowledgeItem.objects.filter(spot=spot).count() == 0
    captured = capsys.readouterr()
    lines = [line for line in captured.out.splitlines() if line.strip()]
    assert len(lines) == 2
    parsed = [json.loads(line) for line in lines]
    assert {entry['fact_text'] for entry in parsed} == {'卡片甲', '卡片乙'}
    assert all(entry['spot_id'] == spot.id for entry in parsed)
    assert 'dry-run 未入库' in captured.err


def test_ingest_dimension_filter(spot, llm, capsys):
    llm['payload'] = {'cards': [
        make_card(dimension='nature', depth=1, fact_text='自然卡片'),
        make_card(dimension='architecture', depth=1, fact_text='建筑卡片'),
    ]}

    call_command(
        'ingest_facts', '--spot-id', str(spot.id), '--dimension', 'nature',
    )

    items = KnowledgeItem.objects.filter(spot=spot)
    assert items.count() == 1
    assert items.get().dimension == 'nature'
    assert '过滤非指定维度 1 条' in capsys.readouterr().out


def test_ingest_unknown_spot_raises():
    with pytest.raises(CommandError, match='景点不存在'):
        call_command('ingest_facts', '--spot-id', '9999999')


def test_ingest_llm_failure_raises_command_error(spot, llm):
    llm['error'] = RuntimeError('上游不可用')
    with pytest.raises(CommandError, match='拆解失败'):
        call_command('ingest_facts', '--spot-id', str(spot.id))


def test_ingest_multiple_spots(spot, other_spot, llm):
    llm['payload'] = {'cards': [make_card()]}
    call_command(
        'ingest_facts',
        '--spot-id', str(spot.id), '--spot-id', str(other_spot.id),
    )
    assert KnowledgeItem.objects.filter(spot=spot).count() == 1
    assert KnowledgeItem.objects.filter(spot=other_spot).count() == 1


# ═══════════════════════════════════════════════════════════
# enrich_sources
# ═══════════════════════════════════════════════════════════

def test_enrich_merges_sources_and_upgrades_confidence(spot, llm):
    item = make_item(spot, source_refs=[
        {'title': '郑州大学官网', 'url': 'https://www.zzu.edu.cn/'},
    ])
    llm['payload'] = {'sources': [
        {'title': '郑州大学校史馆', 'url': 'https://history.zzu.edu.cn/zhonglou'},
    ]}

    call_command('enrich_sources', '--spot-id', str(spot.id))

    item.refresh_from_db()
    assert len(item.source_refs) == 2
    assert item.confidence == 'cross'


def test_enrich_keeps_single_when_no_new_source(spot, llm):
    item = make_item(spot, source_refs=[
        {'title': '郑州大学官网', 'url': 'https://www.zzu.edu.cn/'},
    ])
    llm['payload'] = {'sources': []}

    call_command('enrich_sources', '--spot-id', str(spot.id))

    item.refresh_from_db()
    assert len(item.source_refs) == 1
    assert item.confidence == 'single'


def test_enrich_drops_duplicate_and_malformed_sources(spot, llm):
    item = make_item(spot, source_refs=[
        {'title': '郑州大学官网', 'url': 'https://www.zzu.edu.cn/'},
    ])
    llm['payload'] = {'sources': [
        {'title': '重复来源', 'url': 'https://www.zzu.edu.cn/'},
        {'title': '缺链接'},
        {'title': '校史馆', 'url': 'https://history.zzu.edu.cn/zhonglou'},
    ]}

    call_command('enrich_sources', '--spot-id', str(spot.id))

    item.refresh_from_db()
    assert [ref['title'] for ref in item.source_refs] == [
        '郑州大学官网', '校史馆',
    ]


def test_enrich_only_touches_pending_items(spot, llm):
    pending = make_item(spot, fact_text='待审卡片')
    approved = make_item(spot, fact_text='已发布卡片', status='approved')
    llm['payload'] = {'sources': [
        {'title': '校史馆', 'url': 'https://history.zzu.edu.cn/a'},
    ]}

    call_command('enrich_sources', '--spot-id', str(spot.id))

    pending.refresh_from_db()
    approved.refresh_from_db()
    assert len(pending.source_refs) == 1
    assert approved.source_refs == []
    assert len(llm['calls']) == 1


def test_enrich_is_idempotent(spot, llm):
    make_item(spot, source_refs=[
        {'title': '郑州大学官网', 'url': 'https://www.zzu.edu.cn/'},
    ])
    llm['payload'] = {'sources': [
        {'title': '校史馆', 'url': 'https://history.zzu.edu.cn/zhonglou'},
    ]}

    call_command('enrich_sources', '--spot-id', str(spot.id))
    call_command('enrich_sources', '--spot-id', str(spot.id))

    item = KnowledgeItem.objects.get(spot=spot)
    assert len(item.source_refs) == 2
    assert item.confidence == 'cross'


def test_enrich_all_failures_raise(spot, llm):
    make_item(spot)
    llm['error'] = RuntimeError('上游不可用')
    with pytest.raises(CommandError, match='全部卡片补源失败'):
        call_command('enrich_sources', '--spot-id', str(spot.id))
