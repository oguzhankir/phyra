"""Native buffered logs never become JSON protocol output, including on failure."""

import ctypes
import json
import os
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

import pytest

from phyra_engine.errors import EngineError
from phyra_engine.geometry.cad import native_output

ROOT = Path(__file__).resolve().parents[2]


@pytest.mark.parametrize("platform", ["win32", "darwin", "linux"])
def test_native_log_binding_uses_system_ucrt_only_on_windows(platform):
    flush = Mock(return_value=0)
    with (
        patch.object(native_output.sys, "platform", platform),
        patch.object(ctypes, "CDLL", return_value=SimpleNamespace(fflush=flush)) as load,
    ):
        bound = native_output._native_fflush()
    if platform == "win32":
        # Select the CRT used by current MSVC wheels, not the obsolete msvcrt
        # runtime or a DLL found through the project/current directory.
        load.assert_called_once_with("ucrtbase.dll", winmode=0x00000800)
    else:
        load.assert_called_once_with(None)
    assert bound is flush
    assert flush.argtypes == [ctypes.c_void_p] and flush.restype is ctypes.c_int


@pytest.mark.parametrize("failure", ["kernel", "flush-result", "flush-call"])
def test_log_redirect_flushes_before_restore_and_closes_saved_fd_on_failure(failure):
    events = []

    def flush(pointer):
        assert pointer is None
        events.append("flush")
        if failure == "flush-call":
            raise OSError("native log write failed")
        return -1 if failure == "flush-result" else 0

    with (
        patch.object(native_output, "_native_fflush", return_value=flush),
        patch.object(native_output.os, "dup", return_value=99),
        patch.object(
            native_output.os,
            "dup2",
            side_effect=lambda source, target: events.append((source, target)),
        ),
        patch.object(
            native_output.os, "close", side_effect=lambda fd: events.append(("close", fd))
        ),
    ):
        with pytest.raises((EngineError, OSError)) as error:
            with native_output.kernel_log_to_stderr():
                events.append("kernel")
                if failure == "kernel":
                    raise EngineError("invalid-cad", "The kernel rejected this shape.")
    assert events == [(2, 1), "kernel", "flush", (99, 1), ("close", 99)]
    if failure != "flush-call":
        assert error.value.code == (
            "invalid-cad" if failure == "kernel" else "cad-log-flush-failed"
        )


def test_saved_descriptor_is_closed_even_when_restore_fails():
    close = Mock()
    with (
        patch.object(native_output, "_native_fflush", return_value=Mock(return_value=0)),
        patch.object(native_output.os, "dup", return_value=99),
        patch.object(native_output.os, "dup2", side_effect=[None, OSError("restore failed")]),
        patch.object(native_output.os, "close", close),
    ):
        with pytest.raises(OSError, match="restore failed"):
            with native_output.kernel_log_to_stderr():
                pass
    close.assert_called_once_with(99)


def test_runtime_binding_failure_happens_before_redirection_or_kernel_execution():
    duplicate = Mock()
    with (
        patch.object(native_output, "_native_fflush", side_effect=OSError("missing system CRT")),
        patch.object(native_output.os, "dup", duplicate),
    ):
        with pytest.raises(OSError, match="missing system CRT"):
            with native_output.kernel_log_to_stderr():
                pytest.fail("The kernel cannot run without a native log flusher.")
    duplicate.assert_not_called()


