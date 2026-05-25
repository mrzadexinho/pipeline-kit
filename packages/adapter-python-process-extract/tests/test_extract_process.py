"""Tests for extract_process — mock-based, no live provider calls."""

from __future__ import annotations

import sys
from unittest.mock import MagicMock

import pytest
from pydantic import BaseModel

from pkit_process_extract import ExtractProcessConfig, ProcessResult, create_extract_process


class Person(BaseModel):
    name: str
    age: int


# ---------------------------------------------------------------------------
# Test 1: Happy path — mock Anthropic returning valid data
# ---------------------------------------------------------------------------


def test_extract_success(monkeypatch: pytest.MonkeyPatch) -> None:
    """Mock anthropic client returning JSON matching schema; result.ok is True."""
    # Build a mock tool_use block
    tool_block = MagicMock()
    tool_block.type = "tool_use"
    tool_block.input = {"name": "Alice", "age": 30}

    mock_response = MagicMock()
    mock_response.content = [tool_block]

    mock_client_instance = MagicMock()
    mock_client_instance.messages.create.return_value = mock_response

    mock_anthropic_class = MagicMock(return_value=mock_client_instance)

    mock_anthropic_module = MagicMock()
    mock_anthropic_module.Anthropic = mock_anthropic_class
    monkeypatch.setitem(sys.modules, "anthropic", mock_anthropic_module)

    config = ExtractProcessConfig(
        provider="anthropic",
        model="claude-3-5-haiku-latest",
        prompt="Extract person from: {input}",
        output_schema=Person,
        api_key="test-key",
    )
    process = create_extract_process(config)

    import asyncio

    result: ProcessResult[Person] = asyncio.get_event_loop().run_until_complete(
        process.run("Alice is 30 years old")
    )

    assert result.ok is True
    assert result.value is not None
    assert result.value.name == "Alice"
    assert result.value.age == 30
    assert result.error is None


# ---------------------------------------------------------------------------
# Test 2: Schema validation failure on first call, valid on second (retry)
# ---------------------------------------------------------------------------


def test_schema_validation_failure_retry(monkeypatch: pytest.MonkeyPatch) -> None:
    """Mock returns invalid JSON first, valid second; retry consumed; result ok."""
    # First call returns data missing required 'age' field
    invalid_block = MagicMock()
    invalid_block.type = "tool_use"
    invalid_block.input = {"name": "Bob"}  # missing 'age'

    valid_block = MagicMock()
    valid_block.type = "tool_use"
    valid_block.input = {"name": "Bob", "age": 25}

    invalid_response = MagicMock()
    invalid_response.content = [invalid_block]

    valid_response = MagicMock()
    valid_response.content = [valid_block]

    mock_client_instance = MagicMock()
    mock_client_instance.messages.create.side_effect = [invalid_response, valid_response]

    mock_anthropic_class = MagicMock(return_value=mock_client_instance)
    mock_anthropic_module = MagicMock()
    mock_anthropic_module.Anthropic = mock_anthropic_class
    monkeypatch.setitem(sys.modules, "anthropic", mock_anthropic_module)

    config = ExtractProcessConfig(
        provider="anthropic",
        model="claude-3-5-haiku-latest",
        prompt="Extract person: {input}",
        output_schema=Person,
        api_key="test-key",
        max_retries_on_schema_failure=2,
    )
    process = create_extract_process(config)

    import asyncio

    result: ProcessResult[Person] = asyncio.get_event_loop().run_until_complete(
        process.run("Bob is 25")
    )

    assert result.ok is True
    assert result.value is not None
    assert result.value.name == "Bob"
    assert result.value.age == 25
    # Verify it did call the provider twice (first invalid + first retry)
    assert mock_client_instance.messages.create.call_count == 2


# ---------------------------------------------------------------------------
# Test 3: Provider not installed raises RuntimeError with helpful message
# ---------------------------------------------------------------------------


def test_provider_not_installed(monkeypatch: pytest.MonkeyPatch) -> None:
    """Monkeypatching sys.modules to make anthropic import fail triggers RuntimeError."""
    # Remove anthropic from sys.modules so ImportError is raised on import
    monkeypatch.delitem(sys.modules, "anthropic", raising=False)

    # Make the import itself fail by setting to None — Python raises ImportError on None
    monkeypatch.setitem(sys.modules, "anthropic", None)  # type: ignore[arg-type]

    config = ExtractProcessConfig(
        provider="anthropic",
        model="claude-3-5-haiku-latest",
        prompt="Extract: {input}",
        output_schema=Person,
        api_key="test-key",
    )
    process = create_extract_process(config)

    import asyncio

    result: ProcessResult[Person] = asyncio.get_event_loop().run_until_complete(
        process.run("some input")
    )

    assert result.ok is False
    assert result.error is not None
    assert result.error.code == "provider_not_installed"
    assert "pip install" in result.error.message
