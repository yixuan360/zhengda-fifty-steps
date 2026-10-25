"""Agent 服务 HTTP 契约（字段名与实施计划一字不差）。"""
import json
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator


class NarrativeRequest(BaseModel):
    spot_id: int
    dimension: str
    current_depth: int = Field(default=0, ge=0)
    listened_fact_ids: list[int] = Field(default_factory=list)
    max_seconds: int = Field(default=60, gt=0)


class Citation(BaseModel):
    fact_id: int
    fact_text: str


class NarrativeResponse(BaseModel):
    text: str
    citations: list[Citation]
    depth: int
    audio_url: str | None
    fallback: bool


def _limited_context(value):
    raw = json.dumps(value, ensure_ascii=False).encode('utf-8')
    if len(raw) > 1024:
        raise ValueError('context 不能超过 1024 字节')
    return value


class RoutePlanRequest(BaseModel):
    minutes: int = Field(default=30, ge=10, le=180)
    interests: list[str] = Field(default_factory=list, max_length=8)
    start_spot_id: int | None = Field(default=None, ge=1)
    context: dict[str, Any] = Field(default_factory=dict)

    @field_validator('interests')
    @classmethod
    def _limit_interests(cls, value):
        cleaned = [str(item).strip()[:20] for item in value if str(item).strip()]
        if len(cleaned) > 8:
            raise ValueError('interests 最多 8 项')
        return cleaned

    @field_validator('context')
    @classmethod
    def _limit_context(cls, value):
        return _limited_context(value)


class ExcludedStop(BaseModel):
    order: int
    reason: str


class RoutePlanResponse(BaseModel):
    route_code: str
    route_name: str
    stops: list[int]
    excluded: list[ExcludedStop]
    total_minutes: int
    walking_km: float
    explanation: str
    fallback: bool = False
    start_order: int = 1


class RouteAdaptRequest(BaseModel):
    route_code: str = Field(min_length=1, max_length=40)
    current_order: int = Field(ge=1)
    action: Literal['time_short', 'rain', 'more']
    # 当前计划已选站序；不传则按“从头到当前站”处理
    current_stops: list[int] | None = Field(default=None, max_length=20)
    context: dict[str, Any] = Field(default_factory=dict)

    @field_validator('current_stops')
    @classmethod
    def _check_stops(cls, value):
        if value is not None and any(order < 1 for order in value):
            raise ValueError('current_stops 必须是正整数')
        return value

    @field_validator('context')
    @classmethod
    def _limit_context(cls, value):
        return _limited_context(value)


class RouteAdaptResponse(BaseModel):
    route_code: str
    stops: list[int]
    total_minutes: int
    end_reason: str
    message: str
    fallback: bool = False
    shelter_spot_id: int | None = None
    shelter_name: str | None = None
    deep_dive: dict[str, Any] | None = None
