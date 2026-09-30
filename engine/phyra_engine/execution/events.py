"""Bounded live progress, training measurements and cooperative cancellation."""

from typing import Any, Callable

Progress = Callable[[str, float | None], None]
Metrics = Callable[[dict[str, Any]], None]
Cancellation = Callable[[], bool]
