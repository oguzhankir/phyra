"""Architecture gates reject dependency inversion without loading numerical backends."""

import runpy
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
BOUNDARIES = runpy.run_path(str(ROOT / "scripts" / "check-engine-boundaries.py"))


def test_current_engine_has_owned_dependencies():
    assert BOUNDARIES["check_boundaries"]() > 0


@pytest.mark.parametrize(
    ("source", "target"),
    [
        ("methods.classical.solid", "studies.project"),
        ("physics.elasticity.solid", "execution.application"),
        ("meshing.solid", "studies.mesh"),
        ("materials.isotropic", "methods.physicsml.plane_stress"),
        ("methods.physicsml.training", "results.storage"),
        ("protocol.request", "execution.registry"),
    ],
)
def test_rejects_dependency_inversion(source, target):
    assert BOUNDARIES["boundary_violation"](f"phyra_engine.{source}", f"phyra_engine.{target}")


@pytest.mark.parametrize("relative", [False, True])
def test_checks_deferred_and_relative_imports(tmp_path, relative):
    package = tmp_path / "phyra_engine"
    (package / "methods").mkdir(parents=True)
    (package / "studies").mkdir()
    (package / "studies" / "project.py").write_text("", encoding="utf-8")
    invalid = (
        "from ..studies.project import validate_project\n"
        if relative
        else "def kernel():\n    from phyra_engine.studies.project import validate_project\n"
    )
    (package / "methods" / "bad.py").write_text(invalid, encoding="utf-8")
    with pytest.raises(RuntimeError, match="cannot depend on studies.project"):
        BOUNDARIES["check_boundaries"](package)


def test_rejects_unknown_internal_module(tmp_path):
    package = tmp_path / "phyra_engine"
    (package / "physics").mkdir(parents=True)
    (package / "physics" / "bad.py").write_text(
        "import phyra_engine.physics.absent\n", encoding="utf-8"
    )
    with pytest.raises(RuntimeError, match="Internal module does not exist"):
        BOUNDARIES["check_boundaries"](package)


def test_rejects_unreviewed_computed_loading(tmp_path):
    package = tmp_path / "phyra_engine"
    (package / "execution").mkdir(parents=True)
    (package / "execution" / "bad.py").write_text(
        "import importlib\ndef load(name):\n    return importlib.import_module(name)\n",
        encoding="utf-8",
    )
    with pytest.raises(RuntimeError, match="Computed module loading"):
        BOUNDARIES["check_boundaries"](package)


@pytest.mark.parametrize(
    "source",
    [
        "from importlib import import_module\nimport_module('phyra_engine.execution.worker')\n",
        "from importlib import import_module as load\nload('phyra_engine.execution.worker')\n",
        "import importlib\nimportlib.import_module('.execution.worker', 'phyra_engine')\n",
        "import importlib\nimportlib.import_module('.execution.worker', package='phyra_engine')\n",
        "from builtins import __import__ as load\nload('phyra_engine.execution.worker')\n",
    ],
)
def test_deferred_loader_forms_cannot_bypass_ownership(tmp_path, source):
    package = tmp_path / "phyra_engine"
    (package / "materials").mkdir(parents=True)
    (package / "execution").mkdir()
    (package / "execution" / "worker.py").write_text("", encoding="utf-8")
    (package / "materials" / "bad.py").write_text(source, encoding="utf-8")
    with pytest.raises(RuntimeError, match="cannot depend on execution.worker"):
        BOUNDARIES["check_boundaries"](package)


def test_rejects_deferred_relative_import_without_known_package(tmp_path):
    package = tmp_path / "phyra_engine"
    (package / "materials").mkdir(parents=True)
    (package / "materials" / "bad.py").write_text(
        "from importlib import import_module as load\nload('.worker', package=selected)\n",
        encoding="utf-8",
    )
    with pytest.raises(RuntimeError, match="Computed module loading"):
        BOUNDARIES["check_boundaries"](package)
