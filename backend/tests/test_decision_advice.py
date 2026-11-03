"""Decision rules migrated from the browser, including accounting and replay boundaries."""

import json
import math
from dataclasses import replace
from pathlib import Path

import pytest
from pydantic import ValidationError

from poker_calculator.application.advice import AdviceResults, decision_advice, resolve_results
from poker_calculator.domain.advice import DecisionAdviceRequest, ResponseModel
from poker_calculator.domain.decision import DecisionContext, decision_context
from poker_calculator.domain.history import ReplayState
from poker_calculator.domain.models import (
    ActionAssessment,
    AnalysisRequest,
    AnalysisResult,
    ExactOpponent,
    LimitedTreeSummary,
    StrategyIdentity,
    StrategySelection,
    TreeScenario,
)
from poker_calculator.domain.sensitivity import HistoryContext
from poker_calculator.engines.action_ev import action_ev
from poker_calculator.strategies.continuation_advice import continuation_advice
from poker_calculator.strategies.decision_advice import baseline_advice, river_advice, tree_advice
from poker_calculator.strategies.preflop_advice import preflop_advice


def preflop_request() -> DecisionAdviceRequest:
    return DecisionAdviceRequest(
        recorded=True,
        base_analysis=AnalysisRequest(
            hero=(48, 49),
            board=[],
            opponents=[{"kind": "random"}],
            pot_before_call=15,
            call_amount=5,
            settlement_assumption="futureBettingPossible",
            pot_context={"contributions": [5, 10], "betting_closed_after_call": False},
        ),
        opponent_seats=[1],
        history_context=HistoryContext(
            hand_id="preflop-test",
            cutoff_sequence=2,
            complete=True,
            count=2,
            opening_seats=[0, 1],
            dealer=0,
            small_blind=5,
            big_blind=10,
            stacks=[1000, 1000],
            events=[
                {
                    "kind": "action",
                    "sequence": 1,
                    "street": 0,
                    "player": 0,
                    "action": "smallBlind",
                    "amount": 5,
                    "streetTotal": 5,
                    "totalCommitted": 5,
                    "toCall": 0,
                    "highestBefore": 0,
                    "minRaiseBefore": 10,
                    "potBefore": 0,
                    "potAfter": 5,
                    "activePlayersBefore": 2,
                },
                {
                    "kind": "action",
                    "sequence": 2,
                    "street": 0,
                    "player": 1,
                    "action": "bigBlind",
                    "amount": 10,
                    "streetTotal": 10,
                    "totalCommitted": 10,
                    "toCall": 5,
                    "highestBefore": 5,
                    "minRaiseBefore": 10,
                    "potBefore": 5,
                    "potAfter": 15,
                    "activePlayersBefore": 2,
                },
            ],
        ),
    )


def equity_result(equity: float = 0.6, error: float = 0) -> AnalysisResult:
    return AnalysisResult(
        method="monteCarlo",
        win_probability=equity,
        tie_probability=0,
        lose_probability=1 - equity,
        equity=equity,
        equity_standard_error=error,
        sample_count=1000,
        elapsed_ms=1,
        pot_odds_ratio="3:1",
        break_even_equity=0.25,
        call_ev=equity * 200 - 50,
        recommendation=None,
        assumptions=[],
        strategy=StrategyIdentity(id="pot-odds", name="基线", version="0.3.0"),
        scenario_hash="test",
        seed=42,
    )


def facing_bet() -> DecisionContext:
    """Pure engine fixture: hero 50 sunk, villain 100 sunk, hero owes 50."""
    request = preflop_request()
    context = decision_context(request)
    assert context is not None
    base = context.base.model_copy(
        update={
            "board": [4, 9, 14],
            "pot_before_call": 150,
            "call_amount": 50,
            "settlement_assumption": "showdownAfterCall",
        }
    )
    state = ReplayState(
        actor=0,
        pending=frozenset({0}),
        active=frozenset({0, 1}),
        total=(50, 100),
        ended=False,
        minimum=50,
        paid=(0, 50),
        highest=50,
        acted_at=(None, None),
    )
    return replace(context, base=base, state=state)


PASSIVE = ResponseModel.model_validate({"fold": 0, "raise": 0, "probe": 0})


