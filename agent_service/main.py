"""郑大五十步·文脉叙事 Agent 服务入口。

运行（仓库根目录）：
    python -m uvicorn agent_service.main:app --host 127.0.0.1 --port 8100
"""
import logging
import os
import time

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from .generate import MEDIA_CACHE, fallback_response, generate_narrative
from .route_catalog import RouteCatalogError
from .throttle import RateLimiter
from .routes import (
    InvalidRouteOrder,
    RouteNotFound,
    adapt_route,
    plan_route,
)
from .schemas import (
    NarrativeRequest,
    NarrativeResponse,
    RouteAdaptRequest,
    RouteAdaptResponse,
    RoutePlanRequest,
    RoutePlanResponse,
)

logger = logging.getLogger(__name__)

app = FastAPI(title='郑大五十步·文脉叙事服务', version='0.1.0')

# 本地直连（真机局域网测试）没有 nginx，由 Agent 自身提供合成音频；
# 生产环境 nginx 的 /narrative-media/ location 仍优先于本服务。
MEDIA_CACHE.mkdir(parents=True, exist_ok=True)
app.mount('/narrative-media', StaticFiles(directory=str(MEDIA_CACHE)), name='narrative-media')

# Expo 开发源（localhost / 模拟器 / 局域网真机）
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=(
        r'^https?://('
        r'localhost|127\.0\.0\.1|10\.0\.2\.2|'
        r'192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}'
        r')(:\d+)?$'
    ),
    allow_methods=['GET', 'POST', 'OPTIONS'],
    allow_headers=['*'],
)


@app.get('/healthz')
def healthz():
    return {'ok': True}


# 路线规划会触发一次 LLM 解释，限额比调整接口更严。
NEXT_LIMITER = RateLimiter(limit=20, window_seconds=60)
PLAN_LIMITER = RateLimiter(limit=10, window_seconds=60)
ADAPT_LIMITER = RateLimiter(limit=30, window_seconds=60)


def _client_key(request):
    host = request.client.host if request.client else ''
    real_ip = (request.headers.get('x-real-ip') or '').strip()
    # 只在本机反代（nginx）后面信任 X-Real-IP，避免直连伪造。
    if host in ('127.0.0.1', '::1') and real_ip:
        return real_ip
    return host or 'unknown'


def _plan_guard(request: Request):
    if not PLAN_LIMITER.allow(_client_key(request)):
        raise HTTPException(
            status_code=429, detail='路线规划请求过于频繁，请稍后再试',
        )


def _adapt_guard(request: Request):
    if not ADAPT_LIMITER.allow(_client_key(request)):
        raise HTTPException(
            status_code=429, detail='路线调整请求过于频繁，请稍后再试',
        )


def _next_guard(request: Request):
    if not NEXT_LIMITER.allow(_client_key(request)):
        raise HTTPException(
            status_code=429, detail='讲解生成请求过于频繁，请稍后再试',
        )


def _route_llm_enabled():
    return (os.environ.get('NARRATIVE_ROUTE_LLM_EXPLAIN') or '1') != '0'


@app.post(
    '/narrative/next', response_model=NarrativeResponse,
    dependencies=[Depends(_next_guard)],
)
def narrative_next(payload: NarrativeRequest, response: Response):
    started = time.perf_counter()
    try:
        result = generate_narrative(
            spot_id=payload.spot_id,
            dimension=payload.dimension,
            current_depth=payload.current_depth,
            listened_fact_ids=payload.listened_fact_ids,
            max_seconds=payload.max_seconds,
        )
    except Exception:
        logger.exception('叙事生成出现未捕获异常，按降级返回')
        result = fallback_response()

    elapsed_ms = int((time.perf_counter() - started) * 1000)
    response.headers['X-Narrative-Latency-Ms'] = str(elapsed_ms)
    return NarrativeResponse(**result)


def _route_error(status_code, message):
    return JSONResponse(
        status_code=status_code,
        content={'ok': False, 'message': message},
    )


@app.post(
    '/narrative/route', response_model=RoutePlanResponse,
    dependencies=[Depends(_plan_guard)],
)
def narrative_route(payload: RoutePlanRequest, response: Response):
    started = time.perf_counter()
    try:
        result = plan_route(
            minutes=payload.minutes,
            interests=payload.interests,
            start_spot_id=payload.start_spot_id,
            context=payload.context,
            use_llm=_route_llm_enabled(),
        )
    except RouteCatalogError as exc:
        logger.warning('路线规划失败：%s', exc)
        return _route_error(503, '路线服务暂不可用，请使用默认路线')
    except Exception:
        logger.exception('路线规划出现未捕获异常')
        return _route_error(503, '路线服务暂不可用，请使用默认路线')

    elapsed_ms = int((time.perf_counter() - started) * 1000)
    response.headers['X-Route-Latency-Ms'] = str(elapsed_ms)
    return RoutePlanResponse(**result)


@app.post(
    '/narrative/route/adapt', response_model=RouteAdaptResponse,
    dependencies=[Depends(_adapt_guard)],
)
def narrative_route_adapt(payload: RouteAdaptRequest, response: Response):
    started = time.perf_counter()
    try:
        result = adapt_route(
            route_code=payload.route_code,
            current_order=payload.current_order,
            action=payload.action,
            context=payload.context,
            current_stops=payload.current_stops,
        )
    except RouteNotFound as exc:
        logger.info('路线不存在：%s', exc)
        return _route_error(404, '路线不存在或未发布')
    except InvalidRouteOrder as exc:
        logger.info('路线调整参数不合法：%s', exc)
        return _route_error(400, '当前站序不在路线中')
    except RouteCatalogError as exc:
        logger.warning('路线调整失败：%s', exc)
        return _route_error(503, '路线服务暂不可用')
    except Exception:
        logger.exception('路线调整出现未捕获异常')
        return _route_error(503, '路线服务暂不可用')

    elapsed_ms = int((time.perf_counter() - started) * 1000)
    response.headers['X-Route-Latency-Ms'] = str(elapsed_ms)
    return RouteAdaptResponse(**result)


if __name__ == '__main__':
    import uvicorn

    uvicorn.run('agent_service.main:app', host='127.0.0.1', port=8100)