@pytest.mark.parametrize("alias", [False, True], ids=["independent-handle", "crt-handle"])
@pytest.mark.parametrize("failure", [None, "kernel", "redirect", "restore"])
def test_windows_standard_handle_and_crt_restore_owned_destinations(alias, failure):
    events = []
    handles = {1: 1001, 2: 1002}
    original_handle = handles[1] if alias else 9001

    def duplicate(source, target):
        events.append(("dup2", source, target))
        if source == 99:
            handles[target] = 2001  # restored fd 1 owns a fresh native HANDLE

    def set_handle(device, handle):
        assert device == 0xFFFFFFF5
        events.append(("SetStdHandle", handle))
        return not (
            failure == "redirect"
            and handle == 1002
            or failure == "restore"
            and handle in (2001, 9001)
        )

    get = Mock(return_value=original_handle)
    set_ = Mock(side_effect=set_handle)
    library = SimpleNamespace(GetStdHandle=get, SetStdHandle=set_)
    with (
        patch.object(native_output.sys, "platform", "win32"),
        patch.object(ctypes, "WinDLL", return_value=library, create=True) as load,
        patch.dict(sys.modules, {"msvcrt": SimpleNamespace(get_osfhandle=handles.__getitem__)}),
        patch.object(
            native_output, "_native_fflush", return_value=lambda _: events.append("flush") or 0
        ),
        patch.object(native_output.os, "dup", return_value=99),
        patch.object(native_output.os, "dup2", side_effect=duplicate),
        patch.object(
            native_output.os, "close", side_effect=lambda fd: events.append(("close", fd))
        ),
    ):

        def invoke():
            with native_output.kernel_log_to_stderr():
                events.append("kernel")
                if failure == "kernel":
                    raise EngineError("invalid-cad", "Expected kernel failure.")

        if failure is None:
            invoke()
        else:
            with pytest.raises(EngineError) as error:
                invoke()
            assert error.value.code == (
                "invalid-cad" if failure == "kernel" else "cad-log-redirect-failed"
            )
    assert events == [
        ("dup2", 2, 1),
        ("SetStdHandle", 1002),
        *([] if failure == "redirect" else ["kernel", "flush"]),
        ("dup2", 99, 1),
        ("SetStdHandle", 2001 if alias else 9001),
        ("close", 99),
    ]
    load.assert_called_once_with("kernel32.dll", winmode=0x00000800, use_last_error=True)
    get.assert_called_once_with(0xFFFFFFF5)
    assert get.argtypes == [ctypes.c_uint32] and get.restype is ctypes.c_void_p
    assert set_.argtypes == [ctypes.c_uint32, ctypes.c_void_p] and set_.restype is ctypes.c_int
    assert handles[1] == 2001


@pytest.mark.parametrize("handle", [None, 0, ctypes.c_void_p(-1).value])
def test_windows_invalid_standard_handle_fails_before_descriptor_changes(handle):
    library = SimpleNamespace(GetStdHandle=Mock(return_value=handle), SetStdHandle=Mock())
    with (
        patch.object(native_output.sys, "platform", "win32"),
        patch.object(ctypes, "WinDLL", return_value=library, create=True),
        patch.dict(sys.modules, {"msvcrt": SimpleNamespace(get_osfhandle=lambda _: 1001)}),
        patch.object(native_output, "_native_fflush", return_value=Mock()),
        patch.object(native_output.os, "dup") as duplicate,
    ):
        with pytest.raises(EngineError, match="stdout is invalid"):
            with native_output.kernel_log_to_stderr():
                pytest.fail("An invalid Win32 stdout cannot run the kernel.")
    duplicate.assert_not_called()
    library.SetStdHandle.assert_not_called()


@pytest.mark.parametrize("platform", ["darwin", "linux"])
def test_posix_does_not_load_or_change_windows_standard_handles(platform):
    with (
        patch.object(native_output.sys, "platform", platform),
        patch.object(ctypes, "WinDLL", create=True) as load,
    ):
        assert native_output._windows_standard_output() is None
    load.assert_not_called()


@pytest.mark.parametrize("fail", [False, True], ids=["success", "kernel-exception"])
def test_actual_native_standard_handle_is_redirected_and_restored_for_json(fail):
    script = """
import ctypes
import os
import sys
from phyra_engine.errors import EngineError
from phyra_engine.execution.cad import kernel_log_to_stderr

if sys.platform == 'win32':
    library = ctypes.WinDLL('kernel32.dll', winmode=0x00000800, use_last_error=True)
    get = library.GetStdHandle
    get.argtypes = [ctypes.c_uint32]
    get.restype = ctypes.c_void_p
    write = library.WriteFile
    write.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_uint32,
                     ctypes.POINTER(ctypes.c_uint32), ctypes.c_void_p]
    write.restype = ctypes.c_int
    def native_write(payload):
        count = ctypes.c_uint32()
        if not write(get(0xFFFFFFF5), payload, len(payload), ctypes.byref(count), None):
            raise ctypes.WinError(ctypes.get_last_error())
        if count.value != len(payload):
            raise RuntimeError('Incomplete native WriteFile')
else:
    def native_write(payload):
        if os.write(1, payload) != len(payload):
            raise RuntimeError('Incomplete native write')

try:
    with kernel_log_to_stderr():
        native_write(b'native-api-cad-log')
        if sys.argv[1] == 'fail':
            raise EngineError('invalid-cad', 'Expected kernel failure')
except EngineError:
    message = b'{"type":"error","code":"invalid-cad"}\\n'
else:
    message = b'{"type":"complete"}\\n'
# Exercise the restored Win32 process HANDLE, not just Python's restored fd1.
native_write(message)
sys.stdout.write('{"type":"python-output"}\\n')
sys.stdout.flush()
"""
    result = subprocess.run(
        [sys.executable, "-c", script, "fail" if fail else "success"],
        capture_output=True,
        text=True,
        env={**os.environ, "PYTHONPATH": str(ROOT / "engine")},
        timeout=30,
    )
    assert result.returncode == 0, result.stderr
    assert [json.loads(line) for line in result.stdout.splitlines()] == [
        {"type": "error", "code": "invalid-cad"} if fail else {"type": "complete"},
        {"type": "python-output"},
    ]
    assert result.stderr == "native-api-cad-log"


