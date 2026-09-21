/* All numerical traces in this file are invented teaching examples. */
"use strict";
const StoppingModel = (() => {
  const scenarios = {
    plateau: {
      note: "Rapid early gains give way to smaller improvements. A flat curve may leave money for a different problem.",
      a: [26, 19, 14, 11, 9, 8.3, 8, 7.8, 7.7, 7.6, 7.5, 7.5, 7.4],
      b: [36, 28, 21, 16, 13, 11.8, 11.3, 11, 10.8, 10.7, 10.6, 10.6, 10.5],
      u: [80, 63, 49, 36, 25, 19, 14, 12, 11, 10, 10, 9, 9]
    },
    delayed: {
      note: "Progress can look flat without being finished. Decide using the rounds you have observed; the continuation stays hidden until you stop.",
      a: [26, 19, 16, 15.8, 15.6, 12, 9, 7.5, 7.1, 6.9, 6.8, 6.7, 6.7],
      b: [36, 29, 25, 24.8, 24.7, 21, 17, 13, 11, 10, 9.5, 9.3, 9.2],
      u: [80, 60, 33, 19, 14, 12, 11, 10, 9, 8, 8, 7, 7]
    },
    group: {
      note: "Group A contributes 80% of the average; group B contributes 20%. Check whether an improving headline leaves a group behind. The groups are fictional.",
      a: [18, 11, 8.5, 7.2, 7, 6.9, 6.8, 6.7, 6.6, 6.5, 6.4, 6.3, 6.2],
      b: [48, 43, 39, 37, 36.5, 36, 29, 22, 17, 14, 12.5, 11.5, 10.8],
      u: [75, 48, 29, 19, 14, 12, 11, 10, 9, 8, 7, 6, 6]
    }
  };
  const rules = { plateau: "Recent-gain plateau", uncertainty: "Low uncertainty proxy", target: "Both group targets", budget: "Budget only" };
  function reading(scenario, round) {
    const d = scenarios[scenario];
    return { a: d.a[round], b: d.b[round], overall: 0.8 * d.a[round] + 0.2 * d.b[round], uncertainty: d.u[round] };
  }
  function batchCost(mode, round) { return 40 + 10 + (mode === "fa" ? 2.5 * round : 0); }
  function spent(mode, round) { return 50 * round + (mode === "fa" ? 1.25 * round * (round + 1) : 0); }
  function affordableRounds(mode, budget) {
    let r = 0;
    while (r < 12 && spent(mode, r + 1) <= budget + 1e-9) r++;
    return r;
  }
  function createState(scenario = "plateau", mode = "cf", budget = 600) {
    if (!scenarios[scenario] || !["cf", "fa"].includes(mode) || ![300, 600, 900].includes(budget)) throw new Error("Unknown experiment setting");
    return { scenario, mode, budget, round: 0, phase: "running", reason: "", revealed: false };
  }
  function limitReason(s) {
    if (s.round >= 12) return "Pool exhausted";
    if (spent(s.mode, s.round + 1) > s.budget + 1e-9) return "Next batch exceeds budget";
    return "";
  }
  function ruleSatisfied(s, rule) {
    const d = reading(s.scenario, s.round);
    if (rule === "target") return Math.max(d.a, d.b) <= 12;
    if (rule === "uncertainty") return d.uncertainty <= 15;
    if (rule === "plateau" && s.round >= 2) {
      const gain = r => reading(s.scenario, r - 1).overall - reading(s.scenario, r).overall;
      return gain(s.round) < 0.5 - 1e-9 && gain(s.round - 1) < 0.5 - 1e-9;
    }
    return false;
  }
  function stop(s, reason = "Your stopping decision") {
    return s.phase === "running" ? { ...s, phase: "stopped", reason } : s;
  }
  function acquire(s) {
    if (s.phase !== "running") return s;
    if (limitReason(s)) return stop(s, limitReason(s));
    const next = { ...s, round: s.round + 1 };
    return limitReason(next) ? stop(next, limitReason(next)) : next;
  }
  function runRule(s, rule) {
    if (!Object.hasOwn(rules, rule)) throw new Error("Unknown rule");
    let next = { ...s };
    while (next.phase === "running") {
      if (ruleSatisfied(next, rule)) return stop(next, "Rule threshold reached");
      next = acquire(next);
    }
    return next;
  }
  function reveal(s) { return s.phase === "stopped" ? { ...s, revealed: true } : s; }
  function netValue(predictions, avoidedErrorValue, gainPP, price) {
    const benefit = predictions * avoidedErrorValue * gainPP / 100;
    return { benefit, net: benefit - price, breakevenPP: price / (predictions * avoidedErrorValue) * 100 };
  }
  function wilson(errors, n) {
    if (!(n > 0) || errors < 0 || errors > n) throw new Error("Invalid binomial counts");
    const p = errors / n, z = 1.96, zz = z * z;
    const center = (p + zz / (2 * n)) / (1 + zz / n);
    const half = z * Math.sqrt(p * (1 - p) / n + zz / (4 * n * n)) / (1 + zz / n);
    return { p, lower: Math.max(0, center - half), upper: Math.min(1, center + half) };
  }
  return { scenarios, rules, reading, batchCost, spent, affordableRounds, createState, limitReason, ruleSatisfied, acquire, stop, runRule, reveal, netValue, wilson };
})();
if (typeof module !== "undefined" && module.exports) module.exports = StoppingModel;

