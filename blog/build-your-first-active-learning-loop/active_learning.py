"""A dependency-free active-learning replay. Python 3.10+.

The bundled tickets are authored teaching examples, not customer data.
Run: python active_learning.py --seeds 7 23 41 --out results
Custom fully labeled replay CSV: --csv tickets.csv (id,text,label,split).
"""
from __future__ import annotations

import argparse
from collections import Counter
import csv
import hashlib
import json
import math
from pathlib import Path
import re
import sys
from time import perf_counter

CLASSES = ["access", "billing", "technical"]


class RNG:
    """Small deterministic generator shared with the browser, not cryptographic."""
    def __init__(self, seed):
        self.state = seed & 0xFFFFFFFF

    def shuffle(self, values):
        values = list(values)
        for i in range(len(values) - 1, 0, -1):
            self.state = (1664525 * self.state + 1013904223) & 0xFFFFFFFF
            j = int((self.state / 4294967296) * (i + 1))
            values[i], values[j] = values[j], values[i]
        return values


def tokens(text):
    # Intentionally simple English tokenizer. Adapt before multilingual use.
    return re.findall(r"[a-z]+", text.lower())


class NaiveBayes:
    def __init__(self, rows, classes=CLASSES):
        self.classes = list(classes)
        self.counts = {c: Counter() for c in classes}
        for row in rows:
            self.counts[row["label"]].update(tokens(row["text"]))
        self.vocab = set().union(*(set(v) for v in self.counts.values()))
        if not self.vocab:
            raise ValueError("The labeled seed has no recognized words.")
        self.totals = {c: sum(self.counts[c].values()) for c in classes}

    def probabilities(self, text):
        words = [w for w in tokens(text) if w in self.vocab]
        # Uniform class priors are an explicit modeling choice, even if a
        # random seed contains no examples of one of the known classes.
        scores = [sum(math.log((self.counts[c][w] + 1) /
                              (self.totals[c] + len(self.vocab)))
                      for w in words) for c in self.classes]
        weights = [math.exp(s - max(scores)) for s in scores]
        return [w / sum(weights) for w in weights]


def entropy(probabilities):
    return -sum(p * math.log2(p) for p in probabilities if p > 0)


def evaluate(model, rows):
    matrix = [[0] * len(model.classes) for _ in model.classes]
    for row in rows:
        p = model.probabilities(row["text"])
        prediction = max(range(len(p)), key=p.__getitem__)
        matrix[model.classes.index(row["label"])][prediction] += 1
    per_class = []
    for i, label in enumerate(model.classes):
        tp = matrix[i][i]
        fn = sum(matrix[i]) - tp
        fp = sum(row[i] for row in matrix) - tp
        denominator = 2 * tp + fp + fn
        per_class.append({"label": label, "correct": tp, "total": tp + fn,
                          "f1": 2 * tp / denominator if denominator else 0})
    return {"accuracy": sum(matrix[i][i] for i in range(len(matrix))) / len(rows),
            "macro_f1": sum(x["f1"] for x in per_class) / len(per_class),
            "matrix": matrix, "per_class": per_class, "n": len(rows)}


def validate(rows):
    if not rows or any(not {"id", "text", "label", "split"} <= row.keys() for row in rows):
        raise ValueError("Data must contain id, text, label, split columns.")
    if len({r["id"] for r in rows}) != len(rows):
        raise ValueError("IDs must be unique.")
    normalized = [" ".join(tokens(r["text"])) for r in rows]
    if any(not x for x in normalized) or len(set(normalized)) != len(normalized):
        raise ValueError("Remove empty or duplicate normalized texts before splitting.")
    if any(r["label"] not in CLASSES or r["split"] not in {"train", "validation", "test"} for r in rows):
        raise ValueError("Use access/billing/technical and train/validation/test.")
    for split in ("train", "validation", "test"):
        if {r["label"] for r in rows if r["split"] == split} != set(CLASSES):
            raise ValueError(f"{split} must include every class for this tutorial.")


def run(rows, strategy="entropy", seed=7, batch=3, rounds=6, initial=6):
    validate(rows)
    if strategy not in {"entropy", "random"}:
        raise ValueError("Unknown strategy.")
    train = sorted([r for r in rows if r["split"] == "train"], key=lambda r: r["id"])
    if not 1 <= initial < len(train) or batch < 1 or rounds < 0:
        raise ValueError("Need 1 <= initial < training size, batch >= 1, rounds >= 0.")
    # Selection sees only IDs and text. The oracle simulates purchasing labels.
    oracle = {r["id"]: r["label"] for r in train}
    shuffled = RNG(seed).shuffle([{"id": r["id"], "text": r["text"]} for r in train])
    labeled = [dict(r, label=oracle[r["id"]]) for r in shuffled[:initial]]
    initial_ids = [r["id"] for r in labeled]
    pool = sorted(shuffled[initial:], key=lambda r: r["id"])
    validation = [r for r in rows if r["split"] == "validation"]
    acquisition_rng = RNG(seed + 101)
    history, acquisitions = [], []
    fit_work = score_work = 0
    for round_id in range(rounds + 1):
        started = perf_counter()
        model = NaiveBayes(labeled)
        fit_seconds = perf_counter() - started
        fit_work += len(labeled)
        metrics = evaluate(model, validation)
        record = {"round": round_id, "labels": len(labeled), "pool": len(pool),
                  "macro_f1": metrics["macro_f1"], "accuracy": metrics["accuracy"],
                  "fit_documents_cumulative": fit_work,
                  "score_documents_cumulative": score_work,
                  "fit_seconds": fit_seconds, "acquisition_seconds": 0.0}
        history.append(record)
        if round_id == rounds or not pool:
            break
        started = perf_counter()
        if strategy == "entropy":
            ranked = []
            for row in pool:
                p = model.probabilities(row["text"])
                ranked.append(dict(row, probabilities=p, entropy=entropy(p)))
            # Quantized only for deterministic tie handling across JS/Python.
            ranked.sort(key=lambda r: (-round(r["entropy"], 12), r["id"]))
            score_work += len(pool)
        else:
            ranked = acquisition_rng.shuffle(pool)
        selected = ranked[:batch]
        record["acquisition_seconds"] = perf_counter() - started
        for row in selected:
            label = oracle[row["id"]]  # First use of this pool item's label.
            acquisitions.append({"round": round_id + 1, "id": row["id"],
                                 "text": row["text"], "label": label,
                                 "entropy": row.get("entropy", "")})
            labeled.append({"id": row["id"], "text": row["text"], "label": label})
        selected_ids = {r["id"] for r in selected}
        pool = [r for r in pool if r["id"] not in selected_ids]
    # The fixed stopping plan is complete. No test score feeds acquisition.
    test = evaluate(model, [r for r in rows if r["split"] == "test"])
    return {"strategy": strategy, "seed": seed, "initial_ids": initial_ids,
            "history": history, "acquisitions": acquisitions, "test": test,
            "training_rows": labeled}


