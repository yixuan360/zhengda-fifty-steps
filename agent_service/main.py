"""郑大五十步·文脉叙事 Agent 服务入口。

运行（仓库根目录）：
    python -m uvicorn agent_service.main:app --host 127.0.0.1 --port 8100
"""
import logging
import time

from fastapi import FastAPI, Response
from fastapi.middleware.cors import CORSMiddleware

from .generate import fallback_response, generate_narrative
from .schemas import NarrativeRequest, NarrativeResponse

logger = logging.getLogger(__name__)

app = FastAPI(title='郑大五十步·文脉叙事服务', version='0.1.0')

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


@app.post('/narrative/next', response_model=NarrativeResponse)
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


if __name__ == '__main__':
    import uvicorn

    uvicorn.run('agent_service.main:app', host='127.0.0.1', port=8100)
