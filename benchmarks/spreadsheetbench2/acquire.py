"""Acquire pinned upstream materials. Private answers are never printed or published."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import urllib.request
import zipfile

REVISION = "5a2215ed4121945ab09d8723df2995602090b042"
ARCHIVE = "spreadsheetbench-v2-09-10.zip"
ARCHIVE_SHA256 = "52699c974c30aced7125f3d12cdaabbbcbba8db804373d7397a5d3bdf68e5b3e"
EVALUATOR = "a7bdc2d358e052d35a94768e1f487c0d9e9c0011"
CATEGORIES = ("Debugging", "Financial_Model", "Template")

def sha(file):
    with Path(file).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()

def download(url, target):
    if target.exists():
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    partial = target.with_suffix(target.suffix + ".partial")
    with urllib.request.urlopen(url, timeout=600) as source, partial.open("wb") as output:
        while block := source.read(1024 * 1024):
            output.write(block)
    partial.rename(target)

def acquire(root):
    root = Path(root).resolve()
    archive = root / ARCHIVE
    download(f"https://huggingface.co/datasets/KAKA22/SpreadsheetBench-v2/resolve/{REVISION}/{ARCHIVE}", archive)
    if sha(archive) != ARCHIVE_SHA256:
        raise ValueError("Upstream dataset archive digest mismatch")
    with zipfile.ZipFile(archive) as z:
        for info in z.infolist():
            parts = PurePosixPath(info.filename).parts
            if info.is_dir() or not any(category in parts for category in CATEGORIES):
                continue
            if ".." in parts or info.filename.startswith("/") or (info.external_attr >> 16) & 0o170000 == 0o120000:
                raise ValueError("Unconfined archive member")
            target = root / "upstream" / info.filename
            target.parent.mkdir(parents=True, exist_ok=True)
            content = z.read(info)
            if target.exists() and target.read_bytes() != content:
                raise ValueError("Cached dataset member differs from the pinned archive")
            if not target.exists():
                target.write_bytes(content)
    for name in ("evaluation.py", "open_spreadsheet.py"):
        download(f"https://raw.githubusercontent.com/RUCKBReasoning/SpreadsheetBench-2/{EVALUATOR}/evaluation/{name}",
                 root / "official" / name)
    from grade import EVAL_SHA, OPEN_SHA
    for name, expected in (("evaluation.py", EVAL_SHA), ("open_spreadsheet.py", OPEN_SHA)):
        if sha(root / "official" / name) != expected:
            raise ValueError("Pinned evaluator identity mismatch")
    report = {}
    for category in CATEGORIES:
        files = list((root / "upstream").glob(f"**/{category}/dataset.json"))
        if len(files) != 1:
            raise ValueError(f"Expected one task manifest: {category}")
        rows = json.loads(files[0].read_text())
        report[category] = {
            "tasks": len(rows),
            "groups": len({row["golden_response_path"] for row in rows}),
            "manifest": str(files[0].relative_to(root)),
            "fields": sorted(rows[0]),
        }
    result = {"datasetRevision": REVISION, "archiveSha256": ARCHIVE_SHA256,
              "evaluatorCommit": EVALUATOR, "categories": report,
              "evaluatorFiles": {name: sha(root / "official" / name) for name in ("evaluation.py", "open_spreadsheet.py")}}
    (root / "acquisition.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory")
    acquire(parser.parse_args().directory)