if (typeof document !== "undefined") (() => {
  const M = StoppingModel;
  const $ = id => document.getElementById(id);
  const set = (id, text) => { $(id).textContent = text; };
  const pct = value => `${value.toFixed(1)}%`;
  const credits = value => value.toLocaleString("en-US", { maximumFractionDigits: 1 });
  let state = M.createState();
  let inspected = 0;
  const svgText = (x, y, text, extra = "") => `<text x="${x}" y="${y}" fill="#526b6d" font-size="15" ${extra}>${text}</text>`;

  function renderCurve() {
    const visibleRound = state.revealed ? M.affordableRounds(state.mode, state.budget) : state.round;
    const x = r => 58 + r * 54.5, y = e => 252 - e * 4.3;
    let svg = '<title id="learning-title">Validation error over acquisition rounds</title>';
    svg += `<desc id="learning-desc">${state.revealed ? "Continuation revealed" : "Only acquired rounds shown"}. Round ${state.round}, overall error ${pct(M.reading(state.scenario, state.round).overall)}. Use the round inspector for exact group readings.</desc>`;
    for (let value = 0; value <= 50; value += 10) svg += `<path d="M58 ${y(value)}H712" stroke="#dce5db" stroke-dasharray="3 5"/>` + svgText(47, y(value) + 5, `${value}%`, 'text-anchor="end"');
    for (let r = 0; r <= 12; r += 2) svg += svgText(x(r), 278, r, 'text-anchor="middle"');
    svg += svgText(58, 20, "Error ↓ (lower is better)") + svgText(712, 304, "Acquisition round →", 'text-anchor="end"');
    const draw = (start, end, key, color, dashed) => {
      let path = "";
      for (let r = start; r <= end; r++) path += `${r === start ? "M" : "L"}${x(r)} ${y(M.reading(state.scenario, r)[key])} `;
      return `<path d="${path}" fill="none" stroke="${color}" stroke-width="${key === "overall" ? 3.5 : 2}" ${dashed ? 'stroke-dasharray="6 5" opacity=".7"' : ""}/>`;
    };
    for (const [key, color] of [["a", "#376c9b"], ["b", "#b95631"], ["overall", "#146e65"]]) {
      svg += draw(0, state.round, key, color, false);
      if (state.revealed) svg += draw(state.round, visibleRound, key, color, true);
      for (let r = 0; r <= visibleRound; r++) {
        const d = M.reading(state.scenario, r)[key];
        svg += `<circle cx="${x(r)}" cy="${y(d)}" r="${r === inspected ? 5 : 3}" fill="${color}" opacity="${r <= state.round ? 1 : .65}"><title>Round ${r}: ${key === "overall" ? "Overall" : "Group " + key.toUpperCase()} error ${pct(d)}</title></circle>`;
      }
    }
    svg += `<path d="M${x(inspected)} 32V252" stroke="#526b6d" stroke-dasharray="2 5" opacity=".5"/>`;
    if (state.phase === "stopped") {
      const px = x(state.round), tx = Math.min(662, Math.max(99, px));
      svg += `<path d="M${px} 33V252" stroke="#153b40" stroke-dasharray="5 4"/><rect x="${tx - 49}" y="32" width="98" height="25" rx="5" fill="#153b40"/><text x="${tx}" y="49" text-anchor="middle" fill="white" font-size="13">Stopped: ${state.round}</text>`;
    }
    $("learning-chart").innerHTML = svg;
    $("inspect-round").max = visibleRound;
    $("inspect-round").value = inspected;
    $("inspect-round").disabled = visibleRound === 0;
    set("inspect-value", `Round ${inspected}`);
    const d = M.reading(state.scenario, inspected);
    set("inspect-detail", `${inspected > state.round ? "Revealed continuation. " : ""}Round ${inspected}: ${200 + inspected * 50} training labels; overall ${pct(d.overall)}, group A ${pct(d.a)}, group B ${pct(d.b)}. ${credits(M.spent(state.mode, inspected))} credits spent.`);
    $("future-key").hidden = !state.revealed;
  }
  function ruleReading() {
    const rule = $("rule").value, satisfied = M.ruleSatisfied(state, rule);
    let text;
    if (rule === "plateau") {
      if (state.round < 2) text = `Need ${2 - state.round} more observed ${state.round === 0 ? "rounds" : "round"} to evaluate two consecutive gains.`;
      else {
        const recent = [state.round - 1, state.round].map(r => (M.reading(state.scenario, r - 1).overall - M.reading(state.scenario, r).overall).toFixed(2));
        text = `Last two error reductions: ${recent[0]} and ${recent[1]} pp. ${satisfied ? "Both are below 0.5 pp; the rule would stop." : "The two-round plateau condition is not met."}`;
      }
    } else if (rule === "uncertainty") text = `Current proxy: ${M.reading(state.scenario, state.round).uncertainty}/100. ${satisfied ? "At or below 15; the rule would stop. This does not certify accuracy." : "Above 15; the rule would continue if affordable."}`;
    else if (rule === "target") text = `Worst group error: ${pct(Math.max(M.reading(state.scenario, state.round).a, M.reading(state.scenario, state.round).b))}. ${satisfied ? "Both readings meet the 12% target. These synthetic point estimates do not establish a statistical guarantee." : "At least one group remains above 12%."}`;
    else text = "This rule spends until the next complete batch is unaffordable or the pool is exhausted. It has no performance requirement.";
    if (state.phase === "stopped") text += " Your decision is already locked. Restart to acquire more.";
    set("rule-reading", text);
  }
  function renderComparison() {
    const body = $("rule-comparison"); body.replaceChildren();
    for (const [rule, name] of Object.entries(M.rules)) {
      const result = M.runRule(M.createState(state.scenario, state.mode, state.budget), rule);
      const d = M.reading(state.scenario, result.round), row = document.createElement("tr");
      [name, result.round, pct(d.overall), pct(Math.max(d.a, d.b)), credits(M.spent(result.mode, result.round)), result.reason].forEach((value, index) => {
        const cell = document.createElement(index === 0 ? "th" : "td");
        if (index === 0) cell.scope = "row";
        cell.textContent = value; row.appendChild(cell);
      });
      body.appendChild(row);
    }
  }
  function render() {
    const d = M.reading(state.scenario, state.round), cost = M.spent(state.mode, state.round);
    const finished = state.phase === "stopped";
    set("scenario-note", M.scenarios[state.scenario].note);
    set("round-stat", `${state.round} / 12`);
    set("label-stat", (200 + state.round * 50).toLocaleString("en-US"));
    set("error-stat", pct(d.overall));
    set("spend-stat", `${credits(cost)} / ${state.budget}`);
    set("gain-stat", state.round ? `${(M.reading(state.scenario, state.round - 1).overall - d.overall).toFixed(2)} pp` : "Waiting for a batch");
    set("uncertainty-stat", `${d.uncertainty} / 100`);
    set("next-cost", state.round < 12 ? `${credits(M.batchCost(state.mode, state.round + 1))} credits` : "No batch remains");
    set("cost-detail", state.round < 12 ? `40 annotation + ${credits(M.batchCost(state.mode, state.round + 1) - 40)} update. ${credits(state.budget - cost)} credits remain.` : "All 600 pool examples have been acquired.");
    ["acquire", "stop-now", "run-rule"].forEach(id => { $(id).disabled = finished; });
    $("reveal-panel").hidden = !finished;
    $("reveal").disabled = !finished || state.revealed;
    $("hindsight").hidden = !state.revealed;
    if (finished) {
      set("decision-title", `Stopped at round ${state.round}.`);
      set("decision-summary", `${state.reason}. You acquired ${state.round * 50} additional labels and spent ${credits(cost)} credits. Overall error is ${pct(d.overall)}; the worst group is at ${pct(Math.max(d.a, d.b))}. ${Math.max(d.a, d.b) > 12 ? "The 12% group target remains unmet." : "Both synthetic group readings are within the 12% target."}`);
      set("decision-status", `${state.reason}. Acquisition is locked. You can now reveal the affordable continuation or restart.`);
    } else set("decision-status", `Round ${state.round}. ${state.round ? "One complete batch was acquired per round." : "No additional labels acquired."} You may stop now or acquire another 50 labels.`);
    if (state.revealed) {
      const end = M.affordableRounds(state.mode, state.budget), last = M.reading(state.scenario, end);
      const extraCost = M.spent(state.mode, end) - cost;
      set("hindsight-summary", end === state.round ? "There are no additional affordable rounds to reveal. A resource or pool limit can end acquisition while a performance target remains unmet." : `Continuing to round ${end} would have used ${credits(extraCost)} more credits for ${50 * (end - state.round)} more labels in this toy trace. Overall error falls by ${(d.overall - last.overall).toFixed(2)} pp to ${pct(last.overall)}; the worst group ends at ${pct(Math.max(last.a, last.b))}. This reveals the consequences, not a universally correct stopping round.`);
      renderComparison();
    }
    ruleReading(); renderCurve();
    document.dispatchEvent(new CustomEvent("stopping:change", { detail: { ...state } }));
  }
  function restart() {
    state = M.createState($("scenario").value, $("update-mode").value, Number($("budget").value));
    inspected = 0; render();
  }
  ["scenario", "update-mode", "budget"].forEach(id => $(id).addEventListener("change", restart));
  $("rule").addEventListener("change", ruleReading);
  $("acquire").addEventListener("click", () => { state = M.acquire(state); inspected = state.round; render(); });
  $("stop-now").addEventListener("click", () => { state = M.stop(state); render(); });
  $("run-rule").addEventListener("click", () => { state = M.runRule(state, $("rule").value); inspected = state.round; render(); });
  $("reset-lab").addEventListener("click", restart);
  $("reveal").addEventListener("click", () => { state = M.reveal(state); render(); });
  $("inspect-round").addEventListener("input", () => { inspected = Number($("inspect-round").value); renderCurve(); });

  function renderValue() {
    const n = Number($("future-count").value), c = Number($("error-cost").value), gain = Number($("expected-gain").value), price = Number($("batch-price").value);
    const v = M.netValue(n, c, gain, price);
    set("future-count-value", credits(n)); set("error-cost-value", `${c} credits`); set("expected-gain-value", `${gain.toFixed(2)} pp`); set("batch-price-value", `${price} credits`);
    set("net-value", `${v.net < 0 ? "−" : v.net > 0 ? "+" : ""}${credits(Math.abs(v.net))} credits`);
    set("benefit-value", credits(v.benefit)); set("price-value", credits(price));
    const max = Math.max(v.benefit, price);
    $("benefit-bar").style.width = `${v.benefit / max * 100}%`; $("price-bar").style.width = `${price / max * 100}%`;
    set("value-verdict", v.net > 1e-8 ? "Under your assumptions, the expected benefit exceeds the batch cost." : v.net < -1e-8 ? "Under your assumptions, the expected benefit does not cover the batch cost." : "Expected benefit equals cost. The model gives no strict preference for another batch.");
    set("breakeven", `Break-even error reduction: ${v.breakevenPP.toFixed(2)} percentage points.`);
  }
  ["future-count", "error-cost", "expected-gain", "batch-price"].forEach(id => $(id).addEventListener("input", renderValue));
  $("reset-value").addEventListener("click", () => { $("future-count").value = 10000; $("error-cost").value = 2; $("expected-gain").value = .5; $("batch-price").value = 200; renderValue(); });

  function renderEvidence() {
    const n = Number($("sample-size").value), requested = Number($("observed-rate").value), target = Number($("error-target").value);
    const k = Math.round(n * requested / 100), w = M.wilson(k, n);
    set("observed-rate-value", `${requested}%`); set("error-target-value", `${target}%`);
    set("interval-value", `${k} errors in ${n.toLocaleString("en-US")} examples: ${(100 * w.p).toFixed(2)}% observed error.`);
    const verdict = 100 * w.upper <= target ? `The upper endpoint is below the ${target}% target in this fixed-sample illustration.` : 100 * w.lower > target ? `The entire interval is above the ${target}% target.` : `The interval crosses the ${target}% target; the displayed range does not sit entirely below it.`;
    set("interval-reading", `95% Wilson interval: ${(100 * w.lower).toFixed(2)}% to ${(100 * w.upper).toFixed(2)}%. ${verdict} This is not a sequential stopping guarantee.`);
    const x = value => 60 + value / 40 * 635;
    let svg = `<title id="evidence-title">Observed error and a 95% Wilson interval</title><desc id="evidence-desc">${k} errors among ${n} examples. Observed error ${(100 * w.p).toFixed(2)} percent. Interval ${(100 * w.lower).toFixed(2)} to ${(100 * w.upper).toFixed(2)} percent. Target ${target} percent.</desc>`;
    svg += `<rect x="60" y="45" width="${x(target) - 60}" height="62" fill="#e3f0e6"/><path d="M60 126H695" stroke="#adbfb4"/>`;
    for (let v = 0; v <= 40; v += 5) svg += svgText(x(v), 151, `${v}%`, 'text-anchor="middle"') + `<path d="M${x(v)} 121v10" stroke="#adbfb4"/>`;
    const lo = x(w.lower * 100), hi = x(w.upper * 100), p = x(w.p * 100);
    svg += `<path d="M${x(target)} 32V121" stroke="#b95631" stroke-width="2" stroke-dasharray="5 4"/>` + svgText(x(target), 21, `Target ${target}%`, 'text-anchor="middle"');
    svg += `<path d="M${lo} 77H${hi}M${lo} 67V87M${hi} 67V87" stroke="#146e65" stroke-width="4"/><circle cx="${p}" cy="77" r="7" fill="#153b40"/>`;
    svg += svgText(695, 175, "Error rate → (fixed 0–40% axis)", 'text-anchor="end"');
    $("evidence-chart").innerHTML = svg;
  }
  $("sample-size").addEventListener("change", renderEvidence);
  ["observed-rate", "error-target"].forEach(id => $(id).addEventListener("input", renderEvidence));
  $("reset-evidence").addEventListener("click", () => { $("sample-size").value = 200; $("observed-rate").value = 6; $("error-target").value = 8; renderEvidence(); });
  function progress() {
    const root = document.documentElement, available = root.scrollHeight - root.clientHeight;
    $("reading-progress").style.width = `${available > 0 ? Math.min(100, Math.max(0, root.scrollTop / available * 100)) : 0}%`;
  }
  document.addEventListener("scroll", progress, { passive: true });
  window.addEventListener("resize", progress);
  document.querySelectorAll(".stop-lab button,.stop-lab select,.value-lab button,.value-lab input,.evidence-lab button,.evidence-lab select,.evidence-lab input").forEach(el => { el.disabled = false; });
  render(); renderValue(); renderEvidence(); progress();
})();
