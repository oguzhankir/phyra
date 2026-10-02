"""Bounded live progress, training measurements and cooperative cancellation."""

from typing import Any, Callable

Progress = Callable[[str, float | None], None]
Metrics = Callable[[dict[str, Any]], None]
Cancellation = Callable[[], bool]


def metric_record(job_id: str, value: dict[str, Any]) -> dict[str, Any]:
    """Attach execution ownership to a measured training sample at publication."""
    return {
        "jobId": job_id,
        "step": value["step"],
        "elapsed": value["elapsedSeconds"],
        "total": value["total"],
        "pde": value["pde"],
        "boundary": value["boundary"],
        "device": value["device"],
    }
