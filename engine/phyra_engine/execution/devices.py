"""Probe the actual derivatives required by the installed PyTorch runtime."""

from typing import Any

import torch

from phyra_engine.errors import EngineError


def _probe_device(device: str, dtype: torch.dtype) -> tuple[bool, str]:
    try:
        # Probe the required second spatial derivative and parameter gradient,
        # since allocation alone does not establish PINN operation support.
        coordinate = torch.tensor([[0.2, -0.3]], device=device, dtype=dtype, requires_grad=True)
        weight = torch.tensor([[0.4], [-0.1]], device=device, dtype=dtype, requires_grad=True)
        displacement = torch.tanh(coordinate @ weight)
        first = torch.autograd.grad(displacement.sum(), coordinate, create_graph=True)[0]
        second = torch.autograd.grad(first.sum(), coordinate, create_graph=True)[0]
        loss = second.square().sum() + first.square().sum()
        loss.backward()
        if weight.grad is None or not bool(torch.isfinite(weight.grad).all()):
            return False, "Required elasticity derivatives did not produce finite gradients."
        return True, "Second spatial derivatives and parameter backpropagation passed."
    except (RuntimeError, TypeError, NotImplementedError) as error:
        return False, str(error)[:400]


def device_capabilities() -> list[dict[str, Any]]:
    devices = []
    candidates = [("cpu", "CPU", torch.float64, True)]
    candidates += [
        ("mps", "Apple GPU · MPS", torch.float32, torch.backends.mps.is_available()),
        ("cuda", "NVIDIA GPU · CUDA", torch.float64, torch.cuda.is_available()),
    ]
    for device, label, dtype, backend_available in candidates:
        available, reason = (
            _probe_device(device, dtype)
            if backend_available
            else (False, "The installed runtime reports this backend unavailable.")
        )
        devices.append(
            {
                "id": device,
                "label": label,
                "precision": "float64" if dtype == torch.float64 else "float32",
                "available": available,
                "reason": reason,
            }
        )
    return devices


def select_device(requested: str) -> tuple[str, torch.dtype, str]:
    chosen = "cpu" if requested == "auto" else requested
    capability = next((entry for entry in device_capabilities() if entry["id"] == chosen), None)
    if capability is None or not capability["available"]:
        reason = capability["reason"] if capability else "Unknown device."
        raise EngineError("device-unavailable", f"{chosen}: {reason}")
    reason = (
        "Auto selects CPU float64 for stable derivatives on these small elasticity jobs."
        if requested == "auto"
        else capability["reason"]
    )
    return chosen, torch.float32 if chosen == "mps" else torch.float64, reason
