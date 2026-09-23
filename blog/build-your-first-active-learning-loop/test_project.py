"""Run with python -m unittest -v test_project.py."""
import copy
import json
import math
from pathlib import Path
import unittest

from active_learning import CLASSES, NaiveBayes, entropy, run, validate

DATA = json.loads(Path(__file__).with_name("tickets.json").read_text(encoding="utf-8"))


class ProjectChecks(unittest.TestCase):
    def test_entropy_and_unknown_vocabulary(self):
        self.assertEqual(entropy([1, 0, 0]), 0)
        self.assertAlmostEqual(entropy([1 / 3] * 3), math.log2(3))
        self.assertAlmostEqual(entropy([.9, .05, .05]), .5689955935892812)
        model = NaiveBayes([r for r in DATA if r["split"] == "train"][:6])
        self.assertEqual(model.probabilities("quasar nebula pulsar"), [1 / 3] * 3)

    def test_bookkeeping_and_disjoint_sets(self):
        heldout = {r["id"] for r in DATA if r["split"] != "train"}
        for seed in (7, 23, 41):
            results = [run(DATA, strategy, seed) for strategy in ("entropy", "random")]
            self.assertEqual(results[0]["initial_ids"], results[1]["initial_ids"])
            for result in results:
                acquired = [r["id"] for r in result["acquisitions"]]
                all_ids = result["initial_ids"] + acquired
                self.assertEqual(len(set(all_ids)), 24)
                self.assertFalse(set(all_ids) & heldout)
                self.assertEqual([r["labels"] for r in result["history"]], list(range(6, 25, 3)))
                self.assertTrue(all(r["labels"] + r["pool"] == 42 for r in result["history"]))
                self.assertEqual(result["history"][-1]["fit_documents_cumulative"], 105)
                self.assertEqual(result["history"][-1]["score_documents_cumulative"],
                                 171 if result["strategy"] == "entropy" else 0)
                self.assertTrue(all(0 <= r["macro_f1"] <= 1 for r in result["history"]))

    def test_hidden_pool_labels_do_not_choose_the_first_batch(self):
        original = run(DATA, rounds=1)
        changed = copy.deepcopy(DATA)
        seed_ids = set(original["initial_ids"])
        for row in changed:
            if row["split"] == "train" and row["id"] not in seed_ids:
                row["label"] = CLASSES[(CLASSES.index(row["label"]) + 1) % 3]
        rerun = run(changed, rounds=1)
        self.assertEqual([r["id"] for r in original["acquisitions"]],
                         [r["id"] for r in rerun["acquisitions"]])

    def test_test_set_cannot_change_acquisition_or_vocabulary(self):
        original = run(DATA)
        changed = copy.deepcopy(DATA)
        for row in changed:
            if row["split"] == "test":
                row["text"] = "quasar " + row["text"]
                row["label"] = CLASSES[(CLASSES.index(row["label"]) + 1) % 3]
        rerun = run(changed)
        self.assertEqual(original["acquisitions"], rerun["acquisitions"])
        self.assertEqual(original["training_rows"], rerun["training_rows"])
        self.assertNotIn("quasar", NaiveBayes(rerun["training_rows"]).vocab)

    def test_validation_labels_do_not_drive_fixed_budget_acquisition(self):
        changed = copy.deepcopy(DATA)
        for row in changed:
            if row["split"] == "validation":
                row["label"] = CLASSES[(CLASSES.index(row["label"]) + 1) % 3]
        self.assertEqual(run(DATA)["acquisitions"], run(changed)["acquisitions"])

    def test_pool_exhaustion_and_partial_batch(self):
        result = run(DATA, batch=7, rounds=100)
        self.assertEqual(len(result["training_rows"]), 42)
        self.assertEqual(result["history"][-1]["pool"], 0)
        self.assertEqual(len(result["acquisitions"]), 36)
        self.assertEqual(len(run(DATA, rounds=0)["acquisitions"]), 0)

    def test_input_validation(self):
        with self.assertRaises(ValueError):
            validate(DATA + [DATA[0]])
        changed = copy.deepcopy(DATA)
        changed[0]["text"] = changed[1]["text"]
        with self.assertRaises(ValueError):
            validate(changed)
        with self.assertRaises(ValueError):
            run(DATA, batch=0)


if __name__ == "__main__":
    unittest.main()
