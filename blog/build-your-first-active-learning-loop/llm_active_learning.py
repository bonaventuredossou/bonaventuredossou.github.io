"""Active learning for a decoder-only policy-answering assistant.

Reference implementation. Model inference/training requires torch, transformers,
and peft. All data-management commands use only the Python standard library.
The built-in examples are authored workflow fixtures, not a benchmark.
"""
import argparse
import hashlib
import importlib.metadata
import json
import math
from pathlib import Path
import random
import sys
import time

MODEL = "Qwen/Qwen3-0.6B"
POLICY = (
    "Fictional Lumen service policy: You may cancel at any time; cancellation "
    "stops the next renewal and access continues to the end of the paid period. "
    "A refund is available only when requested within 14 calendar days of the "
    "initial purchase AND no export has been used. Renewals are not refundable. "
    "A confirmed duplicate charge is refunded regardless of export use or age. "
    "If a fact needed to decide is missing, ask for that fact. Do not invent "
    "exceptions or say you have processed a cancellation or refund. "
    "Tell eligible customers to contact support with the charge details."
)
SYSTEM = "Answer briefly using only the supplied service policy. Do not invent facts or take actions."


def read(path):
    rows = [json.loads(line) for line in Path(path).read_text(encoding="utf-8").splitlines() if line.strip()]
    ids = [r["id"] for r in rows]
    if len(set(ids)) != len(ids):
        raise ValueError("Repeated IDs in input file")
    return rows


def write(path, rows):
    Path(path).write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8")


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def fresh_dir(path):
    path = Path(path)
    path.mkdir(parents=True, exist_ok=False)
    return path


def record(number, question, answer=None):
    row = {"id": number, "policy": POLICY, "question": question}
    if answer is not None:
        row["answer"] = answer
    return row


def prepare(args):
    out = fresh_dir(args.out)
    seed = [
        record("S1", "Can I cancel my subscription today?", "Yes. You can cancel at any time. Cancellation stops the next renewal, and access continues until the end of your paid period."),
        record("S2", "Will I lose access immediately if I cancel?", "No. After cancellation, access continues until the end of your paid period; the next renewal stops."),
        record("S3", "Can I get a refund for a normal renewal?", "Renewals are not refundable under this policy. You may cancel to stop the next renewal."),
        record("S4", "Does cancelling automatically refund a renewal?", "No. Cancellation stops the next renewal; it does not refund a renewal charge. Access continues for the paid period."),
    ]
    questions = [
        "I bought my first plan 8 days ago and have not exported anything. Can I get a refund?",
        "My initial purchase was 6 days ago, but I used an export. Am I eligible?",
        "I bought the plan recently. Can I have my money back?",
        "Support confirmed two charges for one purchase. I have already used exports. Can the duplicate be refunded?",
        "My initial purchase was 19 days ago and I have not used an export. Can I get a refund?",
        "I cancelled today. Can I still use my account this week?",
        "I was charged for a normal renewal yesterday. Can I reverse it?",
        "I bought my first subscription 12 days ago and made no exports. How do I request a refund?",
    ]
    pool = [record(f"P{i+1}", q) for i, q in enumerate(questions)]
    validation = [
        record("V1", "My first payment was 10 days ago. I have made zero exports. What should I do to get a refund?", "Eligible: within 14 days, initial purchase, no exports. Contact support with charge details; do not claim processing."),
        record("V2", "I subscribed 3 days ago and exported one file. Can I be refunded?", "Not eligible under the normal refund rule because an export was used; do not invent an exception."),
        record("V3", "I want a refund but do not remember when I first paid.", "Ask for the initial purchase date and export use, and clarify if this was an initial purchase or renewal when needed."),
        record("V4", "Can I cancel now and keep access until my paid month ends?", "Yes; cancellation stops next renewal and access lasts through the paid period."),
    ]
    test = [
        record("T1", "I bought the initial plan 14 calendar days ago and made no exports. Is a refund allowed?", "Yes under the inclusive 14-day boundary. Contact support with charge details."),
        record("T2", "There is a confirmed duplicate payment from last month and I used the product. Can I recover the duplicate?", "Confirmed duplicate is refundable regardless of age or export use. Contact support; do not say refunded already."),
        record("T3", "My first purchase was 15 days ago, without any export. Can I get a normal refund?", "No normal refund: outside the 14-day window."),
        record("T4", "I cancelled after yesterday's regular renewal. Will I get that renewal payment back?", "No: renewals are non-refundable; cancellation stops the next renewal and preserves paid-period access."),
    ]
    for name, rows in [("train", seed), ("pool", pool), ("validation", validation), ("test", test)]:
        write(out / f"{name}.jsonl", rows)
    print(f"Created authored fixtures in {out}. Expand and split real questions before drawing performance conclusions.")


