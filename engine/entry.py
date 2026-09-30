"""Application-selected worker entry point; execution stays outside the UI."""

from phyra_engine.execution.worker import main

if __name__ == "__main__":
    raise SystemExit(main())
