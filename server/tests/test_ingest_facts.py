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
from apps.narrative.management.commands import enrich_sources as enrich_command
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


class FakeResponse:
    def __init__(self, status_code):
        self.status_code = status_code

    def close(self):
        pass


@pytest.fixture(autouse=True)
def reachable_requests(monkeypatch):
    """默认所有来源 URL 可达（2xx），测试全程不联网。"""
    monkeypatch.setattr(
        enrich_command.requests, 'head', lambda *args, **kwargs: FakeResponse(200),
    )
    monkeypatch.setattr(
        enrich_command.requests, 'get', lambda *args, **kwargs: FakeResponse(200),
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
            {'title': '郑州大学官网', 'url': 'https://www.zzu.edu.cn/xxgk/xxjj.htm'},
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
    assert '只产出素材真正支持的 dimension' in call['system']
    assert '每个被覆盖的 dimension 至少产出 1 张 depth=1' in call['system']
    assert 'academy 仅限学科设置' in call['system']
    assert '校训、题词、历史事件、建设沿革一律归 history' in call['system']
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


def test_ingest_dedupes_only_contained_facts(spot, llm):
    """一条完整包含另一条的核心信息时，只保留较长者。"""
    short_text = '钟楼是主校区制高点。'
    long_text = '钟楼是主校区制高点，高 56 米。'
    llm['payload'] = {'cards': [
        make_card(depth=2, fact_text=short_text),
        make_card(depth=2, fact_text=long_text),
    ]}

    call_command('ingest_facts', '--spot-id', str(spot.id))

    items = KnowledgeItem.objects.filter(spot=spot)
    assert items.count() == 1
    assert items.get().fact_text == long_text


def test_ingest_keeps_distinct_facts_at_same_depth(spot, llm):
    """同层不同事实必须并存，不再按“最长一条”误删。"""
    llm['payload'] = {'cards': [
        make_card(depth=2, fact_text='钟楼采用红砖外立面。'),
        make_card(depth=2, fact_text='钟楼每小时准时鸣钟。'),
    ]}

    call_command('ingest_facts', '--spot-id', str(spot.id))

    items = KnowledgeItem.objects.filter(spot=spot)
    assert items.count() == 2
    assert set(items.values_list('fact_text', flat=True)) == {
        '钟楼采用红砖外立面。',
        '钟楼每小时准时鸣钟。',
    }


def test_ingest_dedupes_near_identical_paraphrases(spot, llm):
    llm['payload'] = {'cards': [
        make_card(depth=2, fact_text='钟楼是主校区的制高点。'),
        make_card(depth=2, fact_text='钟楼是主校区制高点。'),
    ]}

    call_command('ingest_facts', '--spot-id', str(spot.id))

    assert KnowledgeItem.objects.filter(spot=spot).count() == 1


def test_ingest_keeps_facts_with_different_numbers(spot, llm):
    """高度相似但数字不同，属于不同事实，不能去重。"""
    llm['payload'] = {'cards': [
        make_card(depth=2, fact_text='钟楼总高度为 56 米，是主校区制高点。'),
        make_card(depth=2, fact_text='钟楼总高度为 58 米，是主校区制高点。'),
    ]}

    call_command('ingest_facts', '--spot-id', str(spot.id))

    assert KnowledgeItem.objects.filter(spot=spot).count() == 2


def test_ingest_reports_depth1_coverage(spot, llm, capsys):
    llm['payload'] = {'cards': [
        make_card(dimension='nature', depth=1, fact_text='自然概览'),
        make_card(dimension='history', depth=1, fact_text='历史概览'),
        make_card(dimension='architecture', depth=2, fact_text='建筑细节'),
    ]}

    call_command('ingest_facts', '--spot-id', str(spot.id))

    captured = capsys.readouterr()
    assert 'nature（自然山水）：有' in captured.out
    assert 'architecture（建筑肌理）：无' in captured.out
    assert 'academy（学科人文）：无' in captured.out
    assert 'history（校史城史）：有' in captured.out
    # 诚实稀疏：academy 完全没有素材，不告警；architecture 有素材但缺 d1，告警
    assert 'depth=1 概览层未覆盖：architecture' in captured.err
    assert 'academy' not in captured.err


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
        {'title': '郑州大学官网', 'url': 'https://www.zzu.edu.cn/xxgk/xxjj.htm'},
    ])
    llm['payload'] = {'sources': [
        {'title': '郑州大学校史馆', 'url': 'https://history.zzu.edu.cn/zhonglou'},
    ]}

    call_command('enrich_sources', '--spot-id', str(spot.id))

    item.refresh_from_db()
    assert len(item.source_refs) == 2
    assert item.confidence == 'cross'


def test_enrich_upgrades_zero_source_card_with_two_sources(spot, llm):
    item = make_item(spot, source_refs=[])
    llm['payload'] = {'sources': [
        {'title': '郑州大学官网', 'url': 'https://www.zzu.edu.cn/xxgk/xxjj.htm'},
        {'title': '郑州大学校史馆', 'url': 'https://history.zzu.edu.cn/zhonglou'},
    ]}

    call_command('enrich_sources', '--spot-id', str(spot.id))

    item.refresh_from_db()
    assert len(item.source_refs) == 2
    assert item.confidence == 'cross'


