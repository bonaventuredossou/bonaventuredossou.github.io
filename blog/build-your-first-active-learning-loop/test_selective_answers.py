import copy
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
import selective_answers as s


class SelectiveAnswerTests(unittest.TestCase):
    def test_routes_ignore_gold_and_block_raw_drafts(self):
        for r in s.DEMO_CASES:
            no_gold = {k: v for k, v in r.items() if k not in ('reviewed', 'draft_supported', 'expected_action', 'review_note')}
            result = s.route(no_gold, .8)
            self.assertEqual(result, s.route(r, .8))
            self.assertEqual(set(result), {'id', 'action', 'reason', 'response'})
            if result['action'] != 'answer':
                self.assertNotIn(r['draft'], json.dumps(result))
        self.assertEqual(s.route(s.DEMO_CASES[1], 0)['action'], 'clarify')
        self.assertEqual(s.route(s.DEMO_CASES[2], 0)['reason'], 'missing_evidence')
        self.assertEqual(s.route(s.DEMO_CASES[3], 0)['reason'], 'conflicting_evidence')
        self.assertEqual(s.route(s.DEMO_CASES[4], .8)['action'], 'answer')

    def test_metric_denominators_and_zero_coverage(self):
        m = s.metrics(s.DEMO_CASES, .8)
        self.assertEqual((m['released'], m['unsupported_released'], m['answerable'], m['answerable_deferred']), (3, 1, 5, 2))
        self.assertAlmostEqual(m['unsupported_rate'], 1/3)
        self.assertEqual(s.metrics(s.DEMO_CASES, .95)['released'], 1)
        self.assertEqual(s.metrics(s.DEMO_CASES, 1)['coverage'], 0)
        self.assertIsNone(s.metrics(s.DEMO_CASES, 1)['unsupported_rate'])

    def test_selection_ignores_labels_and_avoids_duplicates(self):
        flipped = copy.deepcopy(s.DEMO_CASES)
        for r in flipped:
            r['draft_supported'] = not r['draft_supported']
            r['expected_action'] = 'abstain'
        for strategy in ('boundary', 'risk', 'random'):
            original = s.select_batch(s.DEMO_CASES, strategy, 3)
            self.assertEqual(original, s.select_batch(flipped, strategy, 3))
            self.assertEqual(len({r['id'] for r in original}), 3)
            self.assertTrue(all(r['draft_supported'] is None and r['reviewed'] is False for r in original))
            self.assertTrue(all('support_score' not in r for r in original))
        with self.assertRaises(ValueError):
            s.select_batch(s.DEMO_CASES, 'boundary', 9)

    def test_validation_rejects_bad_scores_or_unreviewed_metrics(self):
        for invalid in (float('nan'), float('inf'), -.1, 1.1, True, '0.8'):
            rows = copy.deepcopy(s.DEMO_CASES)
            rows[0]['support_score'] = invalid
            with self.assertRaises(ValueError):
                s.validate(rows)
        rows = copy.deepcopy(s.DEMO_CASES)
        rows[0]['reviewed'] = False
        with self.assertRaises(ValueError):
            s.metrics(rows, .8)
        with self.assertRaises(ValueError):
            s.validate([s.DEMO_CASES[0], s.DEMO_CASES[0]])
        with self.assertRaises(ValueError):
            s.metrics(s.DEMO_CASES, float('nan'))

    def test_cli_selection_routing_reporting_and_overwrite_protection(self):
        script = str(Path(s.__file__).resolve())
        with tempfile.TemporaryDirectory() as d:
            inp, output = Path(d)/'scored.jsonl', Path(d)/'out.jsonl'
            s.write_new(inp, s.DEMO_CASES)
            def run(*args):
                return subprocess.run([sys.executable, script, *args], capture_output=True, text=True)
            selected = run('select', '--data', str(inp), '--out', str(output))
            self.assertEqual(selected.returncode, 0, selected.stderr)
            before = output.read_bytes()
            self.assertNotEqual(run('route', '--data', str(inp), '--out', str(output)).returncode, 0)
            self.assertEqual(output.read_bytes(), before)
            routed = Path(d)/'routed.jsonl'
            self.assertEqual(run('route', '--data', str(inp), '--out', str(routed)).returncode, 0)
            self.assertTrue(all('draft' not in json.loads(line) for line in routed.read_text().splitlines()))
            report = run('report', '--data', str(inp))
            self.assertEqual(report.returncode, 0, report.stderr)
            self.assertEqual(json.loads(report.stdout)['released'], 3)


if __name__ == '__main__':
    unittest.main()
