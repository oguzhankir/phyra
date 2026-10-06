"""Enforce numerical ownership without importing native libraries or numerical methods."""

from __future__ import annotations

import ast
import importlib.util
from collections.abc import Iterator
from pathlib import Path

PACKAGE = Path(__file__).resolve().parents[1] / "engine" / "phyra_engine"
PRIMITIVES = frozenset(("execution.events", "execution.limits"))
DEPENDENCIES = {
    "geometry": frozenset(("geometry",)),
    "materials": frozenset(("materials",)),
    "meshing": frozenset(("meshing", "geometry")),
    "physics": frozenset(("physics", "geometry", "materials", "meshing")),
    "studies": frozenset(("studies", "geometry", "materials", "meshing", "physics")),
    "methods": frozenset(("methods", "geometry", "materials", "meshing", "physics")),
    "results": frozenset(("results", "geometry", "materials", "meshing", "physics")),
    "protocol": frozenset(("protocol",)),
    "execution": frozenset(
        (
            "execution",
            "protocol",
            "studies",
            "methods",
            "results",
            "meshing",
            "physics",
        )
    ),
}
# These are concrete shared contracts, not access to higher-level orchestration.
SHARED_CONTRACTS = {
    "methods": frozenset(
        ("execution.devices", "results.fields", "results.diagnostics")
    ),
    "results": frozenset(("studies.project", "protocol.request")),
    "protocol": frozenset(("studies.project",)),
}
# Cached fields are independently checked against the implemented classical operator.
SPECIFIC_DEPENDENCIES = {
    "execution.cad": frozenset(
        (
            "geometry.cad",
            "geometry.cad.kernel",
            "geometry.cad.topology",
            "geometry.cad.tessellation",
            "geometry.cad.compatibility",
        )
    ),
    "results.plane_stress_validation": frozenset(
        (
            "methods.classical.plane_stress",
            "methods.classical.scikit_plane",
        )
    ),
}


def boundary_violation(source: str, target: str) -> str | None:
    """Return an ownership error for absolute internal module names."""
    prefix = "phyra_engine."
    if target == "phyra_engine" or target == prefix + "errors":
        return None
    if not target.startswith(prefix):
        return None
    source = source.removeprefix(prefix)
    target = target.removeprefix(prefix)
    owner = source.split(".")[0]
    if target in PRIMITIVES or target in SHARED_CONTRACTS.get(owner, ()):
        return None
    if target in SPECIFIC_DEPENDENCIES.get(source, ()):
        return None
    if target.split(".")[0] in DEPENDENCIES.get(owner, ()):
        return None
    return f"{source} cannot depend on {target}; keep physical kernels below study/execution orchestration."


def module_name(path: Path, package: Path) -> str:
    parts = path.relative_to(package.parent).with_suffix("").parts
    return ".".join(parts[:-1] if parts[-1] == "__init__" else parts)


def imports(
    tree: ast.AST, source: str, modules: set[str], is_package: bool
) -> Iterator[tuple[int, str]]:
    """Resolve from/import and literal deferred imports, including relative forms."""
    loaders = {"__import__"}
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom):
            exported = (
                "import_module"
                if node.module == "importlib"
                else "__import__"
                if node.module == "builtins"
                else None
            )
            loaders.update(
                alias.asname or alias.name
                for alias in node.names
                if alias.name == exported
            )
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                yield node.lineno, alias.name
        elif isinstance(node, ast.ImportFrom):
            if node.level:
                package = source.split(".") if is_package else source.split(".")[:-1]
                base = ".".join(package[: len(package) - node.level + 1])
                module = f"{base}.{node.module}" if node.module else base
            else:
                module = node.module or ""
            for alias in node.names:
                candidate = f"{module}.{alias.name}"
                yield node.lineno, candidate if candidate in modules else module
        elif isinstance(node, ast.Call):
            deferred = (
                isinstance(node.func, ast.Name)
                and node.func.id in loaders
                or isinstance(node.func, ast.Attribute)
                and node.func.attr == "import_module"
            )
            if deferred and node.args:
                value = node.args[0]
                if not isinstance(value, ast.Constant) or not isinstance(
                    value.value, str
                ):
                    yield node.lineno, "<computed-import>"
                else:
                    target = value.value
                    if target.startswith("."):
                        package_argument = (
                            node.args[1]
                            if len(node.args) > 1
                            else next(
                                (
                                    kw.value
                                    for kw in node.keywords
                                    if kw.arg == "package"
                                ),
                                None,
                            )
                        )
                        if not isinstance(
                            package_argument, ast.Constant
                        ) or not isinstance(package_argument.value, str):
                            target = "<computed-import>"
                        else:
                            try:
                                target = importlib.util.resolve_name(
                                    target, package_argument.value
                                )
                            except (ImportError, ValueError):
                                target = "<computed-import>"
                    yield node.lineno, target


def check_boundaries(package: Path = PACKAGE) -> int:
    files = sorted(package.rglob("*.py"))
    modules = {module_name(path, package) for path in files}
    failures = []
    for path in files:
        source = module_name(path, package)
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for line, target in imports(tree, source, modules, path.name == "__init__.py"):
            problem = (
                "Computed module loading requires an explicit reviewed adapter."
                if target == "<computed-import>"
                else boundary_violation(source, target)
            )
            if target.startswith("phyra_engine.") and target not in modules:
                problem = f"Internal module does not exist: {target}."
            if problem:
                failures.append(f"{path.relative_to(package.parent)}:{line}: {problem}")
    if failures:
        raise RuntimeError("Engine ownership violations:\n" + "\n".join(failures))
    return len(files)


if __name__ == "__main__":
    print(f"Engine ownership: {check_boundaries()} production modules checked.")
