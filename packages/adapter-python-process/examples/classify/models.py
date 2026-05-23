"""Pydantic v2 models for the classify adapter wire boundary.

Defines the NDJSON frame shapes that cross the stdin/stdout boundary.
All models use extra="forbid" to enforce strict wire contract.

Input frame shape:
  {"body": {"text": "<str>", "metadata": {"idempotencyKey": "<str>", "traceparent": "<str>"}}}

Output frame shape (success):
  {"body": {"data": {"bucket": "short"|"medium"|"long", "idempotencyKey": "<str>"}, "error": null}}

Output frame shape (error):
  {"body": {"data": null, "error": {"type": "process_error", "code": "...", "message": "..."}}}
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict


class InputMetadata(BaseModel):
    """Metadata carried on every input frame."""

    model_config = ConfigDict(extra="forbid")

    idempotencyKey: str | None = None
    traceparent: str | None = None


class InputBody(BaseModel):
    """Body of an input NDJSON frame."""

    model_config = ConfigDict(extra="forbid")

    text: str | None = None
    metadata: InputMetadata = InputMetadata()


class InputFrame(BaseModel):
    """Top-level input NDJSON frame."""

    model_config = ConfigDict(extra="forbid")

    body: InputBody


class OutputData(BaseModel):
    """Success payload — bucket classification result."""

    model_config = ConfigDict(extra="forbid")

    bucket: Literal["short", "medium", "long"]
    idempotencyKey: str | None = None


class OutputError(BaseModel):
    """Error payload — process_error envelope."""

    model_config = ConfigDict(extra="forbid")

    type: Literal["process_error"]
    code: str
    message: str


class OutputBody(BaseModel):
    """Body of an output NDJSON frame."""

    model_config = ConfigDict(extra="forbid")

    data: OutputData | None = None
    error: OutputError | None = None


class OutputFrame(BaseModel):
    """Top-level output NDJSON frame."""

    model_config = ConfigDict(extra="forbid")

    body: OutputBody
