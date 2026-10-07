"""Owned native CAD diagnostics, independent of numerical/JSON execution framing.

These scopes preserve actual kernel messages while temporarily redirecting
native output channels; they never parse or discard diagnostic text. Callers
must leave the descriptor scope before publishing protocol progress or results.
"""

import contextlib
import os
import sys
from dataclasses import dataclass
from typing import Any, Callable, Iterator

from phyra_engine.errors import EngineError


def _native_fflush() -> Any:
    """Bind the application's CRT, without a project-selected library path.

    Python and OCCT's supported MSVC wheels use the system UCRT on Windows.
    The legacy msvcrt.dll can refer to a different set of buffered streams.
    https://learn.microsoft.com/en-us/cpp/windows/universal-crt-deployment
    https://docs.python.org/3.12/library/ctypes.html#loading-shared-libraries
    """
    import ctypes

    library = (
        ctypes.CDLL("ucrtbase.dll", winmode=0x00000800)  # LOAD_LIBRARY_SEARCH_SYSTEM32
        if sys.platform == "win32"
        else ctypes.CDLL(None)
    )
    flush = library.fflush
    flush.argtypes = [ctypes.c_void_p]
    flush.restype = ctypes.c_int
    return flush


@dataclass(frozen=True)
class _WindowsStandardOutput:
    set_handle: Any
    file_handle: Callable[[int], int]
    original_handle: int
    original_fd_handle: int

    def _set(self, handle: int) -> None:
        if not self.set_handle(0xFFFFFFF5, handle):  # DWORD STD_OUTPUT_HANDLE (-11)
            raise EngineError(
                "cad-log-redirect-failed", "The native Windows CAD log handle could not be set."
            )

    def redirect(self) -> None:
        self._set(self.file_handle(2))

    def restore(self) -> None:
        # dup2 closes/replaces fd 1's previous HANDLE. Restore the new fd-owned
        # HANDLE if the process table originally referred to that same stream;
        # an independent table HANDLE was never ours to close or replace.
        self._set(
            self.file_handle(1)
            if self.original_handle == self.original_fd_handle
            else self.original_handle
        )


def _windows_standard_output() -> _WindowsStandardOutput | None:
    """Keep Win32's process table aligned with the redirected CRT descriptors.

    SetStdHandle alone does not affect already cached native stream handles.
    Do both before loading shape DLLs, and also route OCCT's own messenger.
    https://learn.microsoft.com/en-us/windows/console/getstdhandle
    https://learn.microsoft.com/en-us/cpp/c-runtime-library/reference/get-osfhandle
    """
    if sys.platform != "win32":
        return None
    import ctypes
    import msvcrt

    library = ctypes.WinDLL("kernel32.dll", winmode=0x00000800, use_last_error=True)
    get_handle = library.GetStdHandle
    get_handle.argtypes = [ctypes.c_uint32]
    get_handle.restype = ctypes.c_void_p
    set_handle = library.SetStdHandle
    set_handle.argtypes = [ctypes.c_uint32, ctypes.c_void_p]
    set_handle.restype = ctypes.c_int
    original_handle = get_handle(0xFFFFFFF5)
    fd_handle = msvcrt.get_osfhandle(1)
    if original_handle in (None, 0, ctypes.c_void_p(-1).value) or fd_handle in (0, -1, -2):
        raise EngineError("cad-log-redirect-failed", "The native Windows CAD stdout is invalid.")
    if msvcrt.get_osfhandle(2) in (0, -1, -2):
        raise EngineError("cad-log-redirect-failed", "The native Windows CAD stderr is invalid.")
    return _WindowsStandardOutput(set_handle, msvcrt.get_osfhandle, original_handle, fd_handle)


@contextlib.contextmanager
def _occt_messages_to_stderr() -> Iterator[None]:
    """Route actual C++ messenger streams without suppressing any severity.

    The isolated worker owns this messenger. Native DLLs can retain C++ cout
    streams independent of Python's CRT, particularly in a frozen Windows
    executable. OCCT's supported named-stream constructor chooses native cerr.
    https://github.com/Open-Cascade-SAS/OCCT/blob/b8f597c677811d1f9f4d8a97f5ae2825c0353a42/src/FoundationClasses/TKernel/Message/Message_PrinterOStream.cxx
    """
    from OCP.Message import Message, Message_PrinterOStream  # type: ignore[import-untyped]

    printers = Message.DefaultMessenger_s().ChangePrinters()
    original = tuple(printers)
    redirected = []
    try:
        for index, printer in enumerate(original, start=1):
            if isinstance(printer, Message_PrinterOStream):
                replacement = Message_PrinterOStream("cerr", False, printer.GetTraceLevel())
                replacement.SetToColorize(printer.ToColorize())
                redirected.append(replacement)
                printers.SetValue(index, replacement)
        yield
    finally:
        try:
            for printer in redirected:
                printer.Close()  # Flush the C++ stream before descriptors are restored.
        finally:
            printers.Clear()
            for printer in original:
                printers.Append(printer)


@contextlib.contextmanager
def kernel_log_to_stderr() -> Iterator[None]:
    """OCCT's C++ stdout must never contaminate the versioned JSON wire protocol."""
    flush = _native_fflush()
    windows = _windows_standard_output()
    sys.stdout.flush()
    original = os.dup(1)
    try:
        os.dup2(2, 1)
        if windows is not None:
            windows.redirect()
        try:
            yield
        finally:
            # Flush both success and failure paths while stdout still targets
            # stderr. Python redirect_stdout cannot capture native C/C++ logs.
            # fflush(NULL) flushes this CRT's open output streams; nonzero is a
            # real write failure, not a CAD success with silently lost output.
            # https://learn.microsoft.com/en-us/cpp/c-runtime-library/reference/fflush
            try:
                sys.stdout.flush()
            finally:
                if flush(None) != 0:
                    raise EngineError(
                        "cad-log-flush-failed", "The native CAD log could not be flushed."
                    )
    finally:
        try:
            try:
                os.dup2(original, 1)
            finally:
                if windows is not None:
                    windows.restore()
        finally:
            os.close(original)


@contextlib.contextmanager
def cad_log_to_stderr() -> Iterator[None]:
    """Compose native descriptor/process-handle and actual OCCT message routing.

    Used only around kernel work; worker protocol events must be emitted after
    this scope exits. Solve-only uses the descriptor context without loading OCCT.
    """
    with kernel_log_to_stderr(), _occt_messages_to_stderr():
        yield
