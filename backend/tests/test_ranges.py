import time
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from test_equity import cards, scenario
from test_strategy_contract import NeverCancelled

from poker_calculator.api.main import create_app
from poker_calculator.application.services import AnalysisServices
from poker_calculator.domain.models import AnalysisRequest
from poker_calculator.domain.ranges import RANKS, expand_class, parse_range
from poker_calculator.engines.equity import CalculationCancelled, calculate_equity
from poker_calculator.infrastructure.compute import execute_analysis


@pytest.mark.parametrize(
    "label,count",
    [
        ("AA", 6),
        ("AKs", 4),
        ("AKo", 12),
        ("AK", 16),
        ("TT+", 30),
        ("AJs+", 12),
        ("AA-TT", 30),
        ("AJs-AKs", 12),
    ],
)
def test_grammar(label: str, count: int) -> None:
    assert len(parse_range(label)) == count


@pytest.mark.parametrize(
    "text",
    [
        "",
        "AA:0",
        "AAs",
        "KA",
        "AKs:nan",
        "AKs:inf",
        "AKs:-1",
        "AKs:2",
        "AKs:0.0000001",
        "AsAs",
        "AKs-KQs",
        "bad",
        "AA:0.5:0.2",
    ],
)
def test_invalid_range(text: str) -> None:
    with pytest.raises(ValueError):
        parse_range(text)


def test_overlap_takes_maximum_weight() -> None:
    combos = parse_range("AKs:0.2 AKs:0.7 AsKs:0.9")
    assert len(combos) == 4
    assert sorted(combo.weight for combo in combos) == [0.7, 0.7, 0.7, 0.9]


def test_weighted_exact_and_sampled_oracle(monkeypatch: pytest.MonkeyPatch) -> None:
    request = scenario(
        board=cards("2s 3h 7c 9d Tc"),
        opponents=[{"kind": "range", "text": "KsKh:0.75 TsTh:0.25"}],
        samples=20000,
    )
    exact = calculate_equity(request)
    assert exact.method == "exact"
    assert exact.sample_count == 2
    assert exact.equity == 0.75
    monkeypatch.setattr("poker_calculator.engines.equity.EXACT_LIMIT", 0)
    sampled = calculate_equity(request)
    assert sampled.method == "monteCarlo"
    assert sampled.equity_standard_error is not None
    assert abs(sampled.equity - exact.equity) < 4 * sampled.equity_standard_error


def test_full_range_equivalent_to_random() -> None:
    labels = [rank * 2 for rank in RANKS]
    labels += [a + b for i, a in enumerate(RANKS) for b in RANKS[:i]]
    random = calculate_equity(scenario(opponents=[{"kind": "random"}]))
    full = calculate_equity(scenario(opponents=[{"kind": "range", "text": ",".join(labels)}]))
    assert full.sample_count == random.sample_count == 990
    assert full.equity == pytest.approx(random.equity)


def test_single_range_equivalent_to_exact() -> None:
    exact = calculate_equity(scenario())
    weighted = calculate_equity(scenario(opponents=[{"kind": "range", "text": "KsKh:0.1"}]))
    assert weighted.equity == exact.equity


def test_joint_conflict_and_player_order(monkeypatch: pytest.MonkeyPatch) -> None:
    players = [
        {"kind": "range", "text": "KsKh:0.2 8s8h"},
        {"kind": "range", "text": "KsKh 6s6h:0.4"},
    ]
    request = scenario(
        hero=cards("Ts Th"), board=cards("2s 3h 7c 9d 4s"), opponents=players, samples=20000
    )
    result = calculate_equity(request)
    swapped = calculate_equity(request.model_copy(update={"opponents": request.opponents[::-1]}))
    assert result.sample_count == swapped.sample_count == 3
    assert result.equity == pytest.approx(0.4 / (0.08 + 1 + 0.4))
    assert result.equity == pytest.approx(swapped.equity)
    monkeypatch.setattr("poker_calculator.engines.equity.EXACT_LIMIT", 0)
    simulated = calculate_equity(request)
    assert simulated.equity_standard_error is not None
    assert abs(simulated.equity - result.equity) < 4 * simulated.equity_standard_error
    impossible = scenario(opponents=[{"kind": "range", "text": "KsKh"}] * 2)
    with pytest.raises(ValueError, match="没有互不冲突"):
        calculate_equity(impossible)


def test_large_product_infeasible_ranges_terminate() -> None:
    board = cards("3s 4h 7c 9d Ts")
    known = set(board + cards("As Ah"))
    combos = [{"cards": [0, card]} for card in range(1, 52) if card not in known]
    request = scenario(board=board, opponents=[{"kind": "range", "combos": combos}] * 3)
    with pytest.raises(ValueError, match="没有互不冲突"):
        calculate_equity(request)


