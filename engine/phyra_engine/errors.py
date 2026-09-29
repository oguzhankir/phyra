class EngineError(ValueError):
    """An actionable, machine-readable model or execution failure."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
