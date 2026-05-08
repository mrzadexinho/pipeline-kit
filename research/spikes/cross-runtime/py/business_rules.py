"""Cat IX spike #2 — pure business-rule checks (post-schema, pre-emit).

Returns Result-shaped Python dicts (no raises across the wire) so the caller
can serialise directly. Schema-valid atoms can still fail here — that is the
whole point of the spike's atom #3 case.
"""

from __future__ import annotations

from typing import Any, TypedDict


class WireErr(TypedDict):
    type: str
    code: str
    message: str


class RuleResultOk(TypedDict):
    ok: bool  # True
    err: None


class RuleResultErr(TypedDict):
    ok: bool  # False
    err: WireErr


def _ok() -> RuleResultOk:
    return {"ok": True, "err": None}


def _err(code: str, message: str, *, type_: str = "business_rule") -> RuleResultErr:
    return {"ok": False, "err": {"type": type_, "code": code, "message": message}}


def validate_salary_band(job: dict[str, Any]) -> RuleResultOk | RuleResultErr:
    """Reject schema-valid Jobs whose salary band is inverted.

    Both bounds may be null (schema permits), but if both are present and
    salary_max < salary_min, the band is non-sensical. This is exactly the
    "schema-valid but Process-rejected" case spike #2 question B targets.
    """
    smin = job.get("salary_min")
    smax = job.get("salary_max")
    if smin is None or smax is None:
        return _ok()
    if smax < smin:
        return _err(
            "salary_inverted",
            f"salary_max ({smax}) < salary_min ({smin}); band is inverted",
        )
    return _ok()


def run_all(job: dict[str, Any]) -> RuleResultOk | RuleResultErr:
    """Run every business rule. Short-circuits on first failure.

    Add additional rules to this chain as the spike grows; today only
    salary-band inversion ships.
    """
    for rule in (validate_salary_band,):
        r = rule(job)
        if not r["ok"]:
            return r
    return _ok()
