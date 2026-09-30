"""One UTF-8 JSON frame per line; numerical logs use stderr."""

import json
from typing import Any


def emit(message: dict[str, Any]) -> None:
    print(json.dumps(message, separators=(",", ":"), allow_nan=False), flush=True)
