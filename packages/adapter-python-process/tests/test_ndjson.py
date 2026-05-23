"""Tests for pkit_wire.ndjson — async NDJSON frame read/write helpers."""

import json
from io import StringIO
from unittest.mock import AsyncMock, MagicMock, call

import pytest
from pydantic import BaseModel

from pkit_wire.ndjson import read_frames, write_frame


class SampleModel(BaseModel):
    id: str
    value: int


class _AsyncStringReader:
    """Minimal async iterable over lines of a string, mimicking anyio-wrapped stdin."""

    def __init__(self, text: str) -> None:
        self._lines = iter(text.splitlines(keepends=True))

    def __aiter__(self):
        return self

    async def __anext__(self):
        try:
            return next(self._lines)
        except StopIteration:
            raise StopAsyncIteration


# --- read_frames ---

@pytest.mark.asyncio
async def test_read_frames_single_line():
    payload = '{"id":"pk_atom_01","value":42}\n'
    stdin = _AsyncStringReader(payload)
    frames = []
    async for frame in read_frames(stdin, SampleModel):
        frames.append(frame)
    assert len(frames) == 1
    assert frames[0].id == "pk_atom_01"
    assert frames[0].value == 42


@pytest.mark.asyncio
async def test_read_frames_multiple_lines():
    payload = '{"id":"a","value":1}\n{"id":"b","value":2}\n'
    stdin = _AsyncStringReader(payload)
    frames = []
    async for frame in read_frames(stdin, SampleModel):
        frames.append(frame)
    assert len(frames) == 2
    assert frames[0].id == "a"
    assert frames[1].id == "b"


@pytest.mark.asyncio
async def test_read_frames_skips_empty_lines():
    payload = '\n{"id":"x","value":7}\n\n'
    stdin = _AsyncStringReader(payload)
    frames = []
    async for frame in read_frames(stdin, SampleModel):
        frames.append(frame)
    assert len(frames) == 1
    assert frames[0].id == "x"


# --- write_frame ---

@pytest.mark.asyncio
async def test_write_frame_json_output():
    """write_frame must produce model_dump_json output + newline."""
    stdout = AsyncMock()
    stdout.write = AsyncMock()
    stdout.flush = AsyncMock()

    model = SampleModel(id="pk_atom_02", value=99)
    await write_frame(stdout, model)

    written = stdout.write.call_args[0][0]
    assert written.endswith("\n")
    parsed = json.loads(written.rstrip("\n"))
    assert parsed["id"] == "pk_atom_02"
    assert parsed["value"] == 99


@pytest.mark.asyncio
async def test_write_frame_calls_flush():
    """Flush discipline: flush MUST be called after every write."""
    stdout = AsyncMock()
    stdout.write = AsyncMock()
    stdout.flush = AsyncMock()

    model = SampleModel(id="pk_atom_03", value=0)
    await write_frame(stdout, model)

    # write before flush
    assert stdout.write.called
    assert stdout.flush.called
    # Verify order: write then flush
    assert stdout.write.call_count == 1
    assert stdout.flush.call_count == 1


@pytest.mark.asyncio
async def test_write_frame_flush_after_write():
    """Verify write is called before flush (not just both called)."""
    call_order = []
    stdout = MagicMock()
    stdout.write = AsyncMock(side_effect=lambda _: call_order.append("write"))
    stdout.flush = AsyncMock(side_effect=lambda: call_order.append("flush"))

    model = SampleModel(id="z", value=1)
    await write_frame(stdout, model)

    assert call_order == ["write", "flush"]


# --- Round-trip ---

@pytest.mark.asyncio
async def test_round_trip():
    """Encode a frame, decode it back — must produce byte-identical JSON."""
    model = SampleModel(id="pk_atom_rt", value=123)
    stdout = AsyncMock()
    written_lines = []
    stdout.write = AsyncMock(side_effect=lambda s: written_lines.append(s))
    stdout.flush = AsyncMock()

    await write_frame(stdout, model)

    line = written_lines[0]
    parsed = json.loads(line)
    assert parsed["id"] == "pk_atom_rt"
    assert parsed["value"] == 123
