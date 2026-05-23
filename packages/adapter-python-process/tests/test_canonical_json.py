"""Tests for pkit_wire.canonical_json — RFC 8785 JCS encoder."""

import json
import pytest
from hypothesis import given, settings, strategies as st

from pkit_wire.canonical_json import canonical_json, MAX_SAFE_INTEGER


# --- Key ordering ---

def test_keys_sorted():
    result = canonical_json({"z": 1, "a": 2, "m": 3})
    assert result == b'{"a":2,"m":3,"z":1}'


def test_keys_sorted_nested():
    result = canonical_json({"z": {"y": 1, "a": 2}, "a": 0})
    assert result == b'{"a":0,"z":{"a":2,"y":1}}'


def test_empty_object():
    assert canonical_json({}) == b"{}"


def test_empty_array():
    assert canonical_json([]) == b"[]"


# --- Separator correctness (no whitespace) ---

def test_no_whitespace_in_object():
    result = canonical_json({"key": "value"})
    assert b" " not in result
    assert result == b'{"key":"value"}'


def test_no_whitespace_in_array():
    result = canonical_json([1, 2, 3])
    assert b" " not in result
    assert result == b"[1,2,3]"


def test_unicode_passthrough():
    """ensure_ascii=False preserves non-ASCII codepoints without \\uXXXX escape."""
    result = canonical_json({"key": "café"})
    assert "\\u" not in result.decode("utf-8")
    assert result == '{"key":"café"}'.encode("utf-8")


# --- MAX_SAFE_INTEGER boundary ---

def test_max_safe_integer_passes():
    result = canonical_json(MAX_SAFE_INTEGER)
    assert result == str(MAX_SAFE_INTEGER).encode("utf-8")


def test_negative_max_safe_integer_passes():
    result = canonical_json(-MAX_SAFE_INTEGER)
    assert result == f"-{MAX_SAFE_INTEGER}".encode("utf-8")


def test_over_max_safe_integer_raises():
    with pytest.raises(TypeError) as exc_info:
        canonical_json(MAX_SAFE_INTEGER + 1)
    assert "safe integer range" in str(exc_info.value)


def test_under_negative_max_safe_integer_raises():
    with pytest.raises(TypeError):
        canonical_json(-(MAX_SAFE_INTEGER + 1))


def test_zero_passes():
    assert canonical_json(0) == b"0"


def test_boolean_not_integer_checked():
    """bool is subclass of int but should not fail integer check."""
    assert canonical_json(True) == b"true"
    assert canonical_json(False) == b"false"


def test_null_serializes():
    assert canonical_json(None) == b"null"


def test_nested_integer_overflow_raises():
    with pytest.raises(TypeError):
        canonical_json({"safe": 1, "unsafe": MAX_SAFE_INTEGER + 1})


# --- Round-trip property ---

@given(st.dictionaries(
    st.text(min_size=1, max_size=10),
    st.one_of(
        st.integers(min_value=-MAX_SAFE_INTEGER, max_value=MAX_SAFE_INTEGER),
        st.text(max_size=20),
        st.booleans(),
        st.none(),
    ),
    max_size=5,
))
def test_canonical_roundtrip(obj):
    """canonical_json output must parse back to the same object."""
    encoded = canonical_json(obj)
    decoded = json.loads(encoded.decode("utf-8"))
    assert decoded == obj


@given(st.text(min_size=1, max_size=5))
def test_single_key_roundtrip(key):
    """Single-key object must round-trip through JSON parse."""
    obj = {key: "v"}
    encoded = canonical_json(obj)
    assert json.loads(encoded.decode("utf-8")) == obj


# --- Return type ---

def test_returns_bytes():
    result = canonical_json({"a": 1})
    assert isinstance(result, bytes)
