"""OpenAI 兼容 LLM 客户端（独立于 Django，只读环境变量）。

环境变量：
    NARRATIVE_LLM_BASE_URL  （可选）
    NARRATIVE_LLM_API_KEY   （必填）
    NARRATIVE_LLM_MODEL     （必填）
"""
import os

from openai import APIConnectionError, OpenAI

TIMEOUT_SECONDS = 60


def _env(name, default=''):
    return (os.environ.get(name) or default).strip()


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
        timeout=TIMEOUT_SECONDS,
        max_retries=0,
    ), model


def generate(system_prompt, user_prompt, timeout=TIMEOUT_SECONDS,
             max_tokens=None, attempts=2):
    """调用 chat.completions，返回纯文本；网络错误最多尝试 attempts 次。

    timeout / max_tokens / attempts 供路线解释等短任务覆盖默认值。
    """
    client, model = _build_client()
    messages = [
        {'role': 'system', 'content': system_prompt},
        {'role': 'user', 'content': user_prompt},
    ]
    options = {'model': model, 'messages': messages, 'timeout': timeout}
    if max_tokens:
        options['max_tokens'] = max_tokens

    attempts = max(1, attempts)
    for attempt in range(attempts):
        try:
            response = client.chat.completions.create(**options)
            return response.choices[0].message.content or ''
        except APIConnectionError:
            if attempt == attempts - 1:
                raise

    return ''