@pytest.mark.parametrize("fail", [False, True], ids=["success", "kernel-exception"])
def test_actual_occt_cxx_messages_preserve_severities_and_printer_identity(fail):
    script = """
import sys
from OCP.Message import Message, Message_Gravity
from phyra_engine.errors import EngineError
from phyra_engine.geometry.cad.native_output import _occt_messages_to_stderr
from phyra_engine.protocol.stdio import emit

messenger = Message.DefaultMessenger_s()
original = tuple(messenger.Printers())
for printer in original:
    printer.SetTraceLevel(Message_Gravity.Message_Trace)
    printer.SetToColorize(False)
before = [(printer.GetTraceLevel(), printer.ToColorize()) for printer in original]
try:
    with _occt_messages_to_stderr():
        for severity in ('Trace', 'Info', 'Warning', 'Alarm', 'Fail'):
            messenger.Send('actual-occt-' + severity,
                           getattr(Message_Gravity, 'Message_' + severity))
        if sys.argv[1] == 'fail':
            raise EngineError('invalid-cad', 'Expected kernel failure')
except EngineError:
    message = {'type': 'error', 'code': 'invalid-cad'}
else:
    message = {'type': 'complete'}
restored = tuple(messenger.Printers())
if restored != original or [(p.GetTraceLevel(), p.ToColorize()) for p in restored] != before:
    raise RuntimeError('OCCT messenger identity/trace configuration was not restored')
# This uses restored C++ cout; it exposes over-broad permanent replacement.
messenger.SendInfo('{"type":"restored-occt-output"}')
for printer in restored:
    printer.Close()
emit(message)
"""
    result = subprocess.run(
        [sys.executable, "-c", script, "fail" if fail else "success"],
        capture_output=True,
        text=True,
        env={**os.environ, "PYTHONPATH": str(ROOT / "engine")},
        timeout=30,
    )
    assert result.returncode == 0, result.stderr
    assert [json.loads(line) for line in result.stdout.splitlines()] == [
        {"type": "restored-occt-output"},
        {"type": "error", "code": "invalid-cad"} if fail else {"type": "complete"},
    ]
    assert result.stderr.splitlines() == [
        f"actual-occt-{severity}" for severity in ("Trace", "Info", "Warning", "Alarm", "Fail")
    ]


@pytest.mark.parametrize("preload", [False, True], ids=["cold-shape-dll", "loaded-shape-dll"])
def test_actual_step_transfer_logs_are_retained_on_stderr_with_one_json_frame(tmp_path, preload):
    geometry = {
        "kind": "cad",
        "dimension": "3d",
        "features": [
            {
                "id": "box",
                "name": "Box",
                "kind": "box",
                "length": 0.1,
                "width": 0.05,
                "height": 0.02,
            }
        ],
        "outputFeatureId": "box",
        "assets": [],
    }
    payload = {
        "protocolVersion": 1,
        "projectId": "stdio-project",
        "revision": 0,
        "jobId": "stdio-step",
        "geometry": geometry,
        "assetRoot": str(tmp_path),
    }
    # Loading OCP before redirection reproduces a native stream that may already
    # cache its destination; the explicit OCCT stderr printer must handle both.
    script = """
import sys
if sys.argv.pop(1) == 'preload':
    import OCP
from phyra_engine.execution.cad import main
raise SystemExit(main())
"""
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            script,
            "preload" if preload else "cold",
            "--cad",
            "--output",
            str(tmp_path / "output"),
        ],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
        env={**os.environ, "PYTHONPATH": str(ROOT / "engine")},
        timeout=30,
    )
    assert result.returncode == 0, result.stderr
    frames = [json.loads(line) for line in result.stdout.splitlines()]
    assert len(frames) == 1 and frames[0]["type"] == "complete"
    receipt = json.loads((tmp_path / "output" / "receipt.json").read_bytes())
    assert receipt == frames[0]["manifest"]
    assert receipt["statistics"]["volume"] == pytest.approx(0.0001, rel=1e-12)
    assert receipt["analysisCompatibility"]["state"] == "supported"
    for filename in ("output.step", "output-mm.step"):
        data = (tmp_path / "output" / filename).read_bytes()
        assert data.startswith(b"ISO-10303-21;") and data.rstrip().endswith(b"END-ISO-10303-21;")
    # Do not raise trace thresholds, remove printers, filter captured lines or
    # accept suppressed native diagnostics as a valid protocol-channel fix.
    assert result.stderr.count("Statistics on Transfer (Write)") == 2
    assert result.stderr.count("Transferring Shape") == 2


