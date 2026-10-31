"""Single-instance, bounded, expiring task execution for the first release."""

import multiprocessing
import os
import time
import uuid
from concurrent.futures import Future, ProcessPoolExecutor
from dataclasses import dataclass, field
from typing import Any, Literal

from poker_calculator.domain.models import (
    AnalysisRequest,
    AnalysisResult,
    StrategyOutcome,
    TaskSnapshot,
    TaskStatus,
)
from poker_calculator.infrastructure.compute import execute_analysis


class QueueFullError(Exception):
    pass


@dataclass
class Task:
    id: str
    future: Future[dict[str, Any]]
    progress: Any
    cancellation: Any
    status: TaskStatus = "queued"
    result: AnalysisResult | None = None
    error: str | None = None
    finished_at: float | None = None
    outcomes: list[StrategyOutcome] = field(default_factory=list)
    completion: Literal["complete", "partial", "none"] = "none"


class TaskService:
    def __init__(
        self,
        *,
        max_workers: int = 2,
        max_tasks: int = 8,
        ttl_seconds: float = 1800,
        time_limit: float = 30,
    ) -> None:
        context = multiprocessing.get_context("spawn")
        self.manager = context.Manager()
        self.executor = ProcessPoolExecutor(max_workers=max_workers, mp_context=context)
        self.max_tasks = max_tasks
        self.ttl_seconds = ttl_seconds
        self.time_limit = time_limit
        self.tasks: dict[str, Task] = {}

    @classmethod
    def from_environment(cls) -> "TaskService":
        workers = min(8, max(1, int(os.getenv("POKER_COMPUTE_WORKERS", "2"))))
        return cls(max_workers=workers)

    def _refresh(self, task: Task) -> None:
        if task.finished_at is not None:
            if time.monotonic() - task.finished_at > self.ttl_seconds:
                task.status = "expired"
                task.result = None
                task.outcomes = []
                task.completion = "none"
                task.error = "任务结果已过期，请重新计算"
            return
        if task.future.done():
            if task.future.cancelled():
                task.status = "cancelled"
            else:
                try:
                    output = task.future.result()
                    task.outcomes = [
                        StrategyOutcome.model_validate(item) for item in output.get("outcomes", [])
                    ]
                    task.completion = output.get("completion", "none")
                    if output.get("result"):
                        task.result = AnalysisResult.model_validate(output["result"])
                    if output.get("cancelled") or task.status == "cancelling":
                        task.status = "cancelled"
                    elif task.result is None:
                        task.status = "failed"
                        task.error = (
                            output.get("budget_error") or "所有策略均未产生结果，请查看各策略原因"
                        )
                    else:
                        task.status = "succeeded"
                        task.error = output.get("budget_error")
                        if task.error:
                            task.completion = "partial"
                except Exception as exc:
                    task.status = "failed"
                    task.error = str(exc) or "计算失败，请降低精度后重试"
            task.finished_at = time.monotonic()
        elif task.status != "cancelling" and task.progress.get("started", False):
            task.status = "running"

    def _prune(self) -> None:
        now = time.monotonic()
        for task_id, task in list(self.tasks.items()):
            self._refresh(task)
            if task.finished_at is not None and now - task.finished_at > self.ttl_seconds * 2:
                del self.tasks[task_id]

    def submit(self, request: AnalysisRequest) -> Task:
        self._prune()
        if sum(task.finished_at is None for task in self.tasks.values()) >= self.max_tasks:
            raise QueueFullError("计算队列已满，请稍后重试")
        progress = self.manager.dict({"started": False, "completed": 0, "total": request.samples})
        cancellation = self.manager.Event()
        future = self.executor.submit(
            execute_analysis, request.model_dump(), progress, cancellation, self.time_limit
        )
        task = Task(uuid.uuid4().hex, future, progress, cancellation)
        self.tasks[task.id] = task
        return task

    def get(self, task_id: str) -> TaskSnapshot:
        self._prune()
        task = self.tasks[task_id]
        completed = int(task.progress.get("completed", 0))
        total = int(task.progress.get("total", 0))
        fraction = completed / total if total else 0.0
        if task.status == "succeeded":
            fraction = 1.0
        return TaskSnapshot(
            task_id=task.id,
            status=task.status,
            progress=min(1.0, fraction),
            completed_samples=completed,
            total_samples=total,
            result=task.result,
            error=task.error,
            outcomes=task.outcomes,
            completion=task.completion,
        )

    def cancel(self, task_id: str) -> TaskSnapshot:
        task = self.tasks[task_id]
        self._refresh(task)
        if task.finished_at is None:
            task.cancellation.set()
            if task.future.cancel():
                task.status = "cancelled"
                task.finished_at = time.monotonic()
            else:
                task.status = "cancelling"
        return self.get(task_id)

    def close(self) -> None:
        for task in self.tasks.values():
            if not task.future.done():
                task.cancellation.set()
                task.future.cancel()
        self.executor.shutdown(wait=True, cancel_futures=True)
        self.manager.shutdown()
