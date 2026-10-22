"""
T4 — Agent 服务测试（全程 mock LLM / embedding / TTS，不联网）。
覆盖：检索过滤、正常生成、引用缺失重试、幻觉校验重试后降级、
空事实降级、音频缓存命中、HTTP 契约与延迟头。
"""
import pytest
from fastapi.testclient import TestClient

from agent_service import generate, llm, main, retrieve


@pytest.fixture
def facts():
    return [
        {'fact_id': 101, 'fact_text': '钟楼建于1956年。',
         'dimension': 'history', 'depth': 2},
        {'fact_id': 102, 'fact_text': '钟楼是校园轴线的中心。',
         'dimension': 'history', 'depth': 2},
    ]


@pytest.fixture
def generate_setup(monkeypatch, facts):
    monkeypatch.setattr(
        generate, 'get_facts', lambda *args, **kwargs: list(facts),
    )
    monkeypatch.setattr(
        generate, '_embed',
        lambda texts: [
            [1.0, 0.0] if '幻觉' in text else [0.0, 1.0]
            for text in texts
        ],
    )
    monkeypatch.setattr(
        generate, '_ensure_audio',
        lambda *args, **kwargs: '/narrative-media/test.mp3',
    )
    return facts


def mock_llm(monkeypatch, texts):
    calls = []

    def fake_generate(system_prompt, user_prompt):
        calls.append((system_prompt, user_prompt))
        return texts[len(calls) - 1]

    monkeypatch.setattr(llm, 'generate', fake_generate)
    return calls


# ═══════════════════════════════════════════════════════════
# retrieve
# ═══════════════════════════════════════════════════════════

class FakeCollection:
    def __init__(self, payload):
        self.payload = payload
        self.where = None

    def get(self, where):
        self.where = where
        return self.payload


def test_get_facts_builds_metadata_filter_and_excludes_listened():
    collection = FakeCollection({
        'ids': ['101', '102', '103'],
        'documents': ['事实一', '事实二', '事实三'],
        'metadatas': [
            {'spot_id': 16, 'dimension': 'history', 'depth': 1},
            {'spot_id': 16, 'dimension': 'history', 'depth': 2},
            {'spot_id': 16, 'dimension': 'history', 'depth': 3},
        ],
    })

    result = retrieve.get_facts(
        16, 'history', 2, exclude_ids=[102], collection=collection,
    )

    assert collection.where == {
        '$and': [
            {'spot_id': 16},
            {'dimension': 'history'},
            {'depth': {'$lte': 3}},
        ],
    }
    assert [fact['fact_id'] for fact in result] == [101, 103]
    assert set(result[0]) == {'fact_id', 'fact_text', 'dimension', 'depth'}


def test_get_facts_returns_empty_on_chroma_error():
    class BrokenCollection:
        def get(self, where):
            raise RuntimeError('chroma down')

    assert retrieve.get_facts(
        16, 'history', 0, collection=BrokenCollection(),
    ) == []


# ═══════════════════════════════════════════════════════════
# 受限生成
# ═══════════════════════════════════════════════════════════

def test_generate_normal_path(generate_setup, monkeypatch):
    calls = mock_llm(monkeypatch, [
        '钟楼建于1956年。[k101] 钟楼是校园轴线的中心。[k102]',
    ])

    result = generate.generate_narrative(16, 'history', 1, [], 60)

    assert result['fallback'] is False
    assert result['text'] == '钟楼建于1956年。 钟楼是校园轴线的中心。'
    assert [c['fact_id'] for c in result['citations']] == [101, 102]
    assert result['citations'][0]['fact_text'] == '钟楼建于1956年。'
    assert result['depth'] == 2
    assert result['audio_url'] == '/narrative-media/test.mp3'
    assert len(calls) == 1
    assert '只能使用' in calls[0][0]
    assert '引用句要尽量贴近卡片原文' in calls[0][0]
    assert '[k101]' in calls[0][1]


def test_clean_text_removes_markers_and_space_before_punctuation():
    assert generate._clean_text('钟楼高 56 米 [k101]。') == '钟楼高 56 米。'


def test_generate_retries_when_citation_missing(generate_setup, monkeypatch):
    calls = mock_llm(monkeypatch, [
        '钟楼建于1956年。',
        '钟楼建于1956年。[k101]',
    ])

    result = generate.generate_narrative(16, 'history', 1, [], 60)

    assert result['fallback'] is False
    assert [c['fact_id'] for c in result['citations']] == [101]
    assert len(calls) == 2


def test_generate_retries_when_citation_id_unknown(generate_setup, monkeypatch):
    calls = mock_llm(monkeypatch, [
        '钟楼建于1956年。[k999]',
        '钟楼建于1956年。[k999]',
    ])

    result = generate.generate_narrative(16, 'history', 1, [], 60)

    assert result == generate.fallback_response()
    assert len(calls) == 2


