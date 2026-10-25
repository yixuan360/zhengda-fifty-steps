"""V3 — Agent 路线规划/调整测试（不联网、不调真实 LLM）。"""
import copy

import pytest
from fastapi.testclient import TestClient

from agent_service import llm, main, route_catalog, routes

MEIHU_STOPS = [
    {'order': 1, 'spot_id': 6, 'category': 'history', 'duration_seconds': 90,
     'optional': False, 'indoor': False, 'note': '河源'},
    {'order': 2, 'spot_id': 7, 'category': 'history', 'duration_seconds': 75,
     'optional': False, 'indoor': False, 'note': '问鼎'},
    {'order': 3, 'spot_id': 8, 'category': 'history', 'duration_seconds': 75,
     'optional': False, 'indoor': False, 'note': '博弈'},
    {'order': 4, 'spot_id': 9, 'category': 'history', 'duration_seconds': 75,
     'optional': False, 'indoor': False, 'note': '禅趣'},
    {'order': 5, 'spot_id': 11, 'category': 'history', 'duration_seconds': 90,
     'optional': False, 'indoor': False, 'note': '观星测影'},
    {'order': 6, 'spot_id': 12, 'category': 'history', 'duration_seconds': 75,
     'optional': False, 'indoor': False, 'note': '大道通衢'},
    {'order': 7, 'spot_id': 13, 'category': 'history', 'duration_seconds': 75,
     'optional': False, 'indoor': False, 'note': '凤台荷香'},
    {'order': 8, 'spot_id': 14, 'category': '', 'duration_seconds': 90,
     'optional': True, 'indoor': False, 'note': '杏坛槐林'},
]

AXIS_STOPS = [
    {'order': 1, 'spot_id': 1, 'category': '', 'duration_seconds': 90,
     'optional': False, 'indoor': False, 'note': '南大门'},
    {'order': 2, 'spot_id': 3, 'category': '', 'duration_seconds': 90,
     'optional': False, 'indoor': False, 'note': '综合中心大楼'},
    {'order': 3, 'spot_id': 16, 'category': 'architecture',
     'duration_seconds': 120, 'optional': False, 'indoor': False, 'note': '钟楼'},
]

CATALOG = [
    {
        'code': 'axis-3', 'name': '中轴三章', 'subtitle': '', 'theme': '入门线',
        'total_minutes': 22, 'walking_km': 0.96, 'stops': AXIS_STOPS,
    },
    {
        'code': 'meihu-8', 'name': '眉湖八景', 'subtitle': '', 'theme': '水脉线',
        'total_minutes': 35, 'walking_km': 0.9, 'stops': MEIHU_STOPS,
    },
]


def plan(**overrides):
    options = {'minutes': 30, 'use_llm': False, 'catalog': CATALOG}
    options.update(overrides)
    return routes.plan_route(**options)


def adapt(**overrides):
    options = {
        'route_code': 'meihu-8', 'current_order': 3, 'action': 'time_short',
        'catalog': CATALOG,
    }
    options.update(overrides)
    return routes.adapt_route(**options)


# ═══════════════════════════════════════════════════════════
# 目录读取
# ═══════════════════════════════════════════════════════════

def test_normalize_route_sorts_and_casts():
    raw = {
        'code': 'meihu-8', 'name': '眉湖八景', 'total_minutes': '35',
        'walking_km': '0.9',
        'stops': [
            {'order': '2', 'spot_id': '7', 'duration_seconds': '75'},
            {'order': '1', 'spot_id': '6', 'duration_seconds': '90'},
        ],
    }
    route = route_catalog.normalize_route(raw)
    assert route['total_minutes'] == 35
    assert route['walking_km'] == 0.9
    assert [stop['order'] for stop in route['stops']] == [1, 2]
    assert route['stops'][0]['spot_id'] == 6


@pytest.mark.parametrize('bad', [
    {'code': '../evil', 'name': 'x', 'total_minutes': 10, 'stops': [{}]},
    {'code': 'ok', 'name': '', 'total_minutes': 10, 'stops': [{}]},
    {'code': 'ok', 'name': 'x', 'total_minutes': 10, 'stops': []},
])
def test_normalize_route_rejects_bad_payload(bad):
    with pytest.raises(route_catalog.RouteCatalogError):
        route_catalog.normalize_route(bad)


