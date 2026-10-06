"""Application-selected worker entry point; execution stays outside the UI."""

import sys


def main() -> int:
    if "--cad" in sys.argv:
        from phyra_engine.execution.cad import main as cad_main

        return cad_main()
    from phyra_engine.execution.worker import main as numerical_main

    return numerical_main()


if __name__ == "__main__":
    raise SystemExit(main())
