"""Reproducible local batch timing; observations are not a latency guarantee."""

import json
import platform
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend/src"))


def main() -> None:
    from poker_calculator.application.sensitivity import run_sensitivity
    from poker_calculator.application.services import AnalysisServices
    from poker_calculator.domain.sensitivity import SensitivityRequest

    payload = json.loads((ROOT / "examples/history-sensitivity.json").read_text(encoding="utf-8"))
    measurements = []
    for name in ("small-exact", "uniform-monte-carlo", "cancel-inference"):
        data = json.loads(json.dumps(payload))
        if name != "small-exact":
            data["preflop_prior"] = None
            data["base_analysis"].update(samples=10000, equity_method="monteCarlo")
        checkpoints = 0

        def cancelled() -> bool:
            nonlocal checkpoints
            checkpoints += 1
            return name == "cancel-inference" and checkpoints >= 20

        started = time.perf_counter()
        services = AnalysisServices(cancelled=cancelled, deadline=time.monotonic() + 30)
        result = run_sensitivity(SensitivityRequest.model_validate(data), services)
        measurements.append(
            {
                "case": name,
                "wall_ms": round((time.perf_counter() - started) * 1000, 2),
                "unique_equity_calculations": len(services.cache),
                "scenes": [
                    {
                        "status": o.status,
                        "effective_combos": len(o.combos),
                        "method": o.result.method if o.result else None,
                        "samples": o.result.sample_count if o.result else 0,
                    }
                    for o in result.outcomes
                ],
            }
        )
    report = {
        "platform": platform.platform(),
        "python": platform.python_version(),
        "processor": platform.processor(),
        "model": "history-rules-v1",
        "measurements": measurements,
    }
    output = ROOT / ".local/sensitivity-benchmark.json"
    output.parent.mkdir(exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