def test_normalize_route_rejects_duplicate_orders():
    raw = {
        'code': 'ok', 'name': 'x', 'total_minutes': 10,
        'stops': [
            {'order': 1, 'spot_id': 1, 'duration_seconds': 60},
            {'order': 1, 'spot_id': 2, 'duration_seconds': 60},
        ],
    }
    with pytest.raises(route_catalog.RouteCatalogError):
        route_catalog.normalize_route(raw)


@pytest.fixture(autouse=True)
def _reset_limiters():
    main.PLAN_LIMITER.reset()
    main.ADAPT_LIMITER.reset()
    yield


def test_fetch_catalog_loads_each_detail(monkeypatch):
    def fake_load(path):
        if path.endswith('/routes/'):
            return [{'code': 'meihu-8'}]
        return {
            'code': 'meihu-8', 'name': '眉湖八景', 'total_minutes': 35,
            'walking_km': 0.9, 'stops': MEIHU_STOPS,
        }

    monkeypatch.setattr(route_catalog, '_load_json', fake_load)
    result = route_catalog.fetch_catalog()
    assert [route['code'] for route in result] == ['meihu-8']
    assert len(result[0]['stops']) == 8


def test_fetch_catalog_skips_one_invalid_route(monkeypatch):
    def fake_load(path):
        if path.endswith('/routes/'):
            return [{'code': 'broken'}, {'code': 'meihu-8'}]
        if path.endswith('/broken/'):
            return {
                'code': 'broken', 'name': '坏路线', 'total_minutes': 10,
                'walking_km': 0, 'stops': [],
            }
        return {
            'code': 'meihu-8', 'name': '眉湖八景', 'total_minutes': 35,
            'walking_km': 0.9, 'stops': MEIHU_STOPS,
        }

    monkeypatch.setattr(route_catalog, '_load_json', fake_load)
    result = route_catalog.fetch_catalog()
    assert [route['code'] for route in result] == ['meihu-8']


def test_fetch_catalog_aborts_on_network_error(monkeypatch):
    def fake_load(path):
        if path.endswith('/routes/'):
            return [{'code': 'meihu-8'}]
        raise route_catalog.RouteFetchError('timeout')

    monkeypatch.setattr(route_catalog, '_load_json', fake_load)
    with pytest.raises(route_catalog.RouteFetchError):
        route_catalog.fetch_catalog()


def test_fetch_catalog_treats_empty_list_as_valid(monkeypatch):
    monkeypatch.setattr(route_catalog, '_load_json', lambda path: [])
    assert route_catalog.fetch_catalog() == []


def test_plan_with_empty_catalog_raises():
    with pytest.raises(route_catalog.RouteCatalogError):
        routes.plan_route(30, catalog=[], use_llm=False)


def test_get_catalog_caches_within_ttl(monkeypatch):
    route_catalog.reset_cache()
    calls = []

    def fake_fetch():
        calls.append(1)
        return copy.deepcopy(CATALOG)

    monkeypatch.setattr(route_catalog, 'fetch_catalog', fake_fetch)
    assert route_catalog.get_catalog()[0]['code'] == 'axis-3'
    assert route_catalog.get_catalog()[0]['code'] == 'axis-3'
    assert calls == [1]
    route_catalog.reset_cache()


def test_get_catalog_falls_back_to_stale_cache(monkeypatch):
    route_catalog.reset_cache()
    monkeypatch.setattr(
        route_catalog, 'fetch_catalog', lambda: copy.deepcopy(CATALOG),
    )
    route_catalog.get_catalog()

    route_catalog._cache['expires_at'] = 0
    monkeypatch.setattr(
        route_catalog, 'fetch_catalog',
        lambda: (_ for _ in ()).throw(RuntimeError('django down')),
    )
    assert route_catalog.get_catalog()[1]['code'] == 'meihu-8'
    route_catalog.reset_cache()


