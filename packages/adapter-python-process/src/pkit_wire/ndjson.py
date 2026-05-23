"""ndjson — Async NDJSON frame read/write helpers for pipeline-kit adapters.

NEVER use print() to write to stdout in adapter code. print() is block-buffered
on pipes — frames accumulate until process exit (Cat IX spike-2 finding).
All output MUST go through the anyio-wrapped stdout with explicit flush after
every frame.

Usage pattern:
    import anyio, sys
    from io import TextIOWrapper
    from pydantic import BaseModel
    from pkit_wire.ndjson import read_frames, write_frame

    async def main():
        stdin = anyio.wrap_file(TextIOWrapper(sys.stdin.buffer, encoding="utf-8", errors="replace"))
        stdout = anyio.wrap_file(TextIOWrapper(sys.stdout.buffer, encoding="utf-8"))
        async for frame in read_frames(stdin, MyModel):
            result = process(frame)
            await write_frame(stdout, result)

Reference: packages/core/src/wire/ndjson.ts + MCP Python SDK stdio.py
"""

from __future__ import annotations

from typing import Any, AsyncIterator, TypeVar

from pydantic import BaseModel

T = TypeVar("T", bound=BaseModel)


async def read_frames(stdin: Any, model: type[T]) -> AsyncIterator[T]:
    """Yield validated model instances from an anyio-wrapped NDJSON stdin.

    Passes raw line bytes directly to model_validate_json — no json.loads —
    to use pydantic's jiter Rust backend (Finding 6).
    """
    async for line in stdin:
        line = line.rstrip("\n").rstrip("\r")
        if not line:
            continue
        yield model.model_validate_json(line, strict=True)


async def write_frame(stdout: Any, frame: BaseModel) -> None:
    """Serialize frame to NDJSON, write to stdout, and flush immediately.

    flush is load-bearing: without it frames accumulate in the kernel pipe
    buffer until process exit (Cat IX Finding 4 + Finding 10).
    NEVER call print() here or in adapter code.
    """
    await stdout.write(frame.model_dump_json(by_alias=True, exclude_unset=True) + "\n")
    await stdout.flush()
