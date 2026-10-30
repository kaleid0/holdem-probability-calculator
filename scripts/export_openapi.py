"""Export or check the backend contract without starting compute workers.

Run: uv run --project backend python scripts/export_openapi.py [--check]
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend" / "src"))


def main() -> int:
    from poker_calculator.api.main import app

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    destination = ROOT / "contracts" / "openapi.json"
    payload = json.dumps(app.openapi(), ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    if args.check:
        if not destination.exists() or destination.read_text(encoding="utf-8") != payload:
            print("OpenAPI snapshot is stale. Run scripts/export_openapi.py and regenerate frontend types.")
            return 1
        print("OpenAPI snapshot matches backend.")
        return 0
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(payload, encoding="utf-8", newline="\n")
    print(f"Exported {destination}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