@pytest.mark.parametrize("authored_cad", [False, True], ids=["numerical", "authored-cad"])
def test_actual_numerical_worker_preserves_progress_and_cad_admission_warnings(
    tmp_path, authored_cad
):
    from phyra_engine.studies.project import migrate_project

    project = migrate_project(json.loads((ROOT / "examples" / "cantilever.json").read_bytes()))
    if authored_cad:
        project["geometry"] = {
            "kind": "cad",
            "dimension": "3d",
            "features": [
                {
                    "id": "box",
                    "name": "Box",
                    "kind": "box",
                    "length": 0.1,
                    "width": 0.05,
                    "height": 0.02,
                }
            ],
            "outputFeatureId": "box",
            "assets": [],
        }
    project["study"]["mesh"]["size"] = 0.02
    payload = {
        "protocolVersion": 1,
        "operation": "mesh",
        "jobId": "stdio-analysis",
        "project": project,
    }
    script = """
import sys
authored_cad = sys.argv.pop(1) == 'cad'
if authored_cad:
    from OCP.Message import Message
    from phyra_engine.geometry.cad import kernel
    from phyra_engine.execution import worker
    build = kernel.build
    phase = 'preparation'
    def measured_build(*args):
        # Real C++ diagnostics around every actual exact-kernel call, including
        # calls from later mesh/result/cache validators, without substituting
        # physical work or suppressing progress/result publication.
        Message.DefaultMessenger_s().SendWarning('actual-cad-admission-warning-' + phase)
        return build(*args)
    kernel.build = measured_build
    execute = worker.execute
    def measured_execute(*args, **kwargs):
        global phase
        phase = 'execution'
        return execute(*args, **kwargs)
    worker.execute = measured_execute
else:
    import importlib.abc
    class ShapeImportBlocker(importlib.abc.MetaPathFinder):
        def find_spec(self, fullname, path=None, target=None):
            if fullname == 'OCP' or fullname.startswith('OCP.'):
                raise RuntimeError('An ordinary numerical worker loaded CAD shape DLLs')
    sys.meta_path.insert(0, ShapeImportBlocker())
    from phyra_engine.execution import worker
raise SystemExit(worker.main())
"""
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            script,
            "cad" if authored_cad else "numerical",
            "--output",
            str(tmp_path),
        ],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
        env={**os.environ, "PYTHONPATH": str(ROOT / "engine")},
        timeout=60,
    )
    assert result.returncode == 0, result.stderr
    frames = [json.loads(line) for line in result.stdout.splitlines()]
    assert frames and frames[-1]["type"] == "complete"
    progress = [frame for frame in frames if frame["type"] == "progress"]
    assert progress and progress[-1]["stage"] == "writing-results"
    assert all(frame.get("jobId", "stdio-analysis") == "stdio-analysis" for frame in frames)
    receipt = json.loads((tmp_path / "manifest.json").read_bytes())
    assert receipt == frames[-1]["manifest"]
    assert receipt["operation"] == "mesh" and receipt["statistics"]["nodes"] > 0
    assert receipt["statistics"]["cells"] > 0
    if authored_cad:
        assert result.stderr.count("actual-cad-admission-warning-preparation") >= 2
        assert result.stderr.count("actual-cad-admission-warning-execution") >= 2
    else:
        assert "actual-cad-admission-warning" not in result.stderr
        assert "An ordinary numerical worker loaded CAD shape DLLs" not in result.stderr

    # Cache validation repeats exact CAD admission in the result layer. It must
    # keep both the cached scientific receipt and native diagnostic channel.
    payload["operation"] = "validate"
    reopened = subprocess.run(
        [
            sys.executable,
            "-c",
            script,
            "cad" if authored_cad else "numerical",
            "--output",
            str(tmp_path),
        ],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
        env={**os.environ, "PYTHONPATH": str(ROOT / "engine")},
        timeout=60,
    )
    assert reopened.returncode == 0, reopened.stderr
    cache_frames = [json.loads(line) for line in reopened.stdout.splitlines()]
    assert cache_frames[-1] == {"type": "complete", "manifest": receipt}
    assert any(
        frame["type"] == "progress" and frame["stage"] == "validating-cache"
        for frame in cache_frames
    )
    if authored_cad:
        assert "actual-cad-admission-warning-preparation" in reopened.stderr
        assert "actual-cad-admission-warning-execution" in reopened.stderr
    else:
        assert "actual-cad-admission-warning" not in reopened.stderr
        assert "An ordinary numerical worker loaded CAD shape DLLs" not in reopened.stderr


