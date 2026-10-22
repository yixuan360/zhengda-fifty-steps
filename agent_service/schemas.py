"""Agent 服务 HTTP 契约（字段名与实施计划一字不差）。"""
from pydantic import BaseModel, Field


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