def test_preflop_is_available_before_equity_and_has_structured_amounts() -> None:
    response = decision_advice(preflop_request(), AdviceResults())
    advice = response.advice
    assert advice is not None
    assert advice.source == "preflop-rules"
    assert advice.code == "recommendation"
    assert advice.title == "倾向加注至 25"
    assert "本次追加 20" in advice.reason and "BTN" in advice.reason
    assert advice.actions[0].amount == 25
    assert advice.actions[0].amount_kind == "street_total"
    assert "非 GTO" in advice.stability
    assert response.comparison.rows == []


def test_preflop_weak_hand_folds_and_short_stacks_require_review() -> None:
    context = decision_context(preflop_request())
    assert context is not None
    weak = replace(context, base=context.base.model_copy(update={"hero": (0, 21)}))
    advice = preflop_advice(weak)
    assert advice is not None and advice.actions[0].action == "fold"
    short = replace(context, history=context.history.model_copy(update={"stacks": [150, 1000]}))
    advice = preflop_advice(short)
    assert advice is not None and advice.code == "review" and not advice.actions
    assert preflop_advice(replace(context, state=replace(context.state, actor=1))) is None
    assert preflop_advice(None) is None


def test_ev_preserves_sunk_costs_and_call_raise_accounting() -> None:
    comparison = action_ev(facing_bet(), equity_result(), PASSIVE)
    values = {row.label: row.values[0] for row in comparison.rows}
    assert values["弃牌"] == 0
    assert values["跟注 50"] == pytest.approx(70)
    assert values["加注至 150"] == pytest.approx(90)


def test_ev_refunds_uncalled_bets_and_caps_reraises_at_all_in() -> None:
    context = facing_bet()
    folds = action_ev(
        context,
        equity_result(),
        ResponseModel.model_validate(
            {
                "fold": 1,
                "raise": 0,
                "probe": 0,
            }
        ),
    )
    assert all(r.values[0] == 150 for r in folds.rows if r.action.action == "raise")
    raises = action_ev(
        context,
        equity_result(),
        ResponseModel.model_validate(
            {
                "fold": 0,
                "raise": 1,
                "probe": 0,
            }
        ),
    )
    assert next(r for r in raises.rows if r.label == "加注至 150").values[0] == -150
    assert raises.rows[-1].values[0] == pytest.approx(250)


def test_future_probe_loses_only_the_current_call_and_stops_after_all_in() -> None:
    context = facing_bet()
    context = replace(
        context,
        base=context.base.model_copy(
            update={
                "settlement_assumption": "futureBettingPossible",
            }
        ),
    )
    probe = ResponseModel.model_validate({"fold": 0, "raise": 0, "probe": 1})
    comparison = action_ev(context, equity_result(0.1), probe)
    assert next(r for r in comparison.rows if r.label == "跟注 50").values[0] == -50
    context = replace(context, history=context.history.model_copy(update={"stacks": [100, 1000]}))
    comparison = action_ev(context, equity_result(), probe)
    assert len(comparison.rows) == 2
    assert comparison.rows[1].values[0] == pytest.approx(70)


@pytest.mark.parametrize("stacks", [[1000, 1000], [120, 1000], [1000, 120]])
def test_ev_sizes_are_legal_and_within_both_stacks(stacks: list[int]) -> None:
    context = facing_bet()
    context = replace(context, history=context.history.model_copy(update={"stacks": stacks}))
    comparison = action_ev(context, equity_result(), ResponseModel())
    for row in comparison.rows:
        if row.action.action != "raise":
            continue
        target = row.action.amount
        assert target <= min(context.remaining(0), 50 + context.remaining(1))
        assert target >= 100 or target == context.remaining(0)
        assert row.additional == target
    assert all(math.isfinite(v) for r in comparison.rows for v in r.values)


def test_ev_does_not_reopen_raise_rights_and_never_invents_missing_results() -> None:
    context = facing_bet()
    context = replace(context, state=replace(context.state, acted_at=(50, None)))
    assert len(action_ev(context, equity_result(), PASSIVE).rows) == 2
    assert not action_ev(context, None, PASSIVE).rows
    assert not action_ev(None, equity_result(), PASSIVE).rows
    context = replace(context, state=replace(context.state, actor=1))
    assert not action_ev(context, equity_result(), PASSIVE).rows


