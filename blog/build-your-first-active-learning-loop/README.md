# Which Examples Should an LLM Learn From Next?

The current essay uses active learning to choose which policy-answering questions should receive human-written, approved responses. `llm_active_learning.py` is the reference implementation; `llm-lab.js` powers the explanatory browser exercises.

The browser uses authored drafts and illustrative distributions. It does not execute an LLM, train an adapter, or report measured fine-tuning gains. Full Qwen inference and training have not been executed for this essay. Data handling, annotation validation, prompt/response masking, CLI data flow, and the browser interactions were checked separately.

## Reference workflow

Create a separate Python environment with PyTorch, Transformers 4.51 or later within the 4.x line, and PEFT (the code uses the 0.15–0.18 interface). A suitable GPU is preferable; CPU execution can be slow. Capture the resolved environment. Use one fixed model commit for a controlled comparison.

```sh
python -m pip install torch "transformers>=4.51,<5" "peft>=0.15,<0.19"
python llm_active_learning.py prepare --out experiment
python llm_active_learning.py train --data experiment/train.jsonl --out seed-adapter
python llm_active_learning.py acquire --pool experiment/pool.jsonl --adapter seed-adapter --strategy entropy --batch 2 --out active-round1
```

Edit `active-round1/annotations.jsonl`: fill the answer, set `reviewed` to true, and record `annotation_seconds`. Keep the ID, question, and supplied policy unchanged. Requests omit model drafts to reduce anchoring.

```sh
python llm_active_learning.py update --train experiment/train.jsonl --pool experiment/pool.jsonl --request active-round1/request.jsonl --annotations active-round1/annotations.jsonl --out active-state1
python llm_active_learning.py train --data active-state1/train.jsonl --out active-adapter1
python llm_active_learning.py evaluate --data experiment/validation.jsonl --adapter active-adapter1 --out active-validation1.jsonl
python llm_active_learning.py acquire --pool active-state1/pool.jsonl --adapter active-adapter1 --strategy entropy --batch 2 --out active-round2
```

Run the random comparison from the same starting seed model and pool, using `--strategy random`. Maintain separate states and adapters for each branch. The random branch performs uniform sampling without replacement and skips uncertainty-scoring generation. Its PRNG need not match the small browser illustration; the Python data, actual model scores, and subsequent annotation choices define the experiment.

Before adaptation, evaluate the base model on the same task by omitting `--adapter`. Each update initializes a fresh LoRA adapter on the same base checkpoint and seed, then trains on all approved examples accumulated by that branch. It does not continue training a previous adapter. Keep hyperparameters and evaluation decoding fixed and log supervised-token visits, not only epochs.

Fill the evaluation file's `policy_correct`, `grounded`, and `action_correct` fields with true/false after reviewing every response, then run:

```sh
python llm_active_learning.py report --data active-validation1.jsonl
```

Freeze the budget/model selection before evaluating `experiment/test.jsonl`. Never feed validation or test answers into acquisition or training. The included 4/8/4/4 seed/pool/validation/test rows are small authored workflow fixtures, not a benchmark. Replace them with representative questions and split related conversations/paraphrases together before making quality claims.

## Implementation details

- Qwen3-0.6B, causal LM, `enable_thinking=False`.
- Mean full-vocabulary next-token entropy from raw logits, before decoding transformations; greedy draft, default cap 96 new tokens, EOS included when emitted.
- Scoring uses a KV cache; token-cap hits are flagged. This is a readable single-example implementation, not a throughput-optimized one.
- The reference uses the Qwen chat template and concatenates tokenized generation prefix with approved answer tokens plus EOS. All prefix positions are masked with -100; the model's causal loss shifts labels internally.
- LoRA: rank 8, alpha 16, dropout 0, q_proj/v_proj, three epochs, learning rate 2e-4, four-example gradient accumulation with a correctly scaled final partial group.
- Model weights are frozen except LoRA parameters. Uniform training settings do not imply equal compute if answer lengths differ; token counts and elapsed time are logged.
- New output directories must not already exist. Evaluation output files are overwritten if their paths are reused; use distinct filenames per strategy/round.
- Global options (`--model`, `--revision`, `--seed`) precede the subcommand.

Older word-count and threshold-demo assets may remain in this directory as historical code. The current `index.html` loads `llm-lab.js` and `evaluation-lab.js` and does not link download archives.


## Evaluation and inference extension

The original training tutorial remains intact. The added sections cover active review selection, evidence-grounded inference, and coverage versus unsupported answers. `evaluation-lab.js` contains six authored review-pool records and eight separate authored validation records. Its scores and detector flags are illustrative, including one high-scoring unsupported draft. Neither browser lab trains an evaluator or reports real LLM performance.

`selective_answers.py` uses the Python standard library. It selects review requests, routes externally scored drafts, and computes metrics from completed human reviews. It does not generate drafts, retrieve evidence, fit an evaluator, or calibrate probabilities. Save the inline article code or use the repository file:

```sh
python selective_answers.py demo
python selective_answers.py select --data scored-pool.jsonl --strategy boundary --batch 10 --out review-requests.jsonl
python selective_answers.py route --data scored-validation.jsonl --threshold 0.80 --out validation-decisions.jsonl
python selective_answers.py report --data reviewed-validation.jsonl --threshold 0.80
```

Use the schema in the essay. Retain question, evidence, draft, predicted support_score, has_evidence, conflict_detected, and missing_fields. A reviewer supplies draft_supported, expected_action, and reviewed. Selection and routing never use these labels. Merge completed reviews back into the matching scored records by ID for reporting. The selection output hides evaluator scores to reduce reviewer anchoring. Remove already reviewed IDs from the development pool yourself. Random samples in Python and JavaScript can differ; each uses a seeded uniform sampling procedure.

Routing prioritizes detected evidence conflicts, absent evidence, missing facts, then the support threshold. Outputs contain only id, action, reason, and the released response, excluding rejected drafts. Detectors can be wrong. Citations in drafts are not automatically checked by this reference; supplying a support score assumes an external evaluator has inspected the claim-evidence relationship.

Report requires complete human reviews and gives null for the unsupported rate when no answers are released. Unnecessary deferrals count questions labeled answerable that received clarification or abstention. This is separate from whether the original draft was supported. Action agreement alone is not response correctness. All output files are created exclusively to avoid overwriting reviews.

Keep evaluator-training, threshold-validation, and final-test data separate. Reviewing suspicious examples is useful for finding failures but does not yield a representative error rate. Choose the threshold on validation data and evaluate the frozen system on an independent representative test. The fixture is too small for performance or reliability claims.
