"""Application-selected worker entry point; execution stays outside the UI."""

import sys

from phyra_engine.execution.worker import main

if __name__ == "__main__":
    if "--cad" in sys.argv:
        from phyra_engine.execution.cad import main as cad_main

        raise SystemExit(cad_main())
    raise SystemExit(main())
