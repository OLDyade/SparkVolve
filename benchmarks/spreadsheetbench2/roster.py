"""Freeze a score-blind, workbook-grouped nonvisual panel before any inference."""
import argparse
from collections import defaultdict
import hashlib
import json
from pathlib import Path
from acquire import CATEGORIES, REVISION, ARCHIVE_SHA256, EVALUATOR, sha

SEED = "SparkVolve-SB2-family-panel-2026-10-30"
# Whole families are allocated first; task quotas never split a family.
PLAN = {
    "Debugging": {"development": [2, 2, 2], "validation": [2, 2], "test": [2, 2, 2]},
    "Financial_Model": {"development": [2, 2], "validation": [2, 2], "test": [2, 2]},
    "Template": {"development": [1, 1], "validation": [1, 1], "test": [1, 1, 1, 1]},
}

def rank(value):
    return hashlib.sha256((SEED + "\0" + value).encode()).hexdigest()

def manifests(root):
    result = {}
    for category in CATEGORIES:
        matches = list((root / "upstream").glob(f"**/{category}/dataset.json"))
        if len(matches) != 1:
            raise ValueError(f"Manifest count mismatch: {category}")
        result[category] = matches[0]
    return result

def register(root, output):
    acquisition = json.loads((root / "acquisition.json").read_text())
    if acquisition["archiveSha256"] != ARCHIVE_SHA256 or acquisition["datasetRevision"] != REVISION:
        raise ValueError("Acquisition identity mismatch")
    splits = {name: [] for name in ("development", "validation", "test")}
    assigned = {}
    counts = {}
    for category, manifest in manifests(root).items():
        rows = json.loads(manifest.read_text())
        families = defaultdict(list)
        for row in rows:
            # Only paths are used for grouping. No answer positions, values or scores enter selection.
            family = str(Path(row["golden_response_path"]).as_posix())
            families[family].append(row)
        counts[category] = {"tasks": len(rows), "families": len(families)}
        ordered = sorted(families, key=lambda family: rank(category + "/" + family))
        index = 0
        for split, quotas in PLAN[category].items():
            for quota in quotas:
                family = ordered[index]
                index += 1
                candidates = sorted(families[family], key=lambda row: rank(category + "/" + str(row["id"])))
                if len(candidates) < quota:
                    raise ValueError(f"Insufficient variants in family {category}/{family}")
                opaque = hashlib.sha256((category + "/" + family).encode()).hexdigest()
                if opaque in assigned:
                    raise ValueError("Family assigned twice")
                assigned[opaque] = split
                for row in candidates[:quota]:
                    source = manifest.parent / row["spreadsheet_path"]
                    splits[split].append({
                        "id": category + "-" + str(row["id"]),
                        "category": category,
                        "upstreamId": str(row["id"]),
                        "family": opaque,
                        "inputSha256": sha(source),
                    })
    for rows in splits.values():
        rows.sort(key=lambda row: rank(row["id"]))
    smoke = []
    for category, count in (("Debugging", 2), ("Financial_Model", 1), ("Template", 1)):
        smoke += [row["id"] for row in splits["development"] if row["category"] == category][:count]
    registration = {
        "name": "sb2-mixed36", "seed": SEED, "datasetRevision": REVISION,
        "archiveSha256": ARCHIVE_SHA256, "evaluatorCommit": EVALUATOR,
        "upstream": counts, "splits": splits, "smoke": smoke,
        "selection": "Fixed SHA-256 ranking of workbook-family path, then task ID. No scores or answer contents.",
        "exposure": "Public benchmark previously used by project authors. Splits are isolated for this registered study; historical pristine held-out status is not claimed.",
        "metric": "Official per-task Modif, full registered denominator. Official Accuracy and Regression reported separately.",
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("x") as target:
        json.dump(registration, target, indent=2)
        target.write("\n")
    print(json.dumps({"roster": str(output), "counts": counts,
                      "splitSizes": {k: len(v) for k, v in splits.items()}, "smoke": smoke}, indent=2))

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("acquired", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    register(args.acquired.resolve(), args.output.resolve())
