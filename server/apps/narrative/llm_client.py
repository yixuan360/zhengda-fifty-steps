"""
文脉叙事引擎 — OpenAI 兼容 LLM 客户端（T3）

密钥只从服务端环境变量读取，禁止写入任何入库文件：
    NARRATIVE_LLM_BASE_URL  （可选，OpenAI 兼容网关地址）
    NARRATIVE_LLM_API_KEY   （必填）
    NARRATIVE_LLM_MODEL     （必填）
"""
import json

from decouple import config
from openai import APIConnectionError, OpenAI

_TIMEOUT_SECONDS = 60
_SCHEMA_NAME = 'narrative_payload'


def _env(name, default=''):
    return str(config(name, default=default)).strip()


def _build_client():
    api_key = _env('NARRATIVE_LLM_API_KEY')
    if not api_key:
        raise RuntimeError('NARRATIVE_LLM_API_KEY 未配置')

    model = _env('NARRATIVE_LLM_MODEL')
    if not model:
        raise RuntimeError('NARRATIVE_LLM_MODEL 未配置')

    base_url = _env('NARRATIVE_LLM_BASE_URL') or None
    return OpenAI(
        api_key=api_key,
        base_url=base_url,
        timeout=_TIMEOUT_SECONDS,
        max_retries=0,          # 重试由下面的显式循环控制，确保只重试 1 次
    ), model


def chat_json(system_prompt, user_prompt, json_schema):
    """调用 OpenAI 兼容接口，返回解析后的 JSON（dict）。

    网络错误重试 1 次；仍失败则抛出原异常。响应不符合 JSON 时抛 JSONDecodeError。
    """
    client, model = _build_client()

    response = None
    for attempt in range(2):
        try:
            response = client.chat.completions.create(
                model=model,
                messages=[
                    {'role': 'system', 'content': system_prompt},
                    {'role': 'user', 'content': user_prompt},
                ],
                response_format={
                    'type': 'json_schema',
                    'json_schema': {
                        'name': _SCHEMA_NAME,
                        'schema': json_schema,
                        'strict': True,
                    },
                },
                timeout=_TIMEOUT_SECONDS,
            )
            break
        except APIConnectionError:
            if attempt == 1:
                raise

    content = response.choices[0].message.content
    if not content:
        raise RuntimeError('LLM 返回内容为空')
    return json.loads(content)
