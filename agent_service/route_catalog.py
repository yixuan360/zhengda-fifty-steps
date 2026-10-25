"""只读 Django 路线目录，带 60 秒缓存与旧缓存降级。

Agent 不自行编造站点：规划只使用 Django 已发布（approved）路线的
code / stops / duration / optional / indoor 等字段。
"""
import json
import logging
import os
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import quote
from urllib.request import Request, urlopen

logger = logging.getLogger(__name__)

API_BASE_ENV = 'NARRATIVE_API_BASE_URL'
DEFAULT_API_BASE = 'http://127.0.0.1:8000'
CACHE_SECONDS = 60
FETCH_TIMEOUT_SECONDS = 3
SAFE_CODE_RE = re.compile(r'^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$')

_cache = {'routes': None, 'expires_at': 0.0}
_cache_lock = threading.Lock()


class RouteCatalogError(RuntimeError):
    """路线目录不可用（Django 未启动、返回异常或数据不合法）。"""


class RouteFetchError(RouteCatalogError):
    """拉取失败（网络/服务端），应保留旧缓存而不是返回残缺目录。"""


def _api_base():
    base = (os.environ.get(API_BASE_ENV) or DEFAULT_API_BASE).strip()
    return base.rstrip('/')


def _load_json(path):
    url = f'{_api_base()}{path}'
    request = Request(url, headers={'Accept': 'application/json'})
    try:
        with urlopen(request, timeout=FETCH_TIMEOUT_SECONDS) as response:
            if response.status != 200:
                raise RouteFetchError(f'路线接口返回 {response.status}')
            payload = json.loads(response.read().decode('utf-8'))
    except RouteFetchError:
        raise
    except Exception as exc:
        raise RouteFetchError(f'路线接口请求失败：{exc}') from exc

    if not isinstance(payload, dict) or not payload.get('ok'):
        raise RouteFetchError('路线接口返回 ok=false')
    return payload.get('data')


def _as_int(value, field, minimum):
    try:
        number = int(value)
    except (TypeError, ValueError):
        raise RouteCatalogError(f'{field} 不是整数') from None
    if number < minimum:
        raise RouteCatalogError(f'{field} 小于 {minimum}')
    return number


def _normalize_stop(raw):
    if not isinstance(raw, dict):
        raise RouteCatalogError('站点不是对象')
    return {
        'order': _as_int(raw.get('order'), 'order', 1),
        'spot_id': _as_int(raw.get('spot_id'), 'spot_id', 1),
        'category': str(raw.get('category') or '').strip()[:20],
        'duration_seconds': min(
            _as_int(raw.get('duration_seconds'), 'duration_seconds', 1), 600,
        ),
        'optional': bool(raw.get('optional')),
        'indoor': bool(raw.get('indoor')),
        'note': str(raw.get('note') or '').strip()[:160],
    }


def normalize_route(raw):
    """校验并收敛 Django 返回的路线详情；字段缺失即视为目录异常。"""
    if not isinstance(raw, dict):
        raise RouteCatalogError('路线不是对象')

    code = str(raw.get('code') or '').strip()
    if not SAFE_CODE_RE.match(code):
        raise RouteCatalogError(f'路线 code 不合法：{code!r}')

    name = str(raw.get('name') or '').strip()
    if not name:
        raise RouteCatalogError(f'{code} 缺少路线名')

    try:
        walking_km = float(raw.get('walking_km') or 0)
    except (TypeError, ValueError):
        raise RouteCatalogError(f'{code} walking_km 不合法') from None
    if walking_km < 0 or walking_km > 100:
        raise RouteCatalogError(f'{code} walking_km 超出范围')

    stops = [_normalize_stop(item) for item in (raw.get('stops') or [])]
    if not stops:
        raise RouteCatalogError(f'{code} 没有站点')
    stops.sort(key=lambda item: item['order'])
    orders = [item['order'] for item in stops]
    if len(set(orders)) != len(orders):
        raise RouteCatalogError(f'{code} 站序重复')

    return {
        'code': code,
        'name': name,
        'subtitle': str(raw.get('subtitle') or '').strip()[:160],
        'theme': str(raw.get('theme') or '').strip()[:80],
        'total_minutes': min(
            _as_int(raw.get('total_minutes'), 'total_minutes', 1), 600,
        ),
        'walking_km': round(walking_km, 2),
        'stops': stops,
    }


def _fetch_detail(code):
    detail = _load_json(f'/api/v2/narrative/routes/{quote(code, safe="")}/')
    return normalize_route(detail)


def fetch_catalog():
    """从 Django 拉取所有已发布路线的详情（详情并行请求）。"""
    summaries = _load_json('/api/v2/narrative/routes/')
    if not isinstance(summaries, list):
        raise RouteCatalogError('路线目录格式不合法')
    if not summaries:
        # 空目录是合法状态（全部路线被撤回），不能拿旧缓存无限续命。
        return []

    codes = []
    for summary in summaries:
        code = str((summary or {}).get('code') or '').strip()
        if not SAFE_CODE_RE.match(code):
            raise RouteCatalogError(f'路线 code 不合法：{code!r}')
        codes.append(code)

    routes = []
    with ThreadPoolExecutor(max_workers=min(4, len(codes))) as pool:
        futures = {pool.submit(_fetch_detail, code): code for code in codes}
        for future, code in futures.items():
            try:
                routes.append(future.result())
            except RouteFetchError:
                # 网络/服务端异常：中止刷新，保留旧缓存。
                raise
            except RouteCatalogError as exc:
                # 单条已发布路线数据不完整时跳过，不让整份目录不可用。
                logger.warning('跳过路线 %s：%s', code, exc)

    if not routes:
        raise RouteCatalogError('没有可用的已发布路线')
    routes.sort(key=lambda route: route['code'])
    return routes


def get_catalog():
    """命中 60 秒缓存；刷新失败时退回旧缓存，无旧缓存则抛错。

    网络请求在锁外执行，避免一次刷新阻塞所有并发请求。
    """
    now = time.monotonic()
    with _cache_lock:
        cached = _cache['routes']
        if cached is not None and now < _cache['expires_at']:
            return cached

    try:
        routes = fetch_catalog()
    except Exception as exc:
        with _cache_lock:
            cached = _cache['routes']
            if cached is not None:
                logger.warning('路线目录刷新失败，沿用旧缓存：%s', exc)
                _cache['expires_at'] = time.monotonic() + CACHE_SECONDS
                return cached
        logger.warning('路线目录不可用：%s', exc)
        if isinstance(exc, RouteCatalogError):
            raise
        raise RouteCatalogError('路线目录不可用') from exc

    with _cache_lock:
        _cache['routes'] = routes
        _cache['expires_at'] = time.monotonic() + CACHE_SECONDS
    return routes


def reset_cache():
    """测试用：清空模块级缓存。"""
    with _cache_lock:
        _cache['routes'] = None
        _cache['expires_at'] = 0.0
