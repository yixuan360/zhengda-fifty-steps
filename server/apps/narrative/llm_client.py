"""
文脉叙事引擎 — OpenAI 兼容 LLM 客户端（T3）

密钥只从服务端环境变量读取，禁止写入任何入库文件：
    NARRATIVE_LLM_BASE_URL  （可选，OpenAI 兼容网关地址）
    NARRATIVE_LLM_API_KEY   （必填）
    NARRATIVE_LLM_MODEL     （必填）
"""
import json
import logging

from decouple import config
from openai import APIConnectionError, BadRequestError, OpenAI

logger = logging.getLogger(__name__)

_TIMEOUT_SECONDS = 60
_SCHEMA_NAME = 'narrative_payload'

_TYPE_CHECKS = {
    'object': dict,
    'array': list,
    'string': str,
    'boolean': bool,
    'integer': int,
    'number': (int, float),
}


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


def _create_completion(client, model, messages, response_format):
    """发起一次 chat completion；网络错误重试 1 次。"""
    for attempt in range(2):
        try:
            return client.chat.completions.create(
                model=model,
                messages=messages,
                response_format=response_format,
                timeout=_TIMEOUT_SECONDS,
            )
        except APIConnectionError:
            if attempt == 1:
                raise


def _check_type(value, expected_type, path):
    expected = _TYPE_CHECKS.get(expected_type)
    if expected is None:
        return
    if expected_type == 'integer':
        valid = isinstance(value, int) and not isinstance(value, bool)
    elif expected_type == 'number':
        valid = isinstance(value, (int, float)) and not isinstance(value, bool)
    else:
        valid = isinstance(value, expected)
    if not valid:
        raise ValueError(
            f'LLM 返回不符合 schema：字段 {path} 类型应为 {expected_type}'
        )


def _validate_payload(payload, json_schema):
    """json_object 回退模式下的手工 schema 校验（仅校验顶层结构与类型）。

    数组元素（如逐张事实卡片）仍由各命令的既有非法字段路径逐条跳过。
    """
    _check_type(payload, json_schema.get('type'), '根节点')
    if json_schema.get('type') != 'object' or not isinstance(payload, dict):
        return

    for key in json_schema.get('required', []):
        if key not in payload:
            raise ValueError(f'LLM 返回不符合 schema：缺少字段 {key}')

    for key, prop in json_schema.get('properties', {}).items():
        if key in payload:
            _check_type(payload[key], prop.get('type'), key)


def chat_json(system_prompt, user_prompt, json_schema):
    """调用 OpenAI 兼容接口，返回解析后的 JSON（dict）。

    - 网络错误重试 1 次；
    - json_schema（strict）被 API 以 400 拒绝时，自动回退 json_object 重试一次，
      并手工校验顶层 schema；
    - JSON 解析失败时抛 JSONDecodeError。
    """
    client, model = _build_client()
    messages = [
        {'role': 'system', 'content': system_prompt},
        {'role': 'user', 'content': user_prompt},
    ]

    fallback_used = False
    try:
        response = _create_completion(client, model, messages, {
            'type': 'json_schema',
            'json_schema': {
                'name': _SCHEMA_NAME,
                'schema': json_schema,
                'strict': True,
            },
        })
    except BadRequestError:
        logger.warning('json_schema 被 API 拒绝，回退到 json_object 模式重试。')
        fallback_used = True
        response = _create_completion(
            client, model, messages, {'type': 'json_object'},
        )

    content = response.choices[0].message.content
    if not content:
        raise RuntimeError('LLM 返回内容为空')

    payload = json.loads(content)
    if fallback_used:
        _validate_payload(payload, json_schema)
    return payload
