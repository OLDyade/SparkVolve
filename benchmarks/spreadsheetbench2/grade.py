"""Invoke the pinned official CLI unchanged; expose aggregate scores only."""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import os

EVAL_SHA = "04a2a75b29805ab40efe93e202384c365d1d32b9c924c1a4aed56e41249facb0"
OPEN_SHA = "9f50ca883067c99dbd254f2b6620dd97157c1f56ae24e0ec692d30813a82dba1"
def sha(file):
    return hashlib.sha256(Path(file).read_bytes()).hexdigest()

def initialize_office_home():
    for name in ("HOME", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_RUNTIME_DIR"):
        Path(os.environ[name]).mkdir(parents=True, exist_ok=True)

def main():
    initialize_office_home()
    workspace = Path("/workspace")
    meta = json.loads(Path("/evaluation/task.json").read_text())
    for name, expected in (("evaluation.py", EVAL_SHA), ("open_spreadsheet.py", OPEN_SHA)):
        if sha(Path("/evaluation/official") / name) != expected:
            raise ValueError("Official evaluator identity changed")
    official = workspace / "official"
    shutil.copytree("/evaluation/official", official / "evaluation")
    shutil.copytree("/evaluation/data", official / "data")
    outputs = workspace / "output_excel"
    outputs.mkdir()
    source = Path("/delivery/output.xlsx")
    if source.is_file():
        output = outputs / (meta["upstreamId"] + "_output.xlsx")
        shutil.copyfile(source, output)
        before = output.stat().st_mtime_ns
        command = [sys.executable, str(official / "evaluation/open_spreadsheet.py"), "--dir_path", str(outputs)]
        result = subprocess.run(command, capture_output=True, text=True, timeout=600)
        (workspace / "recalculation.log").write_text(result.stdout + result.stderr)
        if output.stat().st_mtime_ns == before or result.returncode or "Error [" in result.stdout or "failed" in result.stdout.lower() or "Cannot " in result.stdout or "Batch processing error" in result.stdout:
            raise RuntimeError("Official delivery recalculation failed; see private log")
    result = subprocess.run([sys.executable, str(official / "evaluation/evaluation.py"),
                             "--model", "sparkvolve", "--dataset", meta["category"],
                             "--outputs-dir", str(outputs), "--workers", "1"],
                            cwd=workspace, capture_output=True, text=True, timeout=600)
    (workspace / "evaluation.log").write_text(result.stdout + result.stderr)
    result.check_returncode()
    reports = list((workspace / "results" / meta["category"]).glob("*.json"))
    if len(reports) != 1:
        raise ValueError("Official result count mismatch")
    raw = json.loads(reports[0].read_text())
    if raw["total_tests"] != 1 or len(raw["scores"]) != 1:
        raise ValueError("Official denominator mismatch")
    score = raw["scores"][0]
    if str(score["id"]) != meta["upstreamId"]:
        raise ValueError("Official task identity mismatch")
    # The untouched raw report stays in the private grader workspace.
    # Never return error_message: it can contain answer values and coordinates.
    public = {
        "score": score["modification_accuracy"],
        "metrics": {"official_accuracy": score["accuracy"],
                    "official_regression": score["regression_accuracy"],
                    "missing_output": raw["missing_outputs"]},
        "feedback": "Official aggregate scores only. Inspect authorized source inputs and your own execution evidence for diagnosis.",
    }
    (workspace / "result.json").write_text(json.dumps(public) + "\n")

if __name__ == "__main__":
    main()