def test_get_catalog_raises_without_cache(monkeypatch):
    route_catalog.reset_cache()
    monkeypatch.setattr(
        route_catalog, 'fetch_catalog',
        lambda: (_ for _ in ()).throw(RuntimeError('django down')),
    )
    with pytest.raises(route_catalog.RouteCatalogError):
        route_catalog.get_catalog()
    route_catalog.reset_cache()


# ═══════════════════════════════════════════════════════════
# 规划规则
# ═══════════════════════════════════════════════════════════

def test_default_30_minutes_returns_meihu_first_seven():
    result = plan(minutes=30)
    assert result['route_code'] == 'meihu-8'
    assert result['stops'] == [1, 2, 3, 4, 5, 6, 7]
    assert result['total_minutes'] == 30
    assert result['walking_km'] == 0.77
    assert result['excluded'] == [
        {'order': 8, 'reason': '时间不足，留到下次'},
    ]
    assert '杏坛槐林留到下次' in result['explanation']


def test_short_time_uses_axis_route():
    result = plan(minutes=20)
    assert result['route_code'] == 'axis-3'
    assert result['stops'] == [1, 2, 3]
    assert result['total_minutes'] == 22


def test_very_short_time_trims_axis_to_two_stops():
    result = plan(minutes=10)
    assert result['route_code'] == 'axis-3'
    assert result['stops'] == [1, 2]
    assert result['total_minutes'] <= 14
    assert '南大门' in result['explanation']
    assert '综合中心' in result['explanation']
    assert '钟楼' not in result['explanation']


def test_long_time_includes_optional_stop():
    result = plan(minutes=45)
    assert result['route_code'] == 'meihu-8'
    assert result['stops'] == [1, 2, 3, 4, 5, 6, 7, 8]
    assert result['excluded'] == []
    assert result['total_minutes'] == 35


def test_nature_interest_overrides_short_time_and_trims():
    result = plan(minutes=20, interests=['nature', 'civilization'])
    assert result['route_code'] == 'meihu-8'
    assert result['stops'] == [1, 2, 3, 4, 5]
    assert result['total_minutes'] <= 24


def test_architecture_interest_picks_axis_route():
    result = plan(minutes=30, interests=['architecture'])
    assert result['route_code'] == 'axis-3'
    assert result['stops'] == [1, 2, 3]


def test_conflicting_interests_fall_back_to_time():
    result = plan(minutes=30, interests=['nature', 'architecture'])
    assert result['route_code'] == 'meihu-8'


def test_unknown_interests_fall_back_to_time():
    result = plan(minutes=20, interests=['美食'])
    assert result['route_code'] == 'axis-3'


def test_start_spot_starts_at_that_order():
    result = plan(minutes=30, start_spot_id=9)
    assert result['route_code'] == 'meihu-8'
    assert result['stops'] == [4, 5, 6, 7, 8]
    assert result['start_order'] == 4
    assert result['total_minutes'] == 21
    assert result['excluded'][:3] == [
        {'order': 1, 'reason': '从当前景点开始'},
        {'order': 2, 'reason': '从当前景点开始'},
        {'order': 3, 'reason': '从当前景点开始'},
    ]
    assert '从第 4 站出发' in result['explanation']


def test_start_spot_does_not_waste_remaining_time():
    result = plan(minutes=10, start_spot_id=9)
    assert result['stops'] == [4, 5, 6]
    assert result['total_minutes'] <= 14
    assert 8 in [item['order'] for item in result['excluded']]


def test_start_spot_selects_its_route():
    result = plan(minutes=30, start_spot_id=16)
    assert result['route_code'] == 'axis-3'
    assert result['stops'] == [3]


def test_unknown_start_spot_is_ignored():
    result = plan(minutes=30, start_spot_id=999)
    assert result['route_code'] == 'meihu-8'
    assert result['stops'][0] == 1


def test_start_at_last_stop_does_not_claim_more_stops():
    result = plan(minutes=30, start_spot_id=14)
    assert result['stops'] == [8]
    assert '第 8 站' in result['explanation']
    assert '再走' not in result['explanation']


