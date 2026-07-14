"""
统一异常处理：对齐 v4.0 §7.1 ApiResponse 格式
"""
from rest_framework.views import exception_handler
from rest_framework.exceptions import ValidationError
from django.core.exceptions import ValidationError as DjangoValidationError


def custom_exception_handler(exc, context):
    """将 DRF 异常转换为 { ok, data, message } 格式。"""
    response = exception_handler(exc, context)

    if response is not None:
        message = _extract_message(exc)
        response.data = {
            'ok': False,
            'data': None,
            'message': message,
        }

    return response


def _extract_message(exc):
    """从异常中提取人类可读的错误信息。"""
    # DRF ValidationError 的 detail 可能是 dict（字段级错误）
    if isinstance(exc, ValidationError):
        detail = exc.detail
        if isinstance(detail, dict):
            # 取第一个字段的第一条错误
            for field_errors in detail.values():
                if field_errors:
                    return str(field_errors[0]) if isinstance(field_errors, list) else str(field_errors)
        elif isinstance(detail, list):
            return str(detail[0])
        return str(detail)

    # Django ValidationError 类似结构
    if isinstance(exc, DjangoValidationError):
        if hasattr(exc, 'messages') and exc.messages:
            return str(exc.messages[0])
        return str(exc)

    return str(exc) if hasattr(exc, '__str__') else '请求失败'