def prompt_ids(tokenizer, row):
    messages = [{"role": "system", "content": SYSTEM},
                {"role": "user", "content": "Policy:\n" + row["policy"] + "\n\nQuestion:\n" + row["question"]}]
    return tokenizer.apply_chat_template(messages, tokenize=True, add_generation_prompt=True,
                                         enable_thinking=False)


def load_model(args):
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer
    torch.manual_seed(args.seed)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    dtype = torch.bfloat16 if device == "cuda" and torch.cuda.is_bf16_supported() else torch.float32
    tokenizer = AutoTokenizer.from_pretrained(args.model, revision=args.revision)
    model = AutoModelForCausalLM.from_pretrained(args.model, revision=args.revision, torch_dtype=dtype).to(device)
    if getattr(args, "adapter", None):
        from peft import PeftModel
        model = PeftModel.from_pretrained(model, args.adapter)
    model.eval()
    return tokenizer, model, device


def synchronize(device):
    if device == "cuda":
        import torch
        torch.cuda.synchronize()


def generate_and_score(tokenizer, model, device, row, max_new_tokens=96, max_input_tokens=768):
    """Greedy generation; entropy from unmodified logits over the FULL vocabulary.

    Includes the EOS prediction when emitted. No temperature/top-k truncation.
    No answer, reference, or evaluation label is passed into the model.
    """
    import torch
    ids = prompt_ids(tokenizer, row)
    if len(ids) > max_input_tokens:
        raise ValueError(f"{row['id']}: prompt exceeds input cap; revise it instead of silently truncating policy")
    tensor = torch.tensor([ids], device=device)
    generated, entropies = [], []
    with torch.inference_mode():
        result = model(input_ids=tensor, use_cache=True)
        for step in range(max_new_tokens):
            logits = result.logits[0, -1].float()
            log_p = torch.log_softmax(logits, dim=-1)
            entropy_bits = -(log_p.exp() * log_p).sum().item() / math.log(2)
            token = int(logits.argmax().item())
            generated.append(token)
            entropies.append(entropy_bits)
            if token == tokenizer.eos_token_id or step + 1 == max_new_tokens:
                break
            result = model(input_ids=torch.tensor([[token]], device=device),
                           past_key_values=result.past_key_values, use_cache=True)
    return {"draft": tokenizer.decode(generated, skip_special_tokens=True).strip(),
            "mean_entropy_bits": sum(entropies) / len(entropies),
            "token_entropies_bits": entropies, "prompt_tokens": len(ids),
            "generated_tokens": len(generated),
            "hit_token_cap": generated[-1] != tokenizer.eos_token_id}


def manifest(args, model=None, **extra):
    packages = {}
    for name in ["torch", "transformers", "peft"]:
        try:
            packages[name] = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            pass
    return {"model": args.model, "requested_revision": args.revision,
            "resolved_revision": getattr(getattr(model, "config", None), "_commit_hash", None),
            "seed": args.seed, "python": sys.version, "packages": packages, **extra}