def save_csv(path, rows):
    if rows:
        with path.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
            writer.writeheader()
            writer.writerows(rows)


def save_curve(path, result):
    colors = {"entropy": "#117c72", "random": "#a85139"}
    max_labels = max(r["labels"] for x in result for r in x["history"])
    parts = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 340" role="img">',
             '<title>Validation macro F1 by acquired label count</title>',
             '<rect width="720" height="340" fill="#fbfcf8"/>',
             '<g font-family="sans-serif" font-size="13" fill="#102832">']
    for y in (0, .25, .5, .75, 1):
        py = 280 - y * 230
        parts.append(f'<path d="M50 {py}H680" stroke="#dce5de"/><text x="8" y="{py+4}">{y:.2f}</text>')
    for run_result in result:
        points = " ".join(f'{50+r["labels"]/max_labels*630:.2f},{280-r["macro_f1"]*230:.2f}' for r in run_result["history"])
        dash = 'stroke-dasharray="6 4"' if run_result["strategy"] == "random" else ""
        parts.append(f'<polyline points="{points}" fill="none" stroke="{colors[run_result["strategy"]]}" stroke-width="2" opacity=".7" {dash}/>')
    parts.extend(['<text x="50" y="25">Validation macro F1 · each line is one seed</text>',
                  '<text x="50" y="310">Training labels →</text>',
                  f'<text x="640" y="310">{max_labels}</text>',
                  '<text x="310" y="330" fill="#117c72">Solid: entropy</text>',
                  '<text x="490" y="330" fill="#a85139">Dashed: random</text></g></svg>'])
    path.write_text("".join(parts), encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--csv", type=Path)
    parser.add_argument("--seeds", nargs="+", type=int, default=[7, 23, 41])
    parser.add_argument("--batch", type=int, default=3)
    parser.add_argument("--rounds", type=int, default=6)
    parser.add_argument("--initial", type=int, default=6)
    parser.add_argument("--out", type=Path, default=Path("results"))
    parser.add_argument("--model", type=Path, help="Saved model JSON for --predict")
    parser.add_argument("--predict", type=str)
    args = parser.parse_args()
    if args.predict is not None:
        if args.model is None:
            parser.error("--predict needs --model")
        saved = json.loads(args.model.read_text(encoding="utf-8"))
        model = NaiveBayes(saved["training_rows"], saved["classes"])
        print(json.dumps(dict(zip(model.classes, model.probabilities(args.predict))), indent=2))
        return
    source = args.csv or Path(__file__).with_name("tickets.json")
    raw = source.read_bytes()
    if args.csv:
        with source.open(encoding="utf-8-sig", newline="") as handle:
            rows = list(csv.DictReader(handle))
    else:
        rows = json.loads(raw)
    validate(rows)
    args.out.mkdir(parents=True, exist_ok=True)
    result = []
    for seed in args.seeds:
        for strategy in ("entropy", "random"):
            item = run(rows, strategy, seed, args.batch, args.rounds, args.initial)
            result.append(item)
            prefix = f"{strategy}-{seed}"
            save_csv(args.out / f"{prefix}-curve.csv", item["history"])
            save_csv(args.out / f"{prefix}-acquisitions.csv", item["acquisitions"])
            (args.out / f"{prefix}-model.json").write_text(json.dumps({"classes": CLASSES,
                "training_rows": item["training_rows"]}, indent=2), encoding="utf-8")
            print(f'{prefix}: {item["history"][-1]["labels"]} training labels; '
                  f'validation F1={item["history"][-1]["macro_f1"]:.3f}; '
                  f'final test F1={item["test"]["macro_f1"]:.3f}')
    manifest = {"python": sys.version, "data_sha256": hashlib.sha256(raw).hexdigest(),
                "source": str(source), "initial": args.initial, "batch": args.batch,
                "rounds": args.rounds, "seeds": args.seeds, "classes": CLASSES,
                "note": "Bundled data are authored examples. Timings are local CPU wall times.",
                "runs": result}
    (args.out / "results.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    save_curve(args.out / "learning-curves.svg", result)
    print(f"Saved curves, acquisition logs, models and manifest to {args.out}")


if __name__ == "__main__":
    main()
