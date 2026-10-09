"""python -m r2r <command>

  seed                 regenerate data/*.csv (deterministic)
  load                 load data/*.csv into PostgreSQL (PG* env vars or R2R_DSN)
  expected <report>    run legacy/<report>.sql and write parity/expected/<report>.csv
  compare <report> [actual.csv]
                       compare Power BI output (default parity/actual/<report>.csv)
  check                lint the Power BI project (TMDL/PBIR references vs data)
"""
from __future__ import annotations

import sys
from pathlib import Path

from . import PARITY_DIR


def main(argv: list[str]) -> int:
    if not argv or argv[0] in ("-h", "--help"):
        print(__doc__)
        return 0
    cmd, args = argv[0], argv[1:]
    if cmd == "seed":
        from .seed import generate
        for t, n in generate().items():
            print(f"{t:16} {n:6}")
        return 0
    if cmd == "load":
        from .db import connect, load
        with connect() as conn:
            for t, n in load(conn).items():
                print(f"{t:16} {n:6}")
        return 0
    if cmd == "expected":
        from .db import connect
        from .parity import expected
        with connect() as conn:
            for report in args:
                print(expected(conn, report))
        return 0
    if cmd == "compare":
        from .parity import compare
        report = args[0]
        actual = Path(args[1]) if len(args) > 1 else PARITY_DIR / "actual" / f"{report}.csv"
        problems = compare(PARITY_DIR / "expected" / f"{report}.csv", actual)
        for p in problems:
            print("MISMATCH", p)
        print(f"{report}: {'PARITY' if not problems else f'{len(problems)} mismatches'}")
        return 1 if problems else 0
    if cmd == "check":
        from .model_check import check
        problems = check()
        for p in problems:
            print("ERROR", p)
        print("model check:", "OK" if not problems else f"{len(problems)} problems")
        return 1 if problems else 0
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