def test_rain_context_adds_shelter_note():
    result = plan(minutes=30, context={'weather': 'rain'})
    assert '眉湖小屋' in result['explanation']
    assert result['fallback'] is False


def test_walking_km_shrinks_with_subset():
    full = plan(minutes=45)
    partial = plan(minutes=30)
    assert full['walking_km'] == 0.9
    assert partial['walking_km'] < full['walking_km']


def test_estimate_minutes_is_monotonic():
    route = CATALOG[1]
    values = [
        routes.estimate_minutes(route, route['stops'][:count])
        for count in range(1, 9)
    ]
    assert values == sorted(values)


# ═══════════════════════════════════════════════════════════
# 解释生成
# ═══════════════════════════════════════════════════════════

def test_llm_explanation_is_used_and_cleaned(monkeypatch):
    monkeypatch.setattr(
        llm, 'generate',
        lambda *args, **kwargs: '  这条线顺着湖岸走，每一站都能停下来看看。\n',
    )
    result = plan(use_llm=True)
    assert result['explanation'] == '这条线顺着湖岸走，每一站都能停下来看看。'


def test_llm_explanation_falls_back_on_error(monkeypatch):
    def boom(*args, **kwargs):
        raise RuntimeError('llm down')

    monkeypatch.setattr(llm, 'generate', boom)
    result = plan(use_llm=True)
    assert result['explanation'] == plan(use_llm=False)['explanation']


def test_llm_explanation_rejects_too_short_output(monkeypatch):
    monkeypatch.setattr(llm, 'generate', lambda *args, **kwargs: '好')
    result = plan(use_llm=True)
    assert '杏坛槐林' in result['explanation']


@pytest.mark.parametrize('bad', [
    '今天走8站，约30分钟。',
    '完整线共八站，约三十五分钟。',
])
def test_llm_explanation_with_numbers_falls_back(monkeypatch, bad):
    monkeypatch.setattr(llm, 'generate', lambda *args, **kwargs: bad)
    result = plan(use_llm=True)
    assert result['explanation'] == plan(use_llm=False)['explanation']


def test_llm_prompt_marks_plan_as_fixed(monkeypatch):
    captured = {}

    def fake(system_prompt, user_prompt, **kwargs):
        captured['system'] = system_prompt
        captured['user'] = user_prompt
        captured['timeout'] = kwargs.get('timeout')
        captured['attempts'] = kwargs.get('attempts')
        return '今天走七站，约三十分钟。'

    monkeypatch.setattr(llm, 'generate', fake)
    plan(use_llm=True)
    assert '不得新增或修改' in captured['system']
    assert '"stop_count": 7' in captured['user']
    assert captured['timeout'] == 2.5
    assert captured['attempts'] == 1


# ═══════════════════════════════════════════════════════════
# 现场调整
# ═══════════════════════════════════════════════════════════

def test_time_short_ends_at_current_stop():
    result = adapt(current_order=3, action='time_short')
    assert result['stops'] == [1, 2, 3]
    assert result['end_reason'] == '时间不够，提前收尾'
    assert '第 3 站' in result['message']
    assert result['shelter_spot_id'] is None


def test_rain_uses_shelter_when_no_indoor_stop():
    result = adapt(current_order=2, action='rain')
    assert result['stops'] == [1, 2]
    assert result['shelter_spot_id'] == 77
    assert result['shelter_name'] == '眉湖小屋'
    assert '眉湖小屋' in result['end_reason']


def test_rain_prefers_indoor_stop_on_route():
    catalog = copy.deepcopy(CATALOG)
    catalog[1]['stops'][3]['indoor'] = True
    result = routes.adapt_route(
        'meihu-8', 2, 'rain', catalog=catalog,
    )
    assert result['stops'] == [1, 2, 3, 4]
    assert result['shelter_spot_id'] is None
    assert '禅趣' in result['end_reason']


def test_more_adds_next_optional_stop():
    result = adapt(current_order=7, action='more')
    assert result['stops'] == [1, 2, 3, 4, 5, 6, 7, 8]
    assert result['end_reason'] == '已加回可选站'
    assert result['message'] == '把杏坛槐林加回来，路线延长到第 8 站。'
    assert result['deep_dive'] is None