def test_ev_uncertainty_and_scenarios_are_preserved() -> None:
    comparison = action_ev(facing_bet(), equity_result(error=0.01), ResponseModel())
    assert len(comparison.scenarios) == 3 and comparison.best
    assert any(e > 0 for r in comparison.rows for e in r.errors)
    assert next(r for r in comparison.rows if r.label == "跟注 50").values[1] < 70


@pytest.mark.parametrize(
    "equity,code,action",
    [
        (0.6, "recommendation", "call"),
        (0.1, "recommendation", "fold"),
        (0.33, "marginal", None),
    ],
)
def test_continuation_thresholds(equity: float, code: str, action: str | None) -> None:
    context = facing_bet()
    context = replace(
        context,
        base=context.base.model_copy(
            update={
                "settlement_assumption": "futureBettingPossible",
            }
        ),
    )
    advice = continuation_advice(context, equity_result(equity, 0.005))
    assert advice is not None and advice.code == code
    assert advice.threshold == 0.25 and advice.reserve == 0.08
    assert "并非计算出的未来损失" in advice.reason
    assert (advice.actions[0].action if advice.actions else None) == action


def test_continuation_free_check_and_all_in_review() -> None:
    context = facing_bet()
    free = replace(context, base=context.base.model_copy(update={"call_amount": 0}))
    advice = continuation_advice(free, None)
    assert advice is not None and advice.actions[0].action == "check"
    short = replace(context, history=context.history.model_copy(update={"stacks": [100, 1000]}))
    advice = continuation_advice(short, equity_result(0.9))
    assert advice is not None and advice.code == "review" and not advice.actions


@pytest.mark.parametrize(
    "gap,error,code",
    [(0, 0, "marginal"), (0.003, 0.004, "marginal"), (0.35, 0.004, "recommendation")],
)
def test_baseline_sampling_boundaries(gap: float, error: float, code: str) -> None:
    request = preflop_request().model_copy(update={"recorded": False})
    advice = baseline_advice(request, equity_result(0.25 + gap, error), None)
    assert advice is not None and advice.code == code
    assert advice.title.startswith("接近" if code == "marginal" else "摊牌参考：")


def test_missing_ev_explains_open_action_and_future_betting() -> None:
    request = preflop_request().model_copy(update={"recorded": False})
    result = equity_result().model_copy(update={"call_ev": None})
    advice = baseline_advice(request, result, None)
    assert advice is not None and advice.code == "unavailable"
    assert "尚不能闭合当前街" in advice.reason and "允许后续下注" in advice.reason
    assert not advice.actions


def test_tree_decisions_preserve_marginality_and_structured_actions() -> None:
    tree = LimitedTreeSummary(
        horizon="test",
        scenarios=[TreeScenario(id="baseline", name="基准", best_actions=["下注 10"])],
        stable_actions=[],
        marginal=True,
        sample_count_per_scenario=1000,
        elapsed_ms=1,
    )
    result = equity_result().model_copy(
        update={
            "limited_tree": tree,
            "candidates": [
                ActionAssessment(action="check", amount=0, explanation="test"),
                ActionAssessment(action="bet", amount=10, explanation="test"),
            ],
        }
    )
    advice = tree_advice(result)
    assert advice is not None and advice.code == "marginal" and not advice.actions
    tree.marginal, tree.stable_actions = False, ["下注 10"]
    advice = tree_advice(result)
    assert advice is not None and advice.title == "有限树倾向下注 10"
    assert advice.actions[0].action == "bet" and advice.actions[0].amount == 10


def test_replay_rejects_tampering_and_accepts_exact_opponents() -> None:
    request = preflop_request()
    request.base_analysis.opponents = [ExactOpponent(kind="exact", cards=(44, 45))]
    assert decision_context(request) is not None
    assert request.history_context is not None
    request.history_context.events[1].potAfter = 999
    with pytest.raises(ValueError, match="重放不一致"):
        decision_context(request)