def test_generate_falls_back_after_hallucination_retry(
    generate_setup, monkeypatch,
):
    calls = mock_llm(monkeypatch, [
        '幻觉内容。[k101]',
        '幻觉内容。[k101]',
    ])

    result = generate.generate_narrative(16, 'history', 1, [], 60)

    assert result == generate.fallback_response()
    assert len(calls) == 2


def test_generate_falls_back_when_no_facts(monkeypatch):
    monkeypatch.setattr(generate, 'get_facts', lambda *args, **kwargs: [])
    calls = mock_llm(monkeypatch, ['不会调用'])

    result = generate.generate_narrative(16, 'nature', 0, [], 60)

    assert result == generate.fallback_response()
    assert calls == []


def test_generate_falls_back_when_llm_raises(monkeypatch, facts):
    monkeypatch.setattr(
        generate, 'get_facts', lambda *args, **kwargs: list(facts),
    )

    def boom(system_prompt, user_prompt):
        raise RuntimeError('LLM 不可用')

    monkeypatch.setattr(llm, 'generate', boom)
    result = generate.generate_narrative(16, 'history', 1, [], 60)

    assert result == generate.fallback_response()


# ═══════════════════════════════════════════════════════════
# 音频
# ═══════════════════════════════════════════════════════════

def test_audio_cache_hit_skips_synthesis(monkeypatch, tmp_path):
    monkeypatch.setattr(generate, 'MEDIA_CACHE', tmp_path)
    key = generate._cache_key(16, 'history', 2, '讲解文案')
    (tmp_path / f'{key}.mp3').write_bytes(b'fake-mp3')

    def must_not_run(*args, **kwargs):
        raise AssertionError('缓存命中时不应重新合成')

    monkeypatch.setattr(generate, '_synthesize', must_not_run)

    url = generate._ensure_audio(16, 'history', 2, '讲解文案')
    assert url == f'/narrative-media/{key}.mp3'


def test_audio_synthesis_failure_does_not_raise(monkeypatch, tmp_path):
    monkeypatch.setattr(generate, 'MEDIA_CACHE', tmp_path)

    def boom(*args, **kwargs):
        raise RuntimeError('tts down')

    monkeypatch.setattr(generate, '_synthesize', boom)

    assert generate._ensure_audio(16, 'history', 2, '讲解文案') is None


# ═══════════════════════════════════════════════════════════
# HTTP 契约
# ═══════════════════════════════════════════════════════════

REQUEST = {
    'spot_id': 16,
    'dimension': 'history',
    'current_depth': 1,
    'listened_fact_ids': [101],
    'max_seconds': 60,
}


def test_healthz():
    response = TestClient(main.app).get('/healthz')
    assert response.status_code == 200
    assert response.json() == {'ok': True}


def test_cors_allows_expo_dev_origin():
    response = TestClient(main.app).get(
        '/healthz', headers={'Origin': 'http://localhost:8081'},
    )
    assert response.headers.get('access-control-allow-origin') == (
        'http://localhost:8081'
    )


def test_cors_rejects_untrusted_origin():
    response = TestClient(main.app).get(
        '/healthz', headers={'Origin': 'https://evil.example.com'},
    )
    assert 'access-control-allow-origin' not in response.headers


def test_narrative_endpoint_success(monkeypatch):
    monkeypatch.setattr(main, 'generate_narrative', lambda **kwargs: {
        'text': '讲解文案',
        'citations': [{'fact_id': 101, 'fact_text': '钟楼建于1956年。'}],
        'depth': 2,
        'audio_url': '/narrative-media/x.mp3',
        'fallback': False,
    })

    response = TestClient(main.app).post('/narrative/next', json=REQUEST)

    assert response.status_code == 200
    body = response.json()
    assert set(body) == {
        'text', 'citations', 'depth', 'audio_url', 'fallback',
    }
    assert body['fallback'] is False
    assert body['citations'][0]['fact_id'] == 101
    assert response.headers['X-Narrative-Latency-Ms'].isdigit()


def test_narrative_endpoint_fallback_contract(monkeypatch):
    monkeypatch.setattr(
        main, 'generate_narrative',
        lambda **kwargs: generate.fallback_response(),
    )

    response = TestClient(main.app).post('/narrative/next', json=REQUEST)

    assert response.status_code == 200
    assert response.json() == {
        'text': '',
        'citations': [],
        'depth': 0,
        'audio_url': None,
        'fallback': True,
    }
    assert response.headers['X-Narrative-Latency-Ms'].isdigit()


def test_narrative_endpoint_never_500s(monkeypatch):
    def boom(**kwargs):
        raise RuntimeError('unexpected')

    monkeypatch.setattr(main, 'generate_narrative', boom)

    response = TestClient(main.app).post('/narrative/next', json=REQUEST)

    assert response.status_code == 200
    assert response.json()['fallback'] is True