def test_more_keeps_custom_start_and_skipped_stops():
    result = adapt(
        current_order=7, action='more', current_stops=[4, 5, 6, 7],
    )
    assert result['stops'] == [4, 5, 6, 7, 8]


def test_more_offers_deep_dive_when_optional_already_planned():
    result = adapt(
        current_order=7, action='more',
        current_stops=[1, 2, 3, 4, 5, 6, 7, 8],
    )
    assert result['stops'] == [1, 2, 3, 4, 5, 6, 7, 8]
    assert result['end_reason'] == '没有更多可选站'
    assert result['deep_dive'] == {'spot_id': 13, 'category': 'history'}


def test_time_short_respects_custom_stops():
    result = adapt(
        current_order=5, action='time_short', current_stops=[4, 5, 6, 7],
    )
    assert result['stops'] == [4, 5]


def test_stale_current_stops_fall_back_instead_of_empty():
    result = adapt(
        current_order=3, action='time_short', current_stops=[4, 5, 6, 7],
    )
    assert result['stops'] == [1, 2, 3]
    assert result['total_minutes'] > 0


def test_more_skips_planned_optional_to_later_one():
    stops = [
        {
            'order': order, 'spot_id': 100 + order, 'category': 'history',
            'duration_seconds': 60, 'optional': order in (8, 10),
            'indoor': False, 'note': f'站{order}',
        }
        for order in range(1, 11)
    ]
    catalog = [{
        'code': 'multi', 'name': '多可选线', 'subtitle': '', 'theme': '',
        'total_minutes': 40, 'walking_km': 1.0, 'stops': stops,
    }]
    result = routes.adapt_route(
        'multi', 7, 'more', catalog=catalog,
        current_stops=[1, 2, 3, 4, 5, 6, 7, 8],
    )
    assert result['stops'] == [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]


def test_more_offers_deep_dive_when_route_is_full():
    result = adapt(route_code='axis-3', current_order=3, action='more')
    assert result['stops'] == [1, 2, 3]
    assert result['deep_dive'] == {'spot_id': 16, 'category': 'architecture'}
    assert '深度稿' in result['message']


def test_more_without_current_stops_keeps_default_plan():
    result = adapt(route_code='axis-3', current_order=1, action='more')
    assert result['stops'] == [1, 2, 3]
    assert result['deep_dive'] is None


def test_unknown_route_raises():
    with pytest.raises(routes.RouteNotFound):
        adapt(route_code='nope')


def test_invalid_order_raises():
    with pytest.raises(routes.InvalidRouteOrder):
        adapt(current_order=99)


# ═══════════════════════════════════════════════════════════
# HTTP 契约
# ═══════════════════════════════════════════════════════════

@pytest.fixture
def catalog_patch(monkeypatch):
    monkeypatch.setattr(routes, 'get_catalog', lambda: copy.deepcopy(CATALOG))
    monkeypatch.setenv('NARRATIVE_ROUTE_LLM_EXPLAIN', '0')
    return CATALOG


def test_route_endpoint_success(catalog_patch):
    response = TestClient(main.app).post('/narrative/route', json={
        'minutes': 30,
        'interests': ['nature', 'civilization'],
        'start_spot_id': None,
        'context': {'weather': 'clear'},
    })
    assert response.status_code == 200
    body = response.json()
    assert body['route_code'] == 'meihu-8'
    assert body['stops'] == [1, 2, 3, 4, 5, 6, 7]
    assert body['fallback'] is False
    assert response.headers['X-Route-Latency-Ms'].isdigit()


def test_route_endpoint_catalog_down_returns_503(monkeypatch):
    monkeypatch.setattr(
        routes, 'get_catalog',
        lambda: (_ for _ in ()).throw(route_catalog.RouteCatalogError('down')),
    )
    response = TestClient(main.app).post(
        '/narrative/route', json={'minutes': 30},
    )
    assert response.status_code == 503
    assert response.json()['ok'] is False