def test_stale_history_and_invalid_seat_maps_are_rejected() -> None:
    request = preflop_request()
    request.base_analysis.pot_before_call = 999
    with pytest.raises(ValueError, match="底池"):
        decision_context(request)
    data = preflop_request().model_dump()
    data["opponent_seats"] = [0]
    with pytest.raises(ValidationError, match="座位映射"):
        DecisionAdviceRequest.model_validate(data)


@pytest.mark.parametrize(
    "model",
    [
        {"fold": 0.8, "raise": 0.3},
        {"probe": float("nan")},
        {"fold": -1},
    ],
)
def test_response_models_are_validated(model: dict[str, float]) -> None:
    with pytest.raises(ValidationError):
        ResponseModel.model_validate(model)


def test_river_requires_three_successful_scenarios_for_stability() -> None:
    # Use the real inference shape rather than a partial response fabricated by the browser.
    from poker_calculator.domain.models import RiverScenarioSummary, StrategyInference

    result = equity_result().model_copy(
        update={
            "inference": StrategyInference(
                source="test",
                model_version="test",
                hand_id="test",
                cutoff_sequence=2,
                opponent_seat=1,
                effective_stack=100,
                posterior_combos=1,
                observed_actions=0,
                evidence=[],
                warnings=[],
                stable_amounts=[60],
                scenarios=[
                    RiverScenarioSummary(id=i, name=i, best_amounts=[60])
                    for i in ("baseline", "tight", "loose")
                ],
            )
        }
    )
    advice = river_advice(result)
    assert advice is not None and advice.title == "下注 60" and "均为最优" in advice.stability
    assert result.inference is not None
    result.inference.scenarios[2].status = "insufficient-data"
    advice = river_advice(result)
    assert advice is not None and "情景不足" in advice.stability
    result.inference.scenarios[2].status = "ok"
    result.inference.stable_amounts = []
    advice = river_advice(result)
    assert advice is not None and "敏感" in advice.stability


def test_replayed_river_history_and_waiting_do_not_use_browser_actor() -> None:
    data = json.loads(
        (Path(__file__).parents[2] / "examples/river-auto-analysis.json").read_text(
            encoding="utf-8"
        )
    )
    config = data["strategies"][0]["config"]
    request = DecisionAdviceRequest(
        base_analysis=AnalysisRequest.model_validate(data),
        recorded=True,
        history_context=config["history_context"],
        opponent_seats=config["opponent_seats"],
    )
    context = decision_context(request)
    assert context is not None and context.hero_turn
    context = replace(context, state=replace(context.state, pending=frozenset(), actor=1))
    advice = baseline_advice(request, equity_result(), context)
    assert advice is not None and advice.code == "waiting" and not advice.actions


def test_selection_uses_codes_and_advanced_results_win_over_preflop() -> None:
    request = preflop_request()
    response = decision_advice(request, AdviceResults(baseline=equity_result()))
    assert response.advice is not None and response.advice.source == "preflop-rules"
    # A review outside the opening rule coverage can fall back to an evaluated call.
    assert request.history_context is not None
    request.history_context.stacks = [150, 1000]
    response = decision_advice(request, AdviceResults(baseline=equity_result()))
    assert response.advice is not None and response.advice.source == "pot-odds"
    assert "preflop-outside-rule-coverage" in response.fallback_reasons


def test_advanced_source_is_bound_to_the_exact_history_cutoff() -> None:
    request = preflop_request()
    assert request.history_context is not None
    original = request.base_analysis.model_copy(
        update={
            "strategies": [
                StrategySelection(
                    id="history-ranges",
                    config={
                        "history_context": request.history_context.model_dump(),
                        "opponent_seats": [1],
                    },
                )
            ]
        }
    )
    result = equity_result().model_copy(
        update={
            "strategy": StrategyIdentity(
                id="history-ranges",
                name="历史范围",
                version="0.1.0",
            )
        }
    )

    class Source:
        def completed_analysis(self, task_id: str) -> tuple[AnalysisRequest, AnalysisResult]:
            return original, result

    request.sources.history = "history-task"
    assert resolve_results(request, Source()).history is result
    request.history_context.hand_id = "another-hand-with-identical-pot"
    with pytest.raises(ValueError, match="行动历史不一致"):
        resolve_results(request, Source())
