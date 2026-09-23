"""Selection, inference routing, and reporting for evidence-grounded answers.

This is the decision layer, not a generator or trained grounding evaluator.
The demo uses authored scores and labels, not measured model outputs.
"""
import argparse
import json
import math
import random
from pathlib import Path


DEMO_CASES = [{'id': 'V1',
  'title': 'Both refund conditions are met',
  'question': 'My first purchase was eight days ago. I have made no exports. Can I get a refund?',
  'evidence': [{'id': 'refund-rule',
                'text': 'A normal refund requires a request within 14 calendar days of the initial '
                        'purchase and no export use. Both conditions must hold. Eligible customers '
                        'should contact support with charge details.'}],
  'draft': 'You meet both conditions: your initial purchase was within 14 days and you have made '
           'no exports. Contact support with the charge details to request a refund. [refund-rule]',
  'support_score': 0.96,
  'has_evidence': True,
  'conflict_detected': False,
  'missing_fields': [],
  'draft_supported': True,
  'expected_action': 'answer',
  'reviewed': True,
  'review_note': 'The policy and the customer details support eligibility and the next step.'},
 {'id': 'V2',
  'title': 'A missing purchase date',
  'question': 'This is my initial purchase and I have made no exports. Can I get a refund?',
  'evidence': [{'id': 'refund-rule',
                'text': 'A normal refund requires a request within 14 calendar days of the initial '
                        'purchase and no export use. Both conditions must hold. Eligible customers '
                        'should contact support with charge details.'}],
  'draft': 'You have made no exports, so you qualify for a refund. [refund-rule]',
  'support_score': 0.86,
  'has_evidence': True,
  'conflict_detected': False,
  'missing_fields': ['initial purchase date'],
  'draft_supported': False,
  'expected_action': 'clarify',
  'reviewed': True,
  'review_note': 'The purchase date is needed to check the 14-day condition.'},
 {'id': 'V3',
  'title': 'No relevant policy passage',
  'question': 'Does an enterprise contract include an automatic refund after an outage?',
  'evidence': [],
  'draft': 'Yes. Enterprise customers automatically receive a refund after an outage.',
  'support_score': 0.74,
  'has_evidence': False,
  'conflict_detected': False,
  'missing_fields': [],
  'draft_supported': False,
  'expected_action': 'abstain',
  'reviewed': True,
  'review_note': 'No supplied evidence establishes enterprise outage terms. The assistant should '
                 'ask support to confirm the applicable contract.'},
 {'id': 'V4',
  'title': 'Conflicting policy versions',
  'question': 'My initial purchase was ten days ago and I have made no exports. Can I get a '
              'refund?',
  'evidence': [{'id': 'refund-rule',
                'text': 'A normal refund requires a request within 14 calendar days of the initial '
                        'purchase and no export use. Both conditions must hold. Eligible customers '
                        'should contact support with charge details.'},
               {'id': 'undated-policy-copy',
                'text': 'Initial purchases can be refunded within seven days if no exports were '
                        'used.'}],
  'draft': 'You qualify because the refund window is 14 days. [refund-rule]',
  'support_score': 0.9,
  'has_evidence': True,
  'conflict_detected': True,
  'missing_fields': [],
  'draft_supported': False,
  'expected_action': 'abstain',
  'reviewed': True,
  'review_note': 'The supplied versions disagree and neither is established as authoritative. '
                 'Selecting the convenient version does not resolve the conflict.'},
 {'id': 'V5',
  'title': 'A promise the policy never made',
  'question': 'My initial purchase was five days ago. I made no exports. Am I eligible, and when '
              'will the refund arrive?',
  'evidence': [{'id': 'refund-rule',
                'text': 'A normal refund requires a request within 14 calendar days of the initial '
                        'purchase and no export use. Both conditions must hold. Eligible customers '
                        'should contact support with charge details.'}],
  'draft': 'You qualify for a refund. Contact support with the charge details, and the refund will '
           'arrive tomorrow. [refund-rule]',
  'support_score': 0.93,
  'has_evidence': True,
  'conflict_detected': False,
  'missing_fields': [],
  'draft_supported': False,
  'expected_action': 'answer',
  'reviewed': True,
  'review_note': 'Eligibility is supported, but arrival tomorrow is invented. A useful answer '
                 'would explain eligibility and say the policy gives no processing time. The '
                 'evaluator missed this unsupported claim.'},
 {'id': 'V6',
  'title': 'A normal renewal',
  'question': 'My normal renewal was charged yesterday. Is it refundable?',
  'evidence': [{'id': 'renewal-rule', 'text': 'Normal renewals are not refundable.'}],
  'draft': 'Normal renewals are not refundable under this policy. [renewal-rule]',
  'support_score': 0.83,
  'has_evidence': True,
  'conflict_detected': False,
  'missing_fields': [],
  'draft_supported': True,
  'expected_action': 'answer',
  'reviewed': True,
  'review_note': 'The policy directly answers the question.'},
 {'id': 'V7',
  'title': 'Access after cancellation',
  'question': 'I cancelled today. Does access end immediately?',
  'evidence': [{'id': 'cancellation-rule',
                'text': 'Cancellation stops the next renewal. Access continues until the end of '
                        'the paid period.'}],
  'draft': 'Your access continues until the end of the paid period. Cancellation stops the next '
           'renewal. [cancellation-rule]',
  'support_score': 0.68,
  'has_evidence': True,
  'conflict_detected': False,
  'missing_fields': [],
  'draft_supported': True,
  'expected_action': 'answer',
  'reviewed': True,
  'review_note': 'Both claims are supported. A high threshold withholds a useful answer because '
                 'the evaluator scored it too low.'},
 {'id': 'V8',
  'title': 'A confirmed duplicate payment',
  'question': 'Support confirmed a duplicate charge from last month. I have used exports. Can the '
              'duplicate be refunded?',
  'evidence': [{'id': 'duplicate-rule',
                'text': 'A confirmed duplicate charge is refunded regardless of age or export use. '
                        'Contact support with charge details.'}],
  'draft': 'Yes. Confirmed duplicate charges are refundable regardless of age or export use. '
           'Contact support with the duplicate charge details. [duplicate-rule]',
  'support_score': 0.78,
  'has_evidence': True,
  'conflict_detected': False,
  'missing_fields': [],
  'draft_supported': True,
  'expected_action': 'answer',
  'reviewed': True,
  'review_note': 'The duplicate-charge exception applies, including when exports were used.'}]
