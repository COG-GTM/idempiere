"""Static checks for the Power BI project, so broken TMDL/PBIR fails CI on Linux
before anyone opens Power BI Desktop on Windows."""
from __future__ import annotations

import csv
import json
import re
from pathlib import Path

from . import DATA_DIR, PBI_DIR

TABLE_RE = re.compile(r"^table\s+('?)(.+?)\1\s*$")
COL_RE = re.compile(r"^\tcolumn\s+('?)(.+?)\1\s*$")
MEASURE_RE = re.compile(r"^\tmeasure\s+('?)(.+?)\1\s*=")
SOURCE_RE = re.compile(r"^\t\tsourceColumn:\s*(.+)$")
CSV_RE = re.compile(r'DataFolder\s*&\s*"\\\\?([^"]+\.csv)"')
REF_RE = re.compile(r"'([^']+)'\[([^\]]+)\]")


def parse_model(sm: Path) -> dict:
    tables = {}
    for f in sorted((sm / "definition" / "tables").glob("*.tmdl")):
        text = f.read_text(encoding="utf-8")
        name, cols, measures, sources = None, set(), set(), []
        for line in text.splitlines():
            if m := TABLE_RE.match(line):
                name = m.group(2)
            elif m := COL_RE.match(line):
                cols.add(m.group(2))
            elif m := MEASURE_RE.match(line):
                measures.add(m.group(2))
            elif m := SOURCE_RE.match(line):
                sources.append(m.group(1).strip())
        csv_file = CSV_RE.search(text)
        dax = text.split("\tpartition ")[0]
        tables[name] = {"file": f, "text": dax, "columns": cols, "measures": measures, "sources": sources,
                        "csv": csv_file.group(1) if csv_file else None}
    return tables


def check(pbi_dir: Path = PBI_DIR, data_dir: Path = DATA_DIR) -> list[str]:
    problems: list[str] = []
    for sm in sorted(pbi_dir.glob("*.SemanticModel")):
        tables = parse_model(sm)
        model_text = (sm / "definition" / "model.tmdl").read_text(encoding="utf-8")
        all_measures = {m for t in tables.values() for m in t["measures"]}
        for name, t in tables.items():
            if f"ref table {name}" not in model_text and f"ref table '{name}'" not in model_text:
                problems.append(f"{sm.name}: table {name} not referenced in model.tmdl")
            if t["csv"]:
                path = data_dir / t["csv"]
                if not path.exists():
                    problems.append(f"{name}: data file {t['csv']} missing")
                else:
                    header = next(csv.reader(path.open(encoding="utf-8")))
                    for s in t["sources"]:
                        if s not in header:
                            problems.append(f"{name}: sourceColumn {s} not in {t['csv']}")
            for tbl, col in REF_RE.findall(t["text"]):
                if tbl not in tables:
                    problems.append(f"{name}: DAX references unknown table '{tbl}'")
                elif col not in tables[tbl]["columns"] and col not in tables[tbl]["measures"]:
                    problems.append(f"{name}: DAX references unknown column '{tbl}'[{col}]")
            for ref in re.findall(r"(?<![\w'\]])\[([^\]]+)\]", t["text"]):
                if ref not in all_measures and not any(ref in x["columns"] for x in tables.values()):
                    problems.append(f"{name}: DAX references unknown measure [{ref}]")
        for daxf in sorted((pbi_dir.parent / "dax").glob("*.dax")):
            body = "\n".join(l for l in daxf.read_text().splitlines() if not l.strip().startswith("//"))
            for tbl, col in REF_RE.findall(body):
                if tbl not in tables or (col not in tables[tbl]["columns"] and col not in tables[tbl]["measures"]):
                    problems.append(f"{daxf.name}: unknown reference '{tbl}'[{col}]")
        rel = (sm / "definition" / "relationships.tmdl").read_text(encoding="utf-8")
        for side in re.findall(r"(?:from|to)Column:\s*(.+)", rel):
            m = re.match(r"('?)(.+?)\1\.('?)(.+?)\3\s*$", side.strip())
            if not m or m.group(2) not in tables or m.group(4) not in tables[m.group(2)]["columns"]:
                problems.append(f"relationship endpoint not found: {side.strip()}")
        for rp in sorted(pbi_dir.glob("*.Report")):
            pages = json.loads((rp / "definition" / "pages" / "pages.json").read_text())
            for page in pages["pageOrder"]:
                if not (rp / "definition" / "pages" / page / "page.json").exists():
                    problems.append(f"{rp.name}: page {page} listed in pages.json but missing")
            for vf in sorted(rp.glob("definition/pages/*/visuals/*/visual.json")):
                for kind, ref in iter_fields(json.loads(vf.read_text())):
                    entity, prop = ref
                    t = tables.get(entity)
                    pool = (t["measures"] if kind == "Measure" else t["columns"]) if t else set()
                    if prop not in pool:
                        problems.append(f"{vf.relative_to(pbi_dir)}: {kind} {entity}.{prop} not in model")
    return problems


def iter_fields(node):
    if isinstance(node, dict):
        for kind in ("Column", "Measure"):
            if kind in node and isinstance(node[kind], dict) and "Property" in node[kind]:
                src = node[kind].get("Expression", {}).get("SourceRef", {})
                if "Entity" in src:
                    yield kind, (src["Entity"], node[kind]["Property"])
        for v in node.values():
            yield from iter_fields(v)
    elif isinstance(node, list):
        for v in node:
            yield from iter_fields(v)
