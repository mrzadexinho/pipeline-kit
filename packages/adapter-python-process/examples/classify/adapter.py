"""Reference process-classify Python adapter — NDJSON + OTel span + idempotencyKey.

Reads NDJSON frames from stdin, classifies text by length bucket, writes result
frames to stdout. Picks up idempotencyKey and traceparent from frame metadata.

Invocation:
  python -m examples.classify.adapter

Wire contract:
  Input:  {"body": {"text": "<str>", "metadata": {"idempotencyKey": "<str>", "traceparent": "<str>"}}}
  Output: {"body": {"data": {"bucket": "short"|"medium"|"long", "idempotencyKey": "<str>"}, "error": null}}
  Error:  {"body": {"data": null, "error": {"type": "process_error", "code": "classify/missing_input", ...}}}

All debug/log output goes to sys.stderr exclusively. Never print() to stdout.
"""

from __future__ import annotations

import sys
from io import TextIOWrapper

import anyio
import anyio.abc
from opentelemetry import trace
from opentelemetry.propagate import extract

from examples.classify.models import (
    InputFrame,
    OutputBody,
    OutputData,
    OutputError,
    OutputFrame,
)

tracer = trace.get_tracer("pkit.classify")

# Bucket thresholds (inclusive upper bound for medium)
_BUCKET_SHORT_MAX = 99      # len < 100  → "short"
_BUCKET_MEDIUM_MAX = 500    # 100 <= len <= 500 → "medium"
                            # len > 500  → "long"


def _classify_bucket(text: str) -> str:
    n = len(text)
    if n < 100:
        return "short"
    if n <= 500:
        return "medium"
    return "long"


async def main() -> None:
    """Entry point: wire stdin/stdout, run reader+writer concurrently."""
    stdin = anyio.wrap_file(TextIOWrapper(sys.stdin.buffer, encoding="utf-8", errors="replace"))
    stdout = anyio.wrap_file(TextIOWrapper(sys.stdout.buffer, encoding="utf-8"))

    send_ch, recv_ch = anyio.create_memory_object_stream[InputFrame](max_buffer_size=16)

    async def stdin_reader() -> None:
        async with send_ch:
            async for line in stdin:
                line = line.rstrip("\n").rstrip("\r")
                if not line:
                    continue
                try:
                    frame = InputFrame.model_validate_json(line, strict=True)
                    await send_ch.send(frame)
                except Exception as exc:  # noqa: BLE001
                    print(f"[classify] parse error: {exc}", file=sys.stderr, flush=True)

    async def stdout_writer() -> None:
        async with recv_ch:
            async for frame in recv_ch:
                out_frame = _process_frame(frame)
                await stdout.write(
                    out_frame.model_dump_json(by_alias=True, exclude_unset=True) + "\n"
                )
                await stdout.flush()

    async with anyio.create_task_group() as tg:
        tg.start_soon(stdin_reader)
        tg.start_soon(stdout_writer)


def _process_frame(frame: InputFrame) -> OutputFrame:
    """Classify one frame; return an OutputFrame (success or error)."""
    text = frame.body.text
    metadata = frame.body.metadata
    idempotency_key = metadata.idempotencyKey
    traceparent = metadata.traceparent

    # OTel: extract W3C context and start a child span
    ctx = extract({"traceparent": traceparent}) if traceparent else None
    span_kwargs: dict = {"context": ctx} if ctx is not None else {}

    with tracer.start_as_current_span("classify.process", **span_kwargs):
        if text is None:
            out_error = OutputError(
                type="process_error",
                code="classify/missing_input",
                message="Required field 'text' is missing from input frame body",
            )
            return OutputFrame(body=OutputBody(error=out_error))

        bucket = _classify_bucket(text)
        data_kwargs: dict = {"bucket": bucket}
        if idempotency_key is not None:
            data_kwargs["idempotencyKey"] = idempotency_key
        out_data = OutputData(**data_kwargs)  # type: ignore[arg-type]
        return OutputFrame(body=OutputBody(data=out_data))


if __name__ == "__main__":
    anyio.run(main)