ACTIONS = {"answer", "clarify", "abstain"}


def validate(rows, require_reviews=False):
    if not rows:
        raise ValueError("The dataset is empty.")
    seen = set()
    for r in rows:
        if not isinstance(r, dict):
            raise ValueError("Every row must be an object.")
        if not isinstance(r.get("id"), str) or not r["id"].strip() or r["id"] in seen:
            raise ValueError("Every record needs a unique, nonempty string ID.")
        seen.add(r["id"])
        for key in ("question", "draft"):
            if not isinstance(r.get(key), str) or not r[key].strip():
                raise ValueError(f"{r['id']}: missing {key}")
        score = r.get("support_score")
        if type(score) not in (int, float) or not math.isfinite(score) or not 0 <= score <= 1:
            raise ValueError(f"{r['id']}: support_score must be finite and between 0 and 1")
        for key in ("has_evidence", "conflict_detected"):
            if type(r.get(key)) is not bool:
                raise ValueError(f"{r['id']}: {key} must be a boolean")
        evidence = r.get("evidence")
        if not isinstance(evidence, list) or any(
            not isinstance(e, dict) or any(not isinstance(e.get(k), str) or not e[k].strip()
                                          for k in ("id", "text")) for e in evidence
        ):
            raise ValueError(f"{r['id']}: evidence must contain passage IDs and text")
        if r["has_evidence"] and not evidence:
            raise ValueError(f"{r['id']}: evidence was flagged as present but no passages were retained")
        missing = r.get("missing_fields")
        if not isinstance(missing, list) or any(not isinstance(x, str) or not x.strip() for x in missing):
            raise ValueError(f"{r['id']}: missing_fields must be a list of field names")
        if require_reviews:
            if r.get("reviewed") is not True or type(r.get("draft_supported")) is not bool:
                raise ValueError(f"{r['id']}: a completed human review is required")
            if r.get("expected_action") not in ACTIONS:
                raise ValueError(f"{r['id']}: expected_action must be answer, clarify, or abstain")
    return rows


def threshold_value(value):
    if type(value) not in (int, float) or not math.isfinite(value) or not 0 <= value <= 1:
        raise ValueError("Threshold must be finite and between 0 and 1.")
    return value