def test_independent_rejection_sampler_and_deadline() -> None:
    labels = [rank * 2 for rank in RANKS]
    labels += [a + b for i, a in enumerate(RANKS) for b in RANKS[:i]]
    request = scenario(opponents=[{"kind": "range", "text": ",".join(labels)}] * 2, samples=1000)
    result = calculate_equity(request)
    assert result.method == "monteCarlo"
    assert result.sample_count == 1000
    assert (
        result.win_probability + result.tie_probability + result.lose_probability
        == pytest.approx(1)
    )
    from poker_calculator.engines.equity import CalculationTimeout

    with pytest.raises(CalculationTimeout):
        calculate_equity(request, time_limit=-1)


def test_explicit_combos_and_blockers() -> None:
    with pytest.raises(ValidationError, match="阻断"):
        scenario(opponents=[{"kind": "range", "text": "AsAh"}])
    request = scenario(
        opponents=[{"kind": "range", "combos": [{"cards": cards("Ks Kh"), "weight": 0.2}]}]
    )
    assert calculate_equity(request).equity == 1
    with pytest.raises(ValidationError):
        scenario(opponents=[{"kind": "range", "combos": [{"cards": [3, 3]}]}])


def test_range_cancellation_and_deadline() -> None:
    request = scenario(opponents=[{"kind": "range", "text": "KK+"}])
    with pytest.raises(CalculationCancelled):
        calculate_equity(request, cancelled=lambda: True)


def test_comparison_cache_and_progress(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = 0
    original = calculate_equity

    def counted(*args: Any, **kwargs: Any) -> Any:
        nonlocal calls
        calls += 1
        return original(*args, **kwargs)

    monkeypatch.setattr("poker_calculator.application.services.calculate_equity", counted)
    request = scenario(
        strategies=[
            {"id": "pot-odds"},
            {"id": "equity-rules", "config": {"equity_margin": 0.1}},
            {"id": "missing"},
        ]
    )
    output = execute_analysis(request.model_dump(), {}, NeverCancelled(), 30)
    assert calls == 1
    assert output["completion"] == "partial"
    results = output["outcomes"]
    assert [item["status"] for item in results] == ["ok", "ok", "error"]
    assert results[0]["result"]["scenario_hash"] == results[1]["result"]["scenario_hash"]
    assert results[0]["result"]["call_ev"] == results[1]["result"]["call_ev"]
    assert results[1]["result"]["signals"]
    updates: list[int] = []
    services = AnalysisServices(
        progress=lambda completed, total: updates.append(completed), phases=2
    )
    services.equity(request)
    services.phase = 1
    services.equity(request)
    assert updates == sorted(updates)
    assert updates[-1] == 1_000_000


@pytest.mark.parametrize("stop", ["cancel", "timeout"])
def test_budget_stop_preserves_completed_strategy(
    monkeypatch: pytest.MonkeyPatch, stop: str
) -> None:
    from poker_calculator.engines.equity import CalculationTimeout
    from poker_calculator.strategies.registry import get_strategy

    class StoppedRule:
        def validate_config(self, request: AnalysisRequest) -> None:
            pass

        def check_support(self, request: AnalysisRequest) -> Any:
            return get_strategy("pot-odds").check_support(request)

        def analyze(self, request: AnalysisRequest, services: AnalysisServices) -> Any:
            if stop == "cancel":
                raise CalculationCancelled
            raise CalculationTimeout("shared budget exhausted")

    monkeypatch.setattr(
        "poker_calculator.infrastructure.compute.get_strategy",
        lambda name: StoppedRule() if name == "equity-rules" else get_strategy(name),
    )
    request = scenario(strategies=[{"id": "pot-odds"}, {"id": "equity-rules"}])
    result = execute_analysis(request.model_dump(), {}, NeverCancelled(), 30)
    assert result["completion"] == "partial"
    assert result["result"]["equity"] == 1
    assert [item["status"] for item in result["outcomes"]] == ["ok", "error"]
    assert result["cancelled"] == (stop == "cancel")


def test_range_preview_and_multi_strategy_spawn() -> None:
    with TestClient(create_app()) as client:
        preview = client.post(
            "/api/v1/ranges/preview", json={"text": "AA,AKs", "known_cards": cards("As")}
        )
        assert preview.status_code == 200
        assert preview.json()["total_combos"] == 10
        assert preview.json()["effective_combos"] == 6
        assert client.post("/api/v1/ranges/preview", json={"text": "bad"}).status_code == 422
        request = scenario(
            opponents=[{"kind": "range", "text": "KK"}],
            strategies=[{"id": "pot-odds"}, {"id": "equity-rules"}],
        )
        response = client.post("/api/v1/analyses", json=request.model_dump())
        assert response.status_code == 202
        task_id = response.json()["task_id"]
        for _ in range(100):
            data = client.get(f"/api/v1/analyses/{task_id}").json()
            if data["status"] not in ("queued", "running"):
                break
            time.sleep(0.05)
        assert data["status"] == "succeeded", data
        assert data["completion"] == "complete"
        assert len(data["outcomes"]) == 2
        assert data["progress"] == 1


def test_class_expansion_has_no_duplicates() -> None:
    for label in ("AA", "AK", "AKs", "AKo"):
        pairs = expand_class(label)
        assert len(set(pairs)) == len(pairs)