def test_enrich_keeps_single_with_only_one_added_source(spot, llm):
    item = make_item(spot, source_refs=[])
    llm['payload'] = {'sources': [
        {'title': '郑州大学官网', 'url': 'https://www.zzu.edu.cn/xxgk/xxjj.htm'},
    ]}

    call_command('enrich_sources', '--spot-id', str(spot.id))

    item.refresh_from_db()
    assert len(item.source_refs) == 1
    assert item.confidence == 'single'


def test_enrich_keeps_single_when_no_new_source(spot, llm):
    item = make_item(spot, source_refs=[
        {'title': '郑州大学官网', 'url': 'https://www.zzu.edu.cn/xxgk/xxjj.htm'},
    ])
    llm['payload'] = {'sources': []}

    call_command('enrich_sources', '--spot-id', str(spot.id))

    item.refresh_from_db()
    assert len(item.source_refs) == 1
    assert item.confidence == 'single'


def test_enrich_drops_duplicate_and_malformed_sources(spot, llm):
    item = make_item(spot, source_refs=[
        {'title': '郑州大学官网', 'url': 'https://www.zzu.edu.cn/xxgk/xxjj.htm'},
    ])
    llm['payload'] = {'sources': [
        {'title': '重复来源', 'url': 'https://www.zzu.edu.cn/xxgk/xxjj.htm'},
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
        {'title': '郑州大学官网', 'url': 'https://www.zzu.edu.cn/xxgk/xxjj.htm'},
    ])
    llm['payload'] = {'sources': [
        {'title': '校史馆', 'url': 'https://history.zzu.edu.cn/zhonglou'},
    ]}

    call_command('enrich_sources', '--spot-id', str(spot.id))
    call_command('enrich_sources', '--spot-id', str(spot.id))

    item = KnowledgeItem.objects.get(spot=spot)
    assert len(item.source_refs) == 2
    assert item.confidence == 'cross'


def test_enrich_approved_status_upgrades_to_cross(spot, llm):
    """--status approved：人审通过的卡片同样可补源并升 cross。"""
    item = make_item(spot, status='approved', source_refs=[])
    llm['payload'] = {'sources': [
        {'title': '郑州大学官网', 'url': 'https://www.zzu.edu.cn/xxgk/xxjj.htm'},
        {'title': '郑州大学校史馆', 'url': 'https://xsg.zzu.edu.cn/zhonglou'},
    ]}

    call_command('enrich_sources', '--spot-id', str(spot.id), '--status', 'approved')

    item.refresh_from_db()
    assert len(item.source_refs) == 2
    assert item.confidence == 'cross'
    assert item.status == 'approved'


def test_enrich_default_status_ignores_approved(spot, llm):
    """默认 pending 模式行为不变：已发布卡片不处理。"""
    approved = make_item(spot, status='approved', fact_text='已发布卡片')
    pending = make_item(spot, fact_text='待审卡片')
    llm['payload'] = {'sources': [
        {'title': '郑州大学官网', 'url': 'https://www.zzu.edu.cn/xxgk/xxjj.htm'},
    ]}

    call_command('enrich_sources', '--spot-id', str(spot.id))

    approved.refresh_from_db()
    pending.refresh_from_db()
    assert approved.source_refs == []
    assert approved.confidence == 'single'
    assert len(pending.source_refs) == 1
    assert len(llm['calls']) == 1


def test_enrich_reports_when_no_cards_match_status(spot, llm, capsys):
    make_item(spot, status='approved')

    call_command('enrich_sources', '--spot-id', str(spot.id))

    assert llm['calls'] == []
    assert '没有「待审」状态的卡片需要补源' in capsys.readouterr().out


def test_enrich_reports_when_spot_has_no_cards(llm, capsys):
    call_command('enrich_sources', '--spot-id', '999999', '--status', 'approved')

    assert llm['calls'] == []
    assert '没有「已发布」状态的卡片需要补源' in capsys.readouterr().out


def test_enrich_all_failures_raise(spot, llm):
    make_item(spot)
    llm['error'] = RuntimeError('上游不可用')
    with pytest.raises(CommandError, match='全部卡片补源失败'):
        call_command('enrich_sources', '--spot-id', str(spot.id))


# ── 来源 URL 可达性校验 ──────────────────────────────────

def _patch_url_status(monkeypatch, status_by_url):
    """按 URL 返回指定状态码；未配置的 URL 视为 200。"""

    def fake_request(url, *args, **kwargs):
        return FakeResponse(status_by_url.get(url, 200))

    monkeypatch.setattr(enrich_command.requests, 'head', fake_request)
    monkeypatch.setattr(enrich_command.requests, 'get', fake_request)


