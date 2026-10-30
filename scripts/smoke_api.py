"""Exercise a running API using only Python's standard library.

Usage: python scripts/smoke_api.py --base-url http://127.0.0.1:8000
The script submits real analysis jobs. It does not start or stop the server.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import time
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


class SmokeFailure(RuntimeError):
    """A failed API expectation, with enough detail to diagnose it."""


def check(condition: bool, message: str) -> None:
    if not condition:
        raise SmokeFailure(message)


def card(value: str) -> int:
    """Map e.g. As to the public API's rank * 4 + suit encoding."""
    return "23456789TJQKA".index(value[0]) * 4 + "shcd".index(value[1])


class Api:
    def __init__(self, base_url: str, timeout: float, poll_interval: float):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.poll_interval = poll_interval

    def request(
        self,
        path: str,
        payload: dict[str, Any] | None = None,
        *,
        method: str = "GET",
        expected_status: int = 200,
    ) -> Any:
        data = None if payload is None else json.dumps(payload).encode("utf-8")
        request = Request(
            self.base_url + path,
            data=data,
            method=method,
            headers={"Content-Type": "application/json", "Accept": "application/json"},
        )
        try:
            with urlopen(request, timeout=min(self.timeout, 15)) as response:
                status = response.status
                body = response.read().decode("utf-8")
        except HTTPError as exc:
            status = exc.code
            body = exc.read().decode("utf-8", errors="replace")
        except URLError as exc:
            raise SmokeFailure(f"Cannot reach {request.full_url}: {exc.reason}") from exc
        check(
            status == expected_status,
            f"{method} {path}: expected HTTP {expected_status}, got {status}: {body}",
        )
        try:
            return json.loads(body)
        except json.JSONDecodeError as exc:
            raise SmokeFailure(f"{method} {path}: expected JSON, received {body!r}") from exc

    def analyze(self, scenario: dict[str, Any]) -> dict[str, Any]:
        created = self.request(
            "/api/v1/analyses", scenario, method="POST", expected_status=202
        )
        check(isinstance(created, dict), f"Invalid task response: {created!r}")
        task_id = created.get("task_id")
        check(isinstance(task_id, str) and bool(task_id), f"Missing task_id: {created!r}")
        check(
            created.get("status") in {"queued", "running"},
            f"Unexpected initial task state: {created!r}",
        )
        deadline = time.monotonic() + self.timeout
        previous_progress = 0.0
        while time.monotonic() < deadline:
            task = self.request(f"/api/v1/analyses/{task_id}")
            check(task.get("task_id") == task_id, f"Task identity changed: {task!r}")
            progress = task.get("progress")
            check(
                isinstance(progress, (int, float)) and 0 <= progress <= 1,
                f"Progress must be a fraction in [0, 1]: {task!r}",
            )
            check(progress >= previous_progress, f"Task progress moved backwards: {task!r}")
            previous_progress = progress
            status = task.get("status")
            if status == "succeeded":
                check(progress == 1, f"Successful task is not complete: {task!r}")
                result = task.get("result")
                check(isinstance(result, dict), f"Successful task has no result: {task!r}")
                self.check_probabilities(result)
                return result
            check(
                status in {"queued", "running"},
                f"Task {task_id} ended unexpectedly: {task!r}",
            )
            time.sleep(self.poll_interval)
        raise SmokeFailure(f"Task {task_id} did not finish within {self.timeout:g} seconds")

    @staticmethod
    def check_probabilities(result: dict[str, Any]) -> None:
        for name in ("win_probability", "tie_probability", "lose_probability", "equity"):
            value = result.get(name)
            check(
                isinstance(value, (int, float)) and math.isfinite(value) and 0 <= value <= 1,
                f"Invalid {name}: {value!r}",
            )
        total = sum(result[name] for name in (
            "win_probability", "tie_probability", "lose_probability"
        ))
        check(math.isclose(total, 1, abs_tol=1e-10), f"Outcome probabilities sum to {total}")
        check(result.get("sample_count", 0) > 0, f"No samples evaluated: {result!r}")
        check(result.get("method") in {"exact", "monteCarlo"}, "Unknown calculation method")
        check(result.get("strategy", {}).get("id") == "pot-odds", "Unexpected strategy")