def acquire(args):
    rows = read(args.pool)
    if any("answer" in r or "reference" in r for r in rows):
        raise ValueError("Acquisition input must be unlabeled: remove answer/reference fields")
    if not 1 <= args.batch <= len(rows):
        raise ValueError("Batch size must fit the remaining pool")
    out = fresh_dir(args.out)
    started = time.perf_counter()
    diagnostics, model = [], None
    if args.strategy == "random":
        selected = random.Random(args.seed).sample(sorted(rows, key=lambda r: r["id"]), args.batch)
    else:
        tokenizer, model, device = load_model(args)
        synchronize(device)
        started = time.perf_counter()
        for row in rows:
            diagnostics.append({"id": row["id"], **generate_and_score(tokenizer, model, device, row, args.max_new_tokens)})
        synchronize(device)
        diagnostics.sort(key=lambda d: (-d["mean_entropy_bits"], d["id"]))
        by_id = {r["id"]: r for r in rows}
        selected = [by_id[d["id"]] for d in diagnostics[:args.batch]]
        write(out / "scores.jsonl", diagnostics)
    seconds = time.perf_counter() - started
    # Annotation requests omit model drafts to reduce anchoring.
    write(out / "request.jsonl", selected)
    write(out / "annotations.jsonl", [{**r, "answer": "", "reviewed": False, "annotation_seconds": None} for r in selected])
    (out / "manifest.json").write_text(json.dumps(manifest(args, model, strategy=args.strategy,
        pool_sha256=digest(rows), selected_ids=[r["id"] for r in selected],
        acquisition_seconds=seconds, scored_prompts=len(diagnostics),
        generated_tokens=sum(d["generated_tokens"] for d in diagnostics),
        scoring_adapter=args.adapter), indent=2), encoding="utf-8")
    print(f"Review {out / 'annotations.jsonl'} before updating the training set.")


def merge_annotations(train, pool, request, annotations):
    def indexed(rows):
        mapping = {r["id"]: r for r in rows}
        if len(mapping) != len(rows):
            raise ValueError("Repeated IDs")
        return mapping
    t, p, q, a = map(indexed, [train, pool, request, annotations])
    if set(t) & set(p) or not set(q) <= set(p) or set(q) != set(a):
        raise ValueError("Training/pool IDs overlap or requested annotation IDs do not match")
    approved = []
    for key, requested in q.items():
        row = a[key]
        if any(row[field] != p[key][field] or requested[field] != p[key][field]
               for field in ["policy", "question"]):
            raise ValueError("Question/policy changed during annotation")
        seconds = row.get("annotation_seconds")
        if row.get("reviewed") is not True or not isinstance(row.get("answer"), str) or not row["answer"].strip():
            raise ValueError("Every answer must be nonempty and explicitly reviewed")
        if not isinstance(seconds, (int, float)) or isinstance(seconds, bool) or not math.isfinite(seconds) or seconds < 0:
            raise ValueError("Record finite, nonnegative annotation_seconds")
        approved.append({**p[key], "answer": row["answer"].strip(), "annotation_seconds": seconds})
    return train + approved, [r for r in pool if r["id"] not in q]


def update(args):
    train, pool = merge_annotations(read(args.train), read(args.pool), read(args.request), read(args.annotations))
    out = fresh_dir(args.out)
    write(out / "train.jsonl", train)
    write(out / "pool.jsonl", pool)
    print(f"{len(train)} approved examples; {len(pool)} questions remain. Train a new adapter, then rescore this pool.")


def training_example(tokenizer, row, max_length=1024):
    prefix = prompt_ids(tokenizer, row)
    response = tokenizer.encode(row["answer"], add_special_tokens=False) + [tokenizer.eos_token_id]
    if len(prefix) + len(response) > max_length:
        raise ValueError(f"{row['id']}: training example too long; do not silently remove the answer")
    return prefix + response, [-100] * len(prefix) + response


