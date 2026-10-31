from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from pydantic import ValidationError

from poker_calculator.application.tasks import QueueFullError, TaskService
from poker_calculator.domain.models import (
    AnalysisRequest,
    RangePreview,
    RangePreviewRequest,
    StrategyList,
    TaskCreated,
    TaskSnapshot,
    WeightedCombo,
)
from poker_calculator.domain.ranges import RANKS, parse_range, remove_blocked
from poker_calculator.strategies.registry import get_strategy, list_strategies


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    app.state.tasks = TaskService.from_environment()
    try:
        yield
    finally:
        app.state.tasks.close()


def create_app() -> FastAPI:
    application = FastAPI(
        title="德州扑克概率计算器 API",
        version="0.2.0",
        description="单底池权益与策略分析。任务为单实例内存存储，重启后失效。",
        lifespan=lifespan,
    )

    @application.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok", "version": "0.2.0"}

    @application.post("/api/v1/ranges/preview", response_model=RangePreview)
    async def range_preview(payload: RangePreviewRequest) -> RangePreview:
        try:
            combos = parse_range(payload.text)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        effective = remove_blocked(combos, set(payload.known_cards))
        classes: dict[str, float] = {}
        for combo in combos:
            a, b = sorted(combo.cards, reverse=True)
            label = RANKS[a // 4] + RANKS[b // 4]
            if a // 4 != b // 4:
                label += "s" if a % 4 == b % 4 else "o"
            classes[label] = max(classes.get(label, 0), combo.weight)
        return RangePreview(
            total_combos=len(combos),
            effective_combos=len(effective),
            blocked_combos=len(combos) - len(effective),
            combos=[WeightedCombo(cards=c.cards, weight=c.weight) for c in combos],
            class_weights=classes,
        )

    @application.get("/api/v1/strategies", response_model=StrategyList)
    async def strategies() -> StrategyList:
        return StrategyList(strategies=[strategy.manifest for strategy in list_strategies()])

    @application.post("/api/v1/analyses", response_model=TaskCreated, status_code=202)
    async def submit_analysis(payload: AnalysisRequest, request: Request) -> TaskCreated:
        try:
            if payload.strategies is None:
                strategy = get_strategy(payload.strategy_id)
                strategy.validate_config(payload)
                support = strategy.check_support(payload)
                if support.status != "supported":
                    raise ValueError("；".join(support.reasons) or "当前策略不支持该牌局")
        except (ValueError, ValidationError) as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        service: TaskService = request.app.state.tasks
        try:
            task = service.submit(payload)
        except QueueFullError as exc:
            raise HTTPException(status_code=429, detail=str(exc)) from exc
        return TaskCreated(task_id=task.id, status="queued")

    @application.get("/api/v1/analyses/{task_id}", response_model=TaskSnapshot)
    async def get_analysis(task_id: str, request: Request) -> TaskSnapshot:
        service: TaskService = request.app.state.tasks
        try:
            return service.get(task_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="任务不存在或已过期，请重新计算") from exc

    @application.post("/api/v1/analyses/{task_id}/cancel", response_model=TaskSnapshot)
    async def cancel_analysis(task_id: str, request: Request) -> TaskSnapshot:
        service: TaskService = request.app.state.tasks
        try:
            return service.cancel(task_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="任务不存在或已过期，请重新计算") from exc

    return application


app = create_app()