@pytest.mark.parametrize('payload', [
    {'minutes': 5},
    {'minutes': 30, 'interests': ['x'] * 9},
    {'minutes': 30, 'context': {'x': 'a' * 2000}},
    {'minutes': 30, 'context': {'x': '雨' * 400}},
])
def test_route_endpoint_validates_payload(payload):
    response = TestClient(main.app).post('/narrative/route', json=payload)
    assert response.status_code == 422


def test_route_endpoint_rate_limited(catalog_patch, monkeypatch):
    monkeypatch.setattr(main.PLAN_LIMITER, 'allow', lambda key: False)
    response = TestClient(main.app).post(
        '/narrative/route', json={'minutes': 30},
    )
    assert response.status_code == 429


def test_adapt_endpoint_rate_limited(catalog_patch, monkeypatch):
    monkeypatch.setattr(main.ADAPT_LIMITER, 'allow', lambda key: False)
    response = TestClient(main.app).post('/narrative/route/adapt', json={
        'route_code': 'meihu-8', 'current_order': 1, 'action': 'rain',
    })
    assert response.status_code == 429


def test_adapt_endpoint_time_short(catalog_patch):
    response = TestClient(main.app).post('/narrative/route/adapt', json={
        'route_code': 'meihu-8',
        'current_order': 3,
        'action': 'time_short',
        'context': {},
    })
    assert response.status_code == 200
    body = response.json()
    assert body['stops'] == [1, 2, 3]
    assert body['total_minutes'] == 12
    assert response.headers['X-Route-Latency-Ms'].isdigit()


def test_adapt_endpoint_rain(catalog_patch):
    response = TestClient(main.app).post('/narrative/route/adapt', json={
        'route_code': 'meihu-8', 'current_order': 2, 'action': 'rain',
    })
    assert response.status_code == 200
    body = response.json()
    assert body['shelter_spot_id'] == 77
    assert body['shelter_name'] == '眉湖小屋'


def test_adapt_endpoint_accepts_current_stops(catalog_patch):
    response = TestClient(main.app).post('/narrative/route/adapt', json={
        'route_code': 'meihu-8',
        'current_order': 7,
        'action': 'more',
        'current_stops': [4, 5, 6, 7],
    })
    assert response.status_code == 200
    assert response.json()['stops'] == [4, 5, 6, 7, 8]


def test_adapt_endpoint_rejects_nonpositive_current_stops(catalog_patch):
    response = TestClient(main.app).post('/narrative/route/adapt', json={
        'route_code': 'meihu-8',
        'current_order': 3,
        'action': 'time_short',
        'current_stops': [0, 1],
    })
    assert response.status_code == 422


def test_adapt_endpoint_unknown_route_returns_404(catalog_patch):
    response = TestClient(main.app).post('/narrative/route/adapt', json={
        'route_code': 'nope', 'current_order': 1, 'action': 'rain',
    })
    assert response.status_code == 404


def test_adapt_endpoint_invalid_order_returns_400(catalog_patch):
    response = TestClient(main.app).post('/narrative/route/adapt', json={
        'route_code': 'meihu-8', 'current_order': 99, 'action': 'rain',
    })
    assert response.status_code == 400


def test_adapt_endpoint_invalid_action_returns_422(catalog_patch):
    response = TestClient(main.app).post('/narrative/route/adapt', json={
        'route_code': 'meihu-8', 'current_order': 1, 'action': 'fly',
    })
    assert response.status_code == 422


def test_adapt_endpoint_catalog_down_returns_503(monkeypatch):
    monkeypatch.setattr(
        routes, 'get_catalog',
        lambda: (_ for _ in ()).throw(route_catalog.RouteCatalogError('down')),
    )
    response = TestClient(main.app).post('/narrative/route/adapt', json={
        'route_code': 'meihu-8', 'current_order': 1, 'action': 'rain',
    })
    assert response.status_code == 503


def test_rate_limiter_evicts_when_key_table_is_full():
    from agent_service.throttle import RateLimiter

    limiter = RateLimiter(limit=1, window_seconds=60, max_keys=2)
    assert limiter.allow('a')
    assert limiter.allow('b')
    assert limiter.allow('c')
    assert len(limiter._hits) <= 2