def scenario(**changes: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "hero": [card("As"), card("Ah")],
        "board": [],
        "dead_cards": [],
        "opponents": [{"kind": "exact", "cards": [card("Ks"), card("Kh")]}],
        "pot_before_call": 150,
        "call_amount": 50,
        "settlement_assumption": "showdownAfterCall",
        "strategy_id": "pot-odds",
        "samples": 1000,
        "seed": 42,
    }
    base.update(changes)
    return base


def run(api: Api) -> None:
    api.request("/health")
    print("PASS health")
    strategies = api.request("/api/v1/strategies")
    check(
        any(item.get("id") == "pot-odds" for item in strategies.get("strategies", [])),
        f"Baseline strategy missing: {strategies!r}",
    )
    print("PASS strategy discovery")

    result = api.analyze(scenario())
    check(
        math.isclose(result["break_even_equity"], 0.25, abs_tol=1e-10),
        f"Wrong pot-odds threshold: {result!r}",
    )
    check(
        math.isclose(result["call_ev"], result["equity"] * 200 - 50, abs_tol=1e-8),
        f"Call EV does not use equity and incremental call amount: {result!r}",
    )
    print("PASS task lifecycle, probability invariants and call EV")

    tied = api.analyze(scenario(
        hero=[card("2h"), card("3h")],
        board=[card(value) for value in ("Ts", "Js", "Qs", "Ks", "As")],
        opponents=[{"kind": "random"}, {"kind": "random"}],
    ))
    check(tied["win_probability"] == 0, f"Board royal flush should never win alone: {tied!r}")
    check(tied["tie_probability"] == 1, f"Board royal flush should always tie: {tied!r}")
    check(math.isclose(tied["equity"], 1 / 3, abs_tol=1e-10), f"Wrong three-way split: {tied!r}")
    print("PASS three-way board royal flush (equity = 1/3)")

    royal = scenario(
        hero=[card("As"), card("Ks")],
        board=[card(value) for value in ("Qs", "Js", "Ts", "2h", "3c")],
        opponents=[{"kind": "exact", "cards": [card("4h"), card("4d")]}],
    )
    winner = api.analyze(royal)
    check(winner["win_probability"] == 1 and winner["equity"] == 1, f"Royal flush lost: {winner!r}")
    check(winner["method"] == "exact", f"Fully known river should be enumerated: {winner!r}")
    print("PASS deterministic river win")

    invalid = api.request(
        "/api/v1/analyses", scenario(hero=[card("As"), card("As")]),
        method="POST", expected_status=422,
    )
    check(bool(invalid.get("detail")), f"Validation response has no detail: {invalid!r}")
    print("PASS duplicate-card validation")

    free = api.analyze({**royal, "opponents": [{"kind": "random"}], "call_amount": 0})
    check(free["pot_odds_ratio"] is None, f"Zero call must not have a pot ratio: {free!r}")
    check(free["break_even_equity"] in (0, None), f"Invalid free-call threshold: {free!r}")
    check(
        free["method"] == "exact" and free["sample_count"] == math.comb(45, 2),
        f"Unknown river opponent must enumerate every remaining two-card hand: {free!r}",
    )
    check(free["equity"] == 1, f"Royal flush must beat every unknown hand: {free!r}")
    print("PASS zero-call boundary and exact enumeration of an unknown opponent")

    future = api.analyze({**royal, "settlement_assumption": "futureBettingPossible"})
    assumptions = future.get("assumptions", [])
    check(isinstance(assumptions, list) and bool(assumptions), f"Missing assumptions: {future!r}")
    explanation = " ".join(str(value) for value in assumptions).lower()
    check(
        any(term in explanation for term in ("未来", "后续", "future", "further")),
        f"Future-betting limitation is not explained: {future!r}",
    )
    print("PASS future-betting assumptions")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--timeout", type=float, default=60, help="Per-analysis timeout in seconds")
    parser.add_argument("--poll-interval", type=float, default=0.15)
    args = parser.parse_args()
    if args.timeout <= 0 or args.poll_interval <= 0:
        parser.error("--timeout and --poll-interval must be positive")
    try:
        run(Api(args.base_url, args.timeout, args.poll_interval))
    except (SmokeFailure, TimeoutError, OSError) as exc:
        print(f"FAIL {exc}", file=sys.stderr)
        return 1
    print("All API smoke checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