def train_model(args):
    import torch
    from peft import LoraConfig, get_peft_model
    if args.epochs < 1:
        raise ValueError("Epoch count must be positive")
    rows = read(args.data)
    if not rows or any(not isinstance(r.get("answer"), str) or not r["answer"].strip() for r in rows):
        raise ValueError("Training requires approved, nonempty answers")
    out = fresh_dir(args.out)
    # Reinitialize the adapter at each round, from the SAME base and seed.
    tokenizer, model, device = load_model(args)
    model = get_peft_model(model, LoraConfig(task_type="CAUSAL_LM", r=8, lora_alpha=16,
        lora_dropout=0.0, target_modules=["q_proj", "v_proj"]))
    encoded = [training_example(tokenizer, r) for r in rows]
    model.config.use_cache = False
    model.train()
    optimizer = torch.optim.AdamW([p for p in model.parameters() if p.requires_grad], lr=2e-4)
    rng = random.Random(args.seed)
    steps, response_tokens = 0, 0
    synchronize(device)
    started = time.perf_counter()
    for epoch in range(args.epochs):
        order = list(range(len(encoded)))
        rng.shuffle(order)
        for start in range(0, len(order), 4):
            group = order[start:start + 4]
            optimizer.zero_grad()
            for index in group:
                ids, labels = encoded[index]
                result = model(input_ids=torch.tensor([ids], device=device),
                               labels=torch.tensor([labels], device=device), use_cache=False)
                # Mean response-token loss per example; average examples equally.
                (result.loss / len(group)).backward()
                response_tokens += sum(value != -100 for value in labels)
            torch.nn.utils.clip_grad_norm_([p for p in model.parameters() if p.requires_grad], 1.0)
            optimizer.step()
            steps += 1
    synchronize(device)
    seconds = time.perf_counter() - started
    model.config.use_cache = True
    model.save_pretrained(out)
    tokenizer.save_pretrained(out)
    (out / "run.json").write_text(json.dumps(manifest(args, model, train_sha256=digest(rows),
        training_examples=len(rows), epochs=args.epochs, optimizer_steps=steps,
        supervised_token_visits=response_tokens, training_seconds=seconds,
        annotation_seconds=sum(r.get("annotation_seconds", 0) for r in rows)), indent=2), encoding="utf-8")
    print(f"Saved adapter to {out}. Evaluate generated answers; training loss does not establish correctness.")


def evaluate_model(args):
    rows = read(args.data)
    tokenizer, model, device = load_model(args)
    results = []
    for row in rows:
        output = generate_and_score(tokenizer, model, device, row, args.max_new_tokens)
        results.append({"id": row["id"], "policy": row["policy"], "question": row["question"],
                        "response": output["draft"], "reference": row.get("answer", ""),
                        "hit_token_cap": output["hit_token_cap"],
                        "policy_correct": None, "grounded": None, "action_correct": None})
    write(args.out, results)
    Path(str(args.out) + ".manifest.json").write_text(json.dumps(manifest(args, model,
        evaluation_sha256=digest(rows), adapter=args.adapter, max_new_tokens=args.max_new_tokens), indent=2), encoding="utf-8")
    print(f"Review every answer in {args.out}; fill all three rubric fields with true or false.")


def grade_summary(rows):
    keys = ["policy_correct", "grounded", "action_correct"]
    if not rows or any(type(r.get(k)) is not bool for r in rows for k in keys):
        raise ValueError("Complete the three boolean rubric fields for EVERY response")
    return {"reviewed": len(rows), "pass_all": sum(all(r[k] for k in keys) for r in rows),
            "pass_rate": sum(all(r[k] for k in keys) for r in rows) / len(rows)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", default=MODEL)
    parser.add_argument("--revision", default="main", help="Use an immutable model commit for a comparison")
    parser.add_argument("--seed", type=int, default=7)
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("prepare"); p.add_argument("--out", required=True)
    p = sub.add_parser("acquire")
    for field in ["pool", "out"]: p.add_argument("--" + field, required=True)
    p.add_argument("--adapter"); p.add_argument("--strategy", choices=["entropy", "random"], default="entropy")
    p.add_argument("--batch", type=int, default=2); p.add_argument("--max-new-tokens", type=int, default=96)
    p = sub.add_parser("update")
    for field in ["train", "pool", "request", "annotations", "out"]: p.add_argument("--" + field, required=True)
    p = sub.add_parser("train"); p.add_argument("--data", required=True); p.add_argument("--out", required=True); p.add_argument("--epochs", type=int, default=3)
    p = sub.add_parser("evaluate"); p.add_argument("--data", required=True); p.add_argument("--adapter"); p.add_argument("--out", required=True); p.add_argument("--max-new-tokens", type=int, default=96)
    p = sub.add_parser("report"); p.add_argument("--data", required=True)
    args = parser.parse_args()
    if getattr(args, "max_new_tokens", 1) < 1:
        parser.error("max-new-tokens must be positive")
    if args.command == "report":
        print(json.dumps(grade_summary(read(args.data)), indent=2))
    else:
        {"prepare": prepare, "acquire": acquire, "update": update,
         "train": train_model, "evaluate": evaluate_model}[args.command](args)


if __name__ == "__main__":
    main()
