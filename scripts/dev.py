"""Run the local frontend and Python API together. Ctrl+C stops both trees."""

from __future__ import annotations

import argparse
import os
import shutil
import socket
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def executable(name: str) -> str:
    found = shutil.which(name)
    if not found:
        raise RuntimeError(f"{name} is missing from PATH; install it before starting.")
    return found


def check_port(port: int) -> None:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as connection:
        if connection.connect_ex(("127.0.0.1", port)) == 0:
            raise RuntimeError(f"Port {port} is already in use. Stop that service or start each app manually.")


def stop(process: subprocess.Popen[bytes]) -> None:
    if process.poll() is not None:
        return
    if os.name == "nt":
        subprocess.run(
            ["taskkill", "/PID", str(process.pid), "/T", "/F"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
    else:
        import signal

        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            return
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--install", action="store_true", help="Sync locked dependencies before launching")
    args = parser.parse_args()
    processes: list[subprocess.Popen[bytes]] = []
    try:
        uv, pnpm = executable("uv"), executable("pnpm")
        check_port(8000)
        check_port(5173)
        if args.install:
            subprocess.run([uv, "sync", "--locked"], cwd=ROOT / "backend", check=True)
            subprocess.run([pnpm, "install", "--frozen-lockfile"], cwd=ROOT / "frontend", check=True)
        commands = [
            (ROOT / "backend", [uv, "run", "uvicorn", "poker_calculator.api.main:app", "--host", "127.0.0.1", "--port", "8000"]),
            (ROOT / "frontend", [pnpm, "dev", "--host", "127.0.0.1", "--port", "5173", "--strictPort"]),
        ]
        for directory, command in commands:
            processes.append(subprocess.Popen(command, cwd=directory, start_new_session=os.name != "nt"))
        print("\nFrontend: http://127.0.0.1:5173\nAPI docs: http://127.0.0.1:8000/docs\nCtrl+C stops both services.\n", flush=True)
        while True:
            for process in processes:
                if process.poll() is not None:
                    return process.returncode or 1
            time.sleep(0.5)
    except KeyboardInterrupt:
        return 0
    except (RuntimeError, subprocess.CalledProcessError) as error:
        print(str(error), file=sys.stderr)
        return 1
    finally:
        for process in reversed(processes):
            stop(process)


if __name__ == "__main__":
    raise SystemExit(main())