def select_batch(rows, strategy, batch, seed=7, threshold=0.8):
    """Selection uses predicted scores only, never human labels."""
    validate(rows)
    threshold_value(threshold)
    if type(batch) is not int or not 1 <= batch <= len(rows):
        raise ValueError("Batch size must be between 1 and the pool size.")
    if strategy == "boundary":
        chosen = sorted(rows, key=lambda r: (abs(r["support_score"] - threshold), r["id"]))[:batch]
    elif strategy == "risk":
        chosen = sorted(rows, key=lambda r: (r["support_score"], r["id"]))[:batch]
    elif strategy == "random":
        chosen = random.Random(seed).sample(rows, batch)
    else:
        raise ValueError("Unknown review strategy.")
    # Hide evaluator scores and previous labels from the review request.
    return [{**{k: r[k] for k in ("id", "question", "evidence", "draft")},
             "claim_reviews": [], "draft_supported": None,
             "expected_action": None, "corrected_answer": "",
             "reviewed": False, "annotation_seconds": None} for r in chosen]


def route(record, threshold):
    """Return only the released response; never expose a blocked draft."""
    threshold_value(threshold)
    if record["conflict_detected"]:
        action, reason = "abstain", "conflicting_evidence"
        response = "The supplied policy passages conflict. Please ask support to confirm which version applies."
    elif not record["has_evidence"]:
        action, reason = "abstain", "missing_evidence"
        response = "I cannot establish the answer from the supplied policy. Please ask support to confirm the applicable terms."
    elif record["missing_fields"]:
        action, reason = "clarify", "missing_facts"
        response = "Please provide the following details so I can check the policy: " + ", ".join(record["missing_fields"]) + "."
    elif record["support_score"] >= threshold:
        action, reason, response = "answer", "score_passed", record["draft"]
    else:
        action, reason = "abstain", "insufficient_support"
        response = "I cannot confidently verify an answer from the available evidence. Please ask support to check this case."
    return {"id": record["id"], "action": action, "reason": reason, "response": response}


def metrics(rows, threshold):
    """Human labels are used for evaluation only, after routing."""
    validate(rows, require_reviews=True)
    decisions = [route(r, threshold) for r in rows]
    answered = [r for r, d in zip(rows, decisions) if d["action"] == "answer"]
    unsupported = sum(not r["draft_supported"] for r in answered)
    answerable = sum(r["expected_action"] == "answer" for r in rows)
    deferred = sum(r["expected_action"] == "answer" and d["action"] != "answer"
                   for r, d in zip(rows, decisions))
    return {"total": len(rows), "released": len(answered), "unsupported_released": unsupported,
            "coverage": len(answered) / len(rows),
            "unsupported_rate": unsupported / len(answered) if answered else None,
            "answerable": answerable, "answerable_deferred": deferred,
            "unnecessary_deferral_rate": deferred / answerable if answerable else None,
            "action_agreement": sum(r["expected_action"] == d["action"]
                                    for r, d in zip(rows, decisions)) / len(rows)}


def read(path):
    return validate([json.loads(line) for line in Path(path).read_text(encoding="utf-8").splitlines() if line.strip()])


def write_new(path, rows):
    # Protect previously collected reviews from accidental overwrite.
    with Path(path).open("x", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("demo")
    for name in ("select", "route", "report"):
        p = sub.add_parser(name)
        p.add_argument("--data", required=True)
        p.add_argument("--threshold", type=float, default=0.8)
        if name != "report":
            p.add_argument("--out", required=True)
        if name == "select":
            p.add_argument("--strategy", choices=("boundary", "risk", "random"), default="boundary")
            p.add_argument("--batch", type=int, default=2)
            p.add_argument("--seed", type=int, default=7)
    args = parser.parse_args()
    try:
        if args.command == "demo":
            print("Authored examples only. Scores are not measured or calibrated model probabilities.")
            for threshold in (0.5, 0.8, 0.95, 1.0):
                print(json.dumps({"threshold": threshold, **metrics(DEMO_CASES, threshold)}, indent=2))
            return
        threshold_value(args.threshold)
        rows = read(args.data)
        if args.command == "select":
            write_new(args.out, select_batch(rows, args.strategy, args.batch, args.seed, args.threshold))
        elif args.command == "route":
            write_new(args.out, [route(r, args.threshold) for r in rows])
        else:
            print(json.dumps(metrics(rows, args.threshold), indent=2))
    except (ValueError, OSError) as exc:
        parser.error(str(exc))


if __name__ == "__main__":
    main()
