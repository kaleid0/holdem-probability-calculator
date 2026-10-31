"""Reproducible local performance observation; not a cross-machine benchmark."""

from __future__ import annotations

import json
import platform
import time
from pathlib import Path

from poker_calculator.domain.models import AnalysisRequest
from poker_calculator.engines.equity import CalculationCancelled, calculate_equity


def main() -> None:
    request = AnalysisRequest.model_validate(
        {
            "hero": [48, 44],
            "board": [40, 36, 1],
            "opponents": [{"kind": "range", "text": "22+,A2s+,K2s+,Q2s+,J2s+,T2s+,AKo,AQo:0.5"}],
            "samples": 20000,
            "seed": 42,
        }
    )
    result = calculate_equity(request)
    cancelled_at: float | None = None

    def progress(completed: int, total: int) -> None:
        nonlocal cancelled_at
        if completed >= 250 and cancelled_at is None:
            cancelled_at = time.perf_counter()

    latency = None
    try:
        calculate_equity(
            request, progress=progress, cancelled=lambda: cancelled_at is not None
        )
    except CalculationCancelled:
        assert cancelled_at is not None
        latency = (time.perf_counter() - cancelled_at) * 1000
    record = {
        "python": platform.python_version(),
        "platform": platform.platform(),
        "engine": "0.2.0",
        "request": request.model_dump(),
        "method": result.method,
        "samples": result.sample_count,
        "elapsed_ms": round(result.elapsed_ms, 3),
        "samples_per_second": round(result.sample_count / (result.elapsed_ms / 1000)),
        "cooperative_cancel_latency_ms": round(latency, 3)
        if latency is not None
        else None,
        "note": "单次引擎观测，包含范围准备，不包含 HTTP/排队/进程启动；非服务性能承诺。",
    }
    destination = Path(__file__).resolve().parents[1] / ".local" / "v02-benchmark.json"
    destination.parent.mkdir(exist_ok=True)
    destination.write_text(
        json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(record, ensure_ascii=True, indent=2))


if __name__ == "__main__":
    main()
