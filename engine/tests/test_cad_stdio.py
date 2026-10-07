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
from phyra_engine.execution import cad

ROOT = Path(__file__).resolve().parents[2]


@pytest.mark.parametrize("platform", ["win32", "darwin", "linux"])
def test_native_log_binding_uses_system_ucrt_only_on_windows(platform):
    flush = Mock(return_value=0)
    with (
        patch.object(cad.sys, "platform", platform),
        patch.object(ctypes, "CDLL", return_value=SimpleNamespace(fflush=flush)) as load,
    ):
        bound = cad._native_fflush()
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
        patch.object(cad, "_native_fflush", return_value=flush),
        patch.object(cad.os, "dup", return_value=99),
        patch.object(
            cad.os, "dup2", side_effect=lambda source, target: events.append((source, target))
        ),
        patch.object(cad.os, "close", side_effect=lambda fd: events.append(("close", fd))),
    ):
        with pytest.raises((EngineError, OSError)) as error:
            with cad.kernel_log_to_stderr():
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
        patch.object(cad, "_native_fflush", return_value=Mock(return_value=0)),
        patch.object(cad.os, "dup", return_value=99),
        patch.object(cad.os, "dup2", side_effect=[None, OSError("restore failed")]),
        patch.object(cad.os, "close", close),
    ):
        with pytest.raises(OSError, match="restore failed"):
            with cad.kernel_log_to_stderr():
                pass
    close.assert_called_once_with(99)


def test_runtime_binding_failure_happens_before_redirection_or_kernel_execution():
    duplicate = Mock()
    with (
        patch.object(cad, "_native_fflush", side_effect=OSError("missing system CRT")),
        patch.object(cad.os, "dup", duplicate),
    ):
        with pytest.raises(OSError, match="missing system CRT"):
            with cad.kernel_log_to_stderr():
                pytest.fail("The kernel cannot run without a native log flusher.")
    duplicate.assert_not_called()


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