@pytest.mark.parametrize("fail", [False, True], ids=["success", "kernel-exception"])
def test_actual_native_buffered_log_stays_on_stderr_before_json_publication(fail):
    script = """
import ctypes
import os
import sys
from phyra_engine.errors import EngineError
from phyra_engine.execution.cad import kernel_log_to_stderr
from phyra_engine.protocol.stdio import emit

runtime = (ctypes.CDLL('ucrtbase.dll', winmode=0x00000800)
           if sys.platform == 'win32' else ctypes.CDLL(None))
# Unlike printf's MSVC inline wrapper, these stream functions are exported by
# the system UCRT. _fdopen owns descriptor 1, so fclose must restore it below.
# https://learn.microsoft.com/en-us/cpp/c-runtime-library/reference/fdopen-wfdopen
# https://learn.microsoft.com/en-us/cpp/c-runtime-library/reference/setvbuf
fdopen = runtime._fdopen if sys.platform == 'win32' else runtime.fdopen
fdopen.argtypes = [ctypes.c_int, ctypes.c_char_p]
fdopen.restype = ctypes.c_void_p
setvbuf = runtime.setvbuf
setvbuf.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_int, ctypes.c_size_t]
setvbuf.restype = ctypes.c_int
fwrite = runtime.fwrite
fwrite.argtypes = [ctypes.c_void_p, ctypes.c_size_t, ctypes.c_size_t, ctypes.c_void_p]
fwrite.restype = ctypes.c_size_t
fclose = runtime.fclose
fclose.argtypes = [ctypes.c_void_p]
fclose.restype = ctypes.c_int
saved_stdout = os.dup(1)
stream = fdopen(1, b'wb')
if not stream:
    os.close(saved_stdout)
    raise RuntimeError('native fdopen failed')
buffer = ctypes.create_string_buffer(4096)
try:
    # _IOFBF is 0 in the supported UCRT/libc headers. Keep this caller-owned
    # buffer alive through fclose; the log is shorter than its capacity.
    if setvbuf(stream, buffer, 0, len(buffer)) != 0:
        raise RuntimeError('native setvbuf failed')
    try:
        with kernel_log_to_stderr():
            # No newline or explicit flush: test the production fflush(NULL).
            payload = b'buffered-native-cad-log'
            if fwrite(payload, 1, len(payload), stream) != len(payload):
                raise RuntimeError('native fwrite failed')
            if sys.argv[1] == 'fail':
                raise EngineError('invalid-cad', 'Expected kernel failure')
    except EngineError as error:
        message = {'type': 'error', 'code': error.code}
    else:
        message = {'type': 'complete'}
finally:
    try:
        # Closing after restoration exposes an omitted/late native flush as
        # stdout contamination, rather than hiding it with test-side flushing.
        if fclose(stream) != 0:
            raise RuntimeError('native fclose failed')
    finally:
        os.dup2(saved_stdout, 1)
        os.close(saved_stdout)
emit(message)
"""
    result = subprocess.run(
        [sys.executable, "-c", script, "fail" if fail else "success"],
        capture_output=True,
        text=True,
        env={**os.environ, "PYTHONPATH": str(ROOT / "engine")},
        timeout=30,
    )
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout) == (
        {"type": "error", "code": "invalid-cad"} if fail else {"type": "complete"}
    )
    assert result.stderr == "buffered-native-cad-log"
