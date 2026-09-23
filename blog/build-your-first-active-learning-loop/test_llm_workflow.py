import copy
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest

import llm_active_learning as al


class StubTokenizer:
    eos_token_id = 99
    def apply_chat_template(self, messages, **kwargs):
        self.messages = messages
        self.kwargs = kwargs
        return [11, 12, 13, 14]
    def encode(self, text, **kwargs):
        return [21, 22, 23]


class WorkflowChecks(unittest.TestCase):
    def setUp(self):
        self.train = [al.record('S1', 'A seed question', 'An approved seed answer')]
        self.pool = [al.record('P1', 'An unannotated question'), al.record('P2', 'Another question')]
        self.request = [copy.deepcopy(self.pool[0])]
        self.answers = [{**self.pool[0], 'answer': 'A reviewed target.', 'reviewed': True, 'annotation_seconds': 73}]

    def test_merge_moves_only_requested_ids(self):
        train, pool = al.merge_annotations(self.train, self.pool, self.request, self.answers)
        self.assertEqual([r['id'] for r in train], ['S1', 'P1'])
        self.assertEqual([r['id'] for r in pool], ['P2'])
        self.assertEqual(train[-1]['annotation_seconds'], 73)
        self.assertNotIn('answer', self.pool[0])

    def test_rejects_invalid_annotation_handoffs(self):
        mutations = [dict(answer=''), dict(reviewed=False), dict(annotation_seconds=-1),
                     dict(annotation_seconds=float('nan')), dict(id='OTHER'),
                     dict(question='Changed'), dict(policy='Changed')]
        for change in mutations:
            with self.subTest(change=change), self.assertRaises(ValueError):
                al.merge_annotations(self.train, self.pool, self.request, [{**self.answers[0], **change}])
        with self.assertRaises(ValueError):
            al.merge_annotations(self.train, self.pool, self.request, self.answers * 2)
        with self.assertRaises(ValueError):
            al.merge_annotations(self.train, self.pool, self.request, [])

    def test_prompt_excludes_reference_and_masks_all_context(self):
        tok = StubTokenizer()
        row = al.record('P1', 'Question text', 'SECRET HUMAN ANSWER')
        ids, labels = al.training_example(tok, row)
        self.assertEqual(ids, [11, 12, 13, 14, 21, 22, 23, 99])
        self.assertEqual(labels, [-100, -100, -100, -100, 21, 22, 23, 99])
        self.assertNotIn('SECRET HUMAN ANSWER', json.dumps(tok.messages))
        self.assertFalse(tok.kwargs['enable_thinking'])
        self.assertTrue(tok.kwargs['add_generation_prompt'])
        with self.assertRaises(ValueError):
            al.training_example(tok, row, max_length=7)

    def test_all_rubric_fields_required(self):
        rows = [dict(policy_correct=True, grounded=True, action_correct=True),
                dict(policy_correct=True, grounded=True, action_correct=False)]
        self.assertEqual(al.grade_summary(rows), dict(reviewed=2, pass_all=1, pass_rate=.5))
        rows[1]['grounded'] = None
        with self.assertRaises(ValueError):
            al.grade_summary(rows)

    def test_prepared_splits_disjoint_and_random_needs_no_model(self):
        with tempfile.TemporaryDirectory() as folder:
            data = Path(folder) / 'data'
            al.prepare(SimpleNamespace(out=data))
            sets = [al.read(data / f'{s}.jsonl') for s in ['train', 'pool', 'validation', 'test']]
            all_ids = [r['id'] for rows in sets for r in rows]
            self.assertEqual(len(all_ids), len(set(all_ids)))
            self.assertEqual([len(rows) for rows in sets], [4, 8, 4, 4])
            self.assertTrue(all('answer' not in row for row in sets[1]))
            out = Path(folder) / 'round1'
            al.acquire(SimpleNamespace(pool=data/'pool.jsonl',out=out,strategy='random',seed=7,batch=2,
                                       model=al.MODEL,revision='main',adapter=None))
            req = al.read(out/'request.jsonl')
            self.assertEqual(len(req), 2)
            self.assertEqual(len({r['id'] for r in req}), 2)
            self.assertTrue(all('draft' not in r and 'answer' not in r for r in req))
            annotations = al.read(out/'annotations.jsonl')
            self.assertTrue(all(r['answer']=='' and not r['reviewed'] for r in annotations))


if __name__ == '__main__':
    unittest.main()
