"""Cat IX spike #1 — hand-written Pydantic v2 mirror of TS Zod schema.

Deliberately NOT generated. The friction we want to surface is the manual gap
between the TS-side Zod-equivalent (ts/validate.ts) and this file.
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

ID_RE = re.compile(r"^pk_atom_[A-Z0-9]{26}$")
RemoteMode = Literal["remote", "hybrid", "onsite", "unknown"]


def _parse_iso(value: str) -> str:
    # Python's datetime.fromisoformat in 3.11+ accepts Z suffix; for 3.12 we keep tolerant.
    try:
        # Python 3.12 fromisoformat handles 'Z' since 3.11. Still normalise:
        v = value.replace("Z", "+00:00") if value.endswith("Z") else value
        datetime.fromisoformat(v)
    except ValueError as e:
        raise ValueError(f"not ISO 8601: {value!r}") from e
    return value


class Job(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, max_length=200)
    company: str = Field(min_length=1, max_length=100)
    location: str | None
    posted_at: str | None
    salary_min: int | None
    salary_max: int | None
    remote: RemoteMode
    tags: list[str] = Field(max_length=20)

    @field_validator("posted_at")
    @classmethod
    def _check_posted_at(cls, v: str | None) -> str | None:
        return None if v is None else _parse_iso(v)


class Atom(BaseModel):
    """Atom<Job> — mirror of spec-api-surface.md line 86."""

    model_config = ConfigDict(extra="allow")  # source_id, stage_id, run_id are optional pass-through

    id: str
    object: Literal["atom"]
    created_at: str
    metadata: dict[str, Any]
    data: Job

    @field_validator("id")
    @classmethod
    def _check_id(cls, v: str) -> str:
        if not ID_RE.match(v):
            raise ValueError(f"id must match {ID_RE.pattern}, got {v!r}")
        return v

    @field_validator("created_at")
    @classmethod
    def _check_created_at(cls, v: str) -> str:
        return _parse_iso(v)


class ResultErr(BaseModel):
    type: str
    code: str
    message: str


class ResultOk(BaseModel):
    """Result<Atom[], E> — discriminated by error == null."""

    model_config = ConfigDict(extra="forbid")

    data: list[Atom]
    error: None
