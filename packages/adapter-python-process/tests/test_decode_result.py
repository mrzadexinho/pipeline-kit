"""Tests for pkit_wire.decode_result — ADR IX-3 Result discriminator."""

import pytest
from hypothesis import given, strategies as st

from pkit_wire.decode_result import Ok, Err, WireDecodeError, decode_result


# --- Happy-path tests ---

def test_data_non_null_error_null_returns_ok():
    frame = {"data": {"id": "pk_atom_01"}, "error": None}
    result = decode_result(frame)
    assert isinstance(result, Ok)
    assert result.kind == "ok"
    assert result.value == {"id": "pk_atom_01"}


def test_data_null_error_non_null_returns_err():
    frame = {"data": None, "error": {"type": "process_error", "code": "e/fail", "message": "oops"}}
    result = decode_result(frame)
    assert isinstance(result, Err)
    assert result.kind == "err"
    assert result.error["code"] == "e/fail"


def test_ok_value_can_be_dict():
    result = decode_result({"data": {"nested": {"key": "value"}}, "error": None})
    assert isinstance(result, Ok)
    assert result.value["nested"]["key"] == "value"


def test_err_preserves_error_envelope():
    error = {"type": "process_error", "code": "classify/missing_input", "message": "missing text"}
    result = decode_result({"data": None, "error": error})
    assert isinstance(result, Err)
    assert result.error is error


# --- Ambiguous cases must raise ---

def test_both_null_raises():
    with pytest.raises(WireDecodeError) as exc_info:
        decode_result({"data": None, "error": None})
    assert exc_info.value.code == "wire/result_ambiguous"
    assert "Both data and error are None" in str(exc_info.value)


def test_both_non_null_raises():
    with pytest.raises(WireDecodeError) as exc_info:
        decode_result({"data": {"id": "x"}, "error": {"type": "e", "code": "e/x", "message": "x"}})
    assert exc_info.value.code == "wire/result_ambiguous"
    assert "Both data and error are non-None" in str(exc_info.value)


def test_missing_keys_both_absent_raises():
    """Frame with neither key present — both get() return None -> both-null ambiguous."""
    with pytest.raises(WireDecodeError) as exc_info:
        decode_result({})
    assert exc_info.value.code == "wire/result_ambiguous"


# --- Namedtuple shape checks ---

def test_ok_namedtuple_fields():
    r = decode_result({"data": 42, "error": None})
    assert r.kind == "ok"
    assert r.value == 42
    assert r[0] == "ok"  # positional access
    assert r[1] == 42


def test_err_namedtuple_fields():
    r = decode_result({"data": None, "error": "some error"})
    assert r.kind == "err"
    assert r.error == "some error"
    assert r[0] == "err"
    assert r[1] == "some error"


# --- Hypothesis property tests ---

@given(st.dictionaries(st.text(), st.integers()))
def test_ok_with_arbitrary_dict(payload):
    """Any dict as data with error=None should produce Ok."""
    r = decode_result({"data": payload, "error": None})
    assert isinstance(r, Ok)
    assert r.value == payload


@given(st.one_of(st.text(), st.integers(), st.floats(allow_nan=False), st.booleans()))
def test_err_with_arbitrary_scalar(err_payload):
    """Any non-None error with data=None should produce Err."""
    r = decode_result({"data": None, "error": err_payload})
    assert isinstance(r, Err)
    assert r.error == err_payload
