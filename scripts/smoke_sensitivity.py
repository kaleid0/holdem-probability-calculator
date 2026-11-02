"""Exercise a running sensitivity API: real jobs, missing history, cancellation."""

import argparse
import json
import time
from pathlib import Path

from smoke_api import Api, check


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    args = parser.parse_args()
    api = Api(args.base_url, timeout=40, poll_interval=0.05)
    fixture = Path(__file__).resolve().parents[1] / "examples/history-sensitivity.json"
    payload = json.loads(fixture.read_text(encoding="utf-8"))
    prefix = "/api/v1/sensitivity-analyses"

    def finish(task_id: str) -> dict:
        deadline = time.monotonic() + api.timeout
        previous = 0.0
        while time.monotonic() < deadline:
            task = api.request(f"{prefix}/{task_id}")
            check(task["progress"] >= previous, "Progress moved backwards")
            previous = task["progress"]
            if task["status"] not in ("queued", "running", "cancelling"):
                return task
            time.sleep(api.poll_interval)
        raise TimeoutError("Sensitivity job did not terminate")

    task_id = api.request(prefix, payload, method="POST", expected_status=202)["task_id"]
    done = finish(task_id)
    check(done["status"] == "succeeded", f"Failed batch: {done}")
    for outcome in done["result"]["outcomes"]:
        check(outcome["status"] == "ok", f"Failed scene: {outcome}")
        api.check_probabilities(outcome["result"])
        check(len(outcome["traces"]) == 3, "Missing decision explanations")
        check(outcome["result"]["call_ev"] is None, "Future betting must not supply EV")
    print("PASS real history inference, three scenes and probability invariants")

    payload["history_context"]["complete"] = False
    task_id = api.request(prefix, payload, method="POST", expected_status=202)["task_id"]
    missing = finish(task_id)
    check(missing["status"] == "failed", "Incomplete history unexpectedly succeeded")
    check(all(o["status"] == "insufficient-data" for o in missing["result"]["outcomes"]),
          "Missing history must be explicit")
    print("PASS incomplete history produces explicit per-scene reasons")

    payload["history_context"]["complete"] = True
    payload["preflop_prior"] = None
    payload["base_analysis"].update(samples=200000, equity_method="monteCarlo")
    task_id = api.request(prefix, payload, method="POST", expected_status=202)["task_id"]
    started = time.perf_counter()
    api.request(f"{prefix}/{task_id}/cancel", method="POST")
    cancelled = finish(task_id)
    check(cancelled["status"] == "cancelled", f"Cancel failed: {cancelled}")
    print(f"PASS cancellation reached terminal state in {(time.perf_counter() - started) * 1000:.1f} ms")


if __name__ == "__main__":
    main()
