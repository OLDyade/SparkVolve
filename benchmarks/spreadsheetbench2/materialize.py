"""Materialize split-separated community inputs and private official scoring views."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import sys
from acquire import CATEGORIES, REVISION, ARCHIVE_SHA256, sha
from grade import initialize_office_home

def materialize(acquired, roster_file, output, split):
    initialize_office_home()
    roster = json.loads(roster_file.read_text())
    if roster["datasetRevision"] != REVISION or roster["archiveSha256"] != ARCHIVE_SHA256:
        raise ValueError("Roster provenance mismatch")
    acquisition = json.loads((acquired / "acquisition.json").read_text())
    output.mkdir(parents=True, exist_ok=False)
    manifests = {cat: acquired / acquisition["categories"][cat]["manifest"] for cat in CATEGORIES}
    tables = {cat: {str(row["id"]): row for row in json.loads(file.read_text())} for cat, file in manifests.items()}
    records = []
    cache = output / "preparation-private"
    cache.mkdir()
    originals = {}
    for task in roster["splits"][split]:
        row = tables[task["category"]][task["upstreamId"]]
        root = manifests[task["category"]].parent
        source = root / row["spreadsheet_path"]
        if sha(source) != task["inputSha256"]:
            raise ValueError("Registered task input changed")
        paths = []
        for field in ("spreadsheet_path", "golden_response_path"):
            file = root / row[field]
            key = sha(file)
            target = cache / key / "source_output.xlsx"
            if key not in originals:
                target.parent.mkdir()
                shutil.copyfile(file, target)
                originals[key] = target
            paths.append(target)
        records.append((task, row, paths))
    # Official code owns recalculation. Its filename filter requires *_output.xlsx.
    module = importlib.util.spec_from_file_location("upstream_open", acquired / "official/open_spreadsheet.py")
    upstream = importlib.util.module_from_spec(module)
    module.loader.exec_module(upstream)
    if not upstream.start_libreoffice_service():
        raise RuntimeError("Official preprocessing engine did not start")
    before = {file: file.stat().st_mtime_ns for file in originals.values()}
    try:
        upstream.batch_open_files([str(file) for file in originals.values()])
        if any(file.stat().st_mtime_ns == stamp for file, stamp in before.items()):
            raise RuntimeError('Official preprocessing did not publish every recalculated workbook')
    finally:
        upstream.stop_libreoffice_service()
    tasks = []
    for task, row, (source, golden) in records:
        public = output / "inputs" / task["id"]
        private = output / "evaluation" / task["id"]
        public.mkdir(parents=True)
        private.mkdir(parents=True)
        shutil.copyfile(source, public / "input.xlsx")
        shutil.copytree(acquired / "official", private / "official")
        shutil.copyfile(Path(__file__).with_name("grade.py"), private / "grade.py")
        data = private / "data" / task["category"]
        for key, file in (("spreadsheet_path", source), ("golden_response_path", golden)):
            target = data / row[key]
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(file, target)
        (data / "dataset.json").write_text(json.dumps([row]))
        (private / "task.json").write_text(json.dumps(task))
        tasks.append({"id": task["id"], "input": "inputs/" + task["id"],
                      "evaluation": "evaluation/" + task["id"],
                      "prompt": row["instruction"] + "\n\nRead the supplied workbook at /input/input.xlsx. Save the completed workbook to /workspace/output.xlsx. Preserve the source. Shell, Python, openpyxl and LibreOffice are available. Final deliverable is the workbook; a textual answer alone is insufficient."})
    (output / "tasks.json").write_text(json.dumps(tasks, indent=2) + "\n")
    (output / "provenance.json").write_text(json.dumps({
        "split": split, "rosterSha256": sha(roster_file), "datasetRevision": REVISION,
        "inputPreprocessing": "Unmodified official open_spreadsheet.py; LibreOffice UNO iterative calculation",
        "tasks": [{"id": task["id"], "family": task["family"], "originalInputSha256": task["inputSha256"],
                   "preparedInputSha256": sha(output / "inputs" / task["id"] / "input.xlsx")} for task, _, _ in records],
    }, indent=2) + "\n")
    shutil.rmtree(cache)
    print(json.dumps({"split": split, "tasks": len(tasks), "output": str(output)}))

if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("acquired", type=Path)
    p.add_argument("roster", type=Path)
    p.add_argument("output", type=Path)
    p.add_argument("split", choices=("development", "validation", "test"))
    args = p.parse_args()
    materialize(args.acquired.resolve(), args.roster.resolve(), args.output.resolve(), args.split)
