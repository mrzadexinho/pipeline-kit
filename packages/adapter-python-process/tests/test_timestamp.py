"""Tests for pkit_wire.timestamp — RFC 3339 millisecond-precision validator."""

import pytest

from pkit_wire.timestamp import validate_timestamp


# --- Valid timestamps ---

def test_utc_z_suffix():
    ts = "2026-05-23T10:30:00.123Z"
    assert validate_timestamp(ts) == ts


def test_positive_offset():
    ts = "2026-05-23T10:30:00.123+05:30"
    assert validate_timestamp(ts) == ts


def test_negative_offset():
    ts = "2026-05-23T10:30:00.123-08:00"
    assert validate_timestamp(ts) == ts


def test_zero_offset():
    ts = "2026-01-01T00:00:00.000+00:00"
    assert validate_timestamp(ts) == ts


def test_midnight_utc():
    ts = "2026-12-31T23:59:59.999Z"
    assert validate_timestamp(ts) == ts


def test_passthrough_returns_original():
    """validate_timestamp must return the original string unchanged."""
    ts = "2026-05-23T10:30:00.456Z"
    result = validate_timestamp(ts)
    assert result is ts


# --- Fractional-second violations ---

def test_7_digit_fraction_raises():
    """Python 3.12 fromisoformat silently truncates this — must be caught."""
    with pytest.raises(ValueError) as exc_info:
        validate_timestamp("2026-05-23T10:30:00.1234567Z")
    assert "sub-millisecond" in str(exc_info.value).lower()


def test_4_digit_fraction_raises():
    with pytest.raises(ValueError) as exc_info:
        validate_timestamp("2026-05-23T10:30:00.1234Z")
    assert "sub-millisecond" in str(exc_info.value).lower()


def test_no_fractional_raises():
    """Missing fractional seconds must fail — no fromisoformat fallback."""
    with pytest.raises(ValueError):
        validate_timestamp("2026-05-23T10:30:00Z")


def test_1_digit_fraction_raises():
    with pytest.raises(ValueError):
        validate_timestamp("2026-05-23T10:30:00.1Z")


def test_2_digit_fraction_raises():
    with pytest.raises(ValueError):
        validate_timestamp("2026-05-23T10:30:00.12Z")


# --- Format violations ---

def test_missing_time_part_raises():
    with pytest.raises(ValueError):
        validate_timestamp("2026-05-23")


def test_wrong_separator_raises():
    with pytest.raises(ValueError):
        validate_timestamp("2026-05-23 10:30:00.123Z")


def test_empty_string_raises():
    with pytest.raises(ValueError):
        validate_timestamp("")


def test_non_string_raises():
    with pytest.raises(ValueError):
        validate_timestamp(1234567890)  # type: ignore[arg-type]


def test_no_offset_raises():
    """Timestamp without timezone offset is invalid."""
    with pytest.raises(ValueError):
        validate_timestamp("2026-05-23T10:30:00.123")