def test_enrich_keeps_reachable_source(spot, llm, monkeypatch):
    _patch_url_status(monkeypatch, {'https://ok.example.com/a': 200})
    item = make_item(spot, source_refs=[])
    llm['payload'] = {'sources': [
        {'title': '可达来源', 'url': 'https://ok.example.com/a'},
    ]}

    call_command('enrich_sources', '--spot-id', str(spot.id))

    item.refresh_from_db()
    assert [ref['url'] for ref in item.source_refs] == ['https://ok.example.com/a']
    assert item.confidence == 'single'


def test_enrich_drops_404_source(spot, llm, monkeypatch, capsys):
    _patch_url_status(monkeypatch, {'https://ok.example.com/a': 404})
    item = make_item(spot, source_refs=[])
    llm['payload'] = {'sources': [
        {'title': '失效来源', 'url': 'https://ok.example.com/a'},
    ]}

    call_command('enrich_sources', '--spot-id', str(spot.id))

    item.refresh_from_db()
    assert item.source_refs == []
    captured = capsys.readouterr()
    assert '1 个来源 URL 不可达' in captured.err
    assert '丢弃不可达来源 1 个' in captured.out


def test_enrich_drops_403_source(spot, llm, monkeypatch):
    _patch_url_status(monkeypatch, {'https://baike.example.com/a': 403})
    item = make_item(spot, source_refs=[])
    llm['payload'] = {'sources': [
        {'title': '反爬来源', 'url': 'https://baike.example.com/a'},
    ]}

    call_command('enrich_sources', '--spot-id', str(spot.id))

    item.refresh_from_db()
    assert item.source_refs == []
    assert item.confidence == 'single'


def test_enrich_drops_timeout_source(spot, llm, monkeypatch):
    def timeout(*args, **kwargs):
        raise enrich_command.requests.Timeout('timed out')

    monkeypatch.setattr(enrich_command.requests, 'head', timeout)
    monkeypatch.setattr(enrich_command.requests, 'get', timeout)

    item = make_item(spot, source_refs=[])
    llm['payload'] = {'sources': [
        {'title': '超时来源', 'url': 'https://slow.example.com/a'},
    ]}

    call_command('enrich_sources', '--spot-id', str(spot.id))

    item.refresh_from_db()
    assert item.source_refs == []


def test_enrich_recomputes_confidence_after_filtering(spot, llm, monkeypatch):
    """两个来源只剩一个可达 → 不能升 cross。"""
    _patch_url_status(monkeypatch, {
        'https://ok.example.com/a': 200,
        'https://dead.example.com/b': 404,
    })
    item = make_item(spot, source_refs=[])
    llm['payload'] = {'sources': [
        {'title': '可达来源', 'url': 'https://ok.example.com/a'},
        {'title': '失效来源', 'url': 'https://dead.example.com/b'},
    ]}

    call_command('enrich_sources', '--spot-id', str(spot.id))

    item.refresh_from_db()
    assert len(item.source_refs) == 1
    assert item.confidence == 'single'


def test_enrich_drops_homepage_url(spot, llm, monkeypatch, capsys):
    """纯首页 URL（path 为空或 "/"）不可作为可核验来源。"""
    item = make_item(spot, source_refs=[])
    llm['payload'] = {'sources': [
        {'title': '站点首页', 'url': 'https://www.example.com/'},
        {'title': '无路径', 'url': 'https://www.example.com'},
    ]}

    call_command('enrich_sources', '--spot-id', str(spot.id))

    item.refresh_from_db()
    assert item.source_refs == []
    assert item.confidence == 'single'
    captured = capsys.readouterr()
    assert '2 个来源为纯首页 URL' in captured.err
    assert '丢弃不可达来源 2 个' in captured.out


def test_enrich_keeps_url_with_path(spot, llm, monkeypatch):
    _patch_url_status(monkeypatch, {'https://www.example.com/about/x': 200})
    item = make_item(spot, source_refs=[])
    llm['payload'] = {'sources': [
        {'title': '具体页面', 'url': 'https://www.example.com/about/x'},
    ]}

    call_command('enrich_sources', '--spot-id', str(spot.id))

    item.refresh_from_db()
    assert [ref['url'] for ref in item.source_refs] == [
        'https://www.example.com/about/x',
    ]


def test_enrich_falls_back_to_get_when_head_fails(spot, llm, monkeypatch):
    """HEAD 返回 405 时回退 GET；GET 2xx 则保留。"""
    monkeypatch.setattr(
        enrich_command.requests, 'head', lambda *a, **k: FakeResponse(405),
    )
    monkeypatch.setattr(
        enrich_command.requests, 'get', lambda *a, **k: FakeResponse(200),
    )
    item = make_item(spot, source_refs=[])
    llm['payload'] = {'sources': [
        {'title': '仅 GET 可用', 'url': 'https://head405.example.com/a'},
    ]}

    call_command('enrich_sources', '--spot-id', str(spot.id))

    item.refresh_from_db()
    assert len(item.source_refs) == 1
