#!/usr/bin/env python3
"""Converge the OpenShip-managed App B worker onto its required Docker host config.

OpenShip 0.6.9 imports the worker service but does not preserve a few Compose
runtime-hardening fields when it rebuilds a service.  This guard is deliberately
host-side: OpenShip still owns image selection, environment, labels, the named
home volume, the project network and resource limits; the guard only recreates
the worker when those four runtime invariants have been dropped.

No environment value is written to logs.  A root-only /run env file exists only
for the duration of `docker run` and is unlinked immediately afterwards.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

try:
    import fcntl
except ImportError:  # Allows --self-test on a Windows development host.
    fcntl = None  # type: ignore[assignment]

TARGET = os.environ.get("LINGXILOOP_WORKER_CONTAINER", "openship-lingxiloop-app-b-worker")
EXPECTED_PROJECT = os.environ.get("LINGXILOOP_OPENSHIP_PROJECT", "proj_IsMy2bWVzEZ7JKEf")
EXPECTED_SERVICE = "worker"
LOCK_PATH = Path("/run/lingxiloop-worker-runtime-guard.lock")


class GuardError(RuntimeError):
    pass


def emit(event: str, **fields: Any) -> None:
    print(json.dumps({"event": event, "container": TARGET, **fields}, sort_keys=True), flush=True)


def command(args: list[str], *, check: bool = True) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(args, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if check and result.returncode != 0:
        detail = (result.stderr or result.stdout).strip().splitlines()
        suffix = f": {detail[-1]}" if detail else ""
        raise GuardError(f"{args[0]} {args[1] if len(args) > 1 else ''} failed{suffix}")
    return result


def inspect_container(name: str) -> dict[str, Any] | None:
    result = command(["docker", "inspect", name], check=False)
    if result.returncode != 0:
        combined = f"{result.stdout}\n{result.stderr}".lower()
        if "no such object" in combined or "no such container" in combined:
            return None
        raise GuardError("docker inspect failed")
    payload = json.loads(result.stdout)
    if len(payload) != 1 or not isinstance(payload[0], dict):
        raise GuardError("unexpected docker inspect response")
    return payload[0]


def runtime_compliant(document: dict[str, Any]) -> bool:
    host = document.get("HostConfig") or {}
    security = set(host.get("SecurityOpt") or [])
    tmpfs = host.get("Tmpfs") or {}
    return (
        host.get("ReadonlyRootfs") is True
        and host.get("PidsLimit") == 128
        and "/tmp" in tmpfs
        and "seccomp=unconfined" in security
        # Docker materializes `systempaths=unconfined` as empty path lists rather
        # than retaining that option in SecurityOpt.
        and host.get("MaskedPaths") == []
        and host.get("ReadonlyPaths") == []
    )


def validate_identity(document: dict[str, Any]) -> None:
    labels = (document.get("Config") or {}).get("Labels") or {}
    if labels.get("openship.project") != EXPECTED_PROJECT or labels.get("openship.service") != EXPECTED_SERVICE:
        raise GuardError("refusing to replace a container that is not the expected OpenShip worker")


def network_contract(document: dict[str, Any]) -> tuple[str, list[str]]:
    networks = (document.get("NetworkSettings") or {}).get("Networks") or {}
    if len(networks) != 1:
        raise GuardError(f"worker must have exactly one project network, found {len(networks)}")
    name, endpoint = next(iter(networks.items()))
    aliases = [alias for alias in (endpoint.get("Aliases") or []) if isinstance(alias, str) and alias]
    return name, aliases


def write_env_file(values: list[str]) -> str:
    for value in values:
        if "\n" in value or "\r" in value:
            raise GuardError("worker environment contains a multiline value; refusing lossy env-file recreation")
    handle = tempfile.NamedTemporaryFile("w", encoding="utf-8", dir="/run", prefix="lingxiloop-worker-env-", delete=False)
    try:
        os.fchmod(handle.fileno(), 0o600)
        for value in values:
            handle.write(value)
            handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
        return handle.name
    finally:
        handle.close()


def build_run_command(document: dict[str, Any], env_file: str, target: str = TARGET) -> list[str]:
    config = document.get("Config") or {}
    host = document.get("HostConfig") or {}
    image = config.get("Image")
    if not isinstance(image, str) or not image:
        raise GuardError("worker image is missing")

    network, aliases = network_contract(document)
    args = ["docker", "run", "-d", "--pull", "never", "--name", target]

    restart = (host.get("RestartPolicy") or {}).get("Name")
    if restart:
        maximum = int((host.get("RestartPolicy") or {}).get("MaximumRetryCount") or 0)
        value = f"{restart}:{maximum}" if restart == "on-failure" and maximum > 0 else restart
        args += ["--restart", value]

    args += ["--network", network]
    for alias in aliases:
        args += ["--network-alias", alias]
    for bind in host.get("Binds") or []:
        args += ["--volume", str(bind)]

    # These are the only runtime fields the guard intentionally changes.
    args += [
        "--read-only",
        "--tmpfs", "/tmp",
        "--pids-limit", "128",
        "--security-opt", "seccomp=unconfined",
        "--security-opt", "systempaths=unconfined",
    ]

    nano_cpus = int(host.get("NanoCpus") or 0)
    if nano_cpus > 0:
        args += ["--cpus", f"{nano_cpus / 1_000_000_000:g}"]
    memory = int(host.get("Memory") or 0)
    if memory > 0:
        args += ["--memory", str(memory)]

    log_config = host.get("LogConfig") or {}
    if log_config.get("Type"):
        args += ["--log-driver", str(log_config["Type"])]
        for key, value in sorted((log_config.get("Config") or {}).items()):
            args += ["--log-opt", f"{key}={value}"]

    for key, value in sorted((config.get("Labels") or {}).items()):
        args += ["--label", f"{key}={value}"]
    args += ["--env-file", env_file]

    if config.get("User"):
        args += ["--user", str(config["User"])]
    if config.get("WorkingDir"):
        args += ["--workdir", str(config["WorkingDir"])]
    stop_timeout = host.get("StopTimeout")
    if isinstance(stop_timeout, int) and stop_timeout >= 0:
        args += ["--stop-timeout", str(stop_timeout)]

    args.append(image)
    args.extend(str(part) for part in (config.get("Cmd") or []))
    return args


def worker_start_evidence(document: dict[str, Any], logs: str) -> bool:
    return (
        bool((document.get("State") or {}).get("Running"))
        and int(document.get("RestartCount") or 0) == 0
        and "worker started" in logs
    )


def wait_for_worker(name: str, timeout: float = 30.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        document = inspect_container(name)
        if document is None:
            time.sleep(0.25)
            continue
        state = document.get("State") or {}
        if state.get("Running"):
            logs = command(["docker", "logs", "--tail", "120", name], check=False)
            if worker_start_evidence(document, f"{logs.stdout}\n{logs.stderr}"):
                # LingxiOS AgentWorker.start() awaits kernels.check() before it
                # emits `worker started`.  Re-running an ad-hoc Bubblewrap probe
                # here would duplicate the sandbox contract and can drift from
                # the package's real bind set. Require a short stable-running
                # window instead; RestartCount keeps a crash/restart from passing.
                time.sleep(2.0)
                stable = inspect_container(name)
                if (
                    stable is not None
                    and (stable.get("State") or {}).get("Running")
                    and int(stable.get("RestartCount") or 0) == 0
                ):
                    return
        if state.get("Status") in {"dead", "removing"}:
            break
        time.sleep(0.5)
    raise GuardError("replacement worker did not pass startup and Bubblewrap verification")


def reconcile() -> bool:
    if fcntl is None:
        raise GuardError("worker runtime reconciliation requires Linux")
    LOCK_PATH.parent.mkdir(parents=True, exist_ok=True)
    with LOCK_PATH.open("a+", encoding="utf-8") as lock:
        try:
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return False

        document = inspect_container(TARGET)
        if document is None:
            return False
        validate_identity(document)
        if runtime_compliant(document):
            return False

        config = document.get("Config") or {}
        env_file = write_env_file([str(value) for value in (config.get("Env") or [])])
        backup = f"{TARGET}-guard-backup-{int(time.time())}"
        original_stopped = False
        old_renamed = False
        try:
            run_args = build_run_command(document, env_file)
            emit("repairing", image=str(config.get("Image") or ""), backup=backup)
            command(["docker", "stop", "--time", "25", TARGET])
            original_stopped = True
            command(["docker", "rename", TARGET, backup])
            old_renamed = True
            command(run_args)
            wait_for_worker(TARGET)
            repaired = inspect_container(TARGET)
            if repaired is None or not (repaired.get("State") or {}).get("Running") or not runtime_compliant(repaired):
                raise GuardError("replacement worker is running without the required host config")
            command(["docker", "rm", "--force", backup])
            old_renamed = False
            emit("repaired", image=str(config.get("Image") or ""))
            return True
        except Exception as error:
            # `docker run` can leave a created container behind even when it
            # exits non-zero, so key cleanup to object existence rather than to
            # whether the CLI reported a successful start.
            if old_renamed and inspect_container(TARGET) is not None:
                command(["docker", "rm", "--force", TARGET], check=False)
            if old_renamed and inspect_container(backup) is not None:
                command(["docker", "rename", backup, TARGET], check=False)
                command(["docker", "start", TARGET], check=False)
            elif original_stopped and inspect_container(TARGET) is not None:
                command(["docker", "start", TARGET], check=False)
            emit("repair_failed", error=str(error))
            raise
        finally:
            try:
                os.unlink(env_file)
            except FileNotFoundError:
                pass


def check() -> int:
    document = inspect_container(TARGET)
    if document is None:
        emit("absent")
        return 3
    validate_identity(document)
    if runtime_compliant(document):
        emit("compliant")
        return 0
    emit("noncompliant")
    return 2


def watch() -> None:
    try:
        reconcile()
    except Exception as error:
        emit("initial_reconcile_failed", error=str(error))

    while True:
        events = subprocess.Popen(
            ["docker", "events", "--filter", "type=container", "--filter", "event=start", "--format", "{{.Actor.Attributes.name}}"],
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
        )
        assert events.stdout is not None
        for line in events.stdout:
            if line.strip() != TARGET:
                continue
            time.sleep(1.0)  # let OpenShip finish its own post-start bookkeeping
            try:
                reconcile()
            except Exception as error:
                emit("event_reconcile_failed", error=str(error))
        events.wait()
        emit("docker_events_disconnected", returncode=events.returncode)
        time.sleep(1.0)


def self_test() -> None:
    fixture: dict[str, Any] = {
        "Config": {
            "Image": "example.invalid/lingxiloop-server:0123456789abcdef0123456789abcdef01234567",
            "Env": ["SECRET=not-placed-on-command-line"],
            "Labels": {"openship.project": EXPECTED_PROJECT, "openship.service": "worker"},
            "Cmd": ["npm", "run", "worker:start"],
            "User": "",
            "WorkingDir": "/app",
        },
        "HostConfig": {
            "ReadonlyRootfs": True,
            "PidsLimit": 128,
            "Tmpfs": {"/tmp": ""},
            "SecurityOpt": ["seccomp=unconfined"],
            "MaskedPaths": [],
            "ReadonlyPaths": [],
            "Binds": ["worker-homes:/var/lib/lingxios/homes"],
            "RestartPolicy": {"Name": "unless-stopped", "MaximumRetryCount": 0},
            "NanoCpus": 750_000_000,
            "Memory": 536_870_912,
            "LogConfig": {"Type": "json-file", "Config": {}},
        },
        "NetworkSettings": {"Networks": {"project": {"Aliases": ["worker"]}}},
    }
    assert runtime_compliant(fixture)
    for key, value in (("ReadonlyRootfs", False), ("PidsLimit", 0), ("Tmpfs", {}), ("MaskedPaths", ["/proc/asound"])):
        broken = json.loads(json.dumps(fixture))
        broken["HostConfig"][key] = value
        assert not runtime_compliant(broken), key
    broken = json.loads(json.dumps(fixture))
    broken["HostConfig"]["SecurityOpt"] = []
    assert not runtime_compliant(broken)
    args = build_run_command(fixture, "/run/test-env")
    joined = "\0".join(args)
    for required in (
        "--read-only",
        "\0".join(("--tmpfs", "/tmp")),
        "\0".join(("--pids-limit", "128")),
        "seccomp=unconfined",
        "systempaths=unconfined",
        "\0".join(("--network-alias", "worker")),
        "\0".join(("--cpus", "0.75")),
        "\0".join(("--memory", "536870912")),
    ):
        assert required in joined, required
    assert "SECRET=not-placed-on-command-line" not in joined
    started = json.loads(json.dumps(fixture))
    started["State"] = {"Running": True}
    started["RestartCount"] = 0
    assert worker_start_evidence(started, '{"msg":"worker started"}')
    assert not worker_start_evidence(started, '{"msg":"starting"}')
    started["RestartCount"] = 1
    assert not worker_start_evidence(started, '{"msg":"worker started"}')
    print("worker runtime guard self-test passed")


def main() -> int:
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--watch", action="store_true")
    mode.add_argument("--check", action="store_true")
    mode.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return 0
    if args.check:
        return check()
    if args.watch:
        watch()
        return 0
    reconcile()
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except GuardError as error:
        emit("fatal", error=str(error))
        raise SystemExit(1)
