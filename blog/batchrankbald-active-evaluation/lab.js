const discrimination = document.querySelector("#discrimination");
const difficulty = document.querySelector("#difficulty");
const historySelect = document.querySelector("#history");
const metricSelect = document.querySelector("#metric");
const budgetSelect = document.querySelector("#budget");

const states = [0, 2].flatMap(a => [-1, 1].map(b => ({a, b, order: Number(a > b)})));
const outcomes = [[0, 0], [0, 1], [1, 0], [1, 1]];
const prior = states.map(() => 1 / states.length);

function responseProbabilities(itemDifficulty, slope) {
  return states.map(({a, b}) => {
    const pa = 1 / (1 + Math.exp(-slope * (a - itemDifficulty)));
    const pb = 1 / (1 + Math.exp(-slope * (b - itemDifficulty)));
    return outcomes.map(([ua, ub]) => (ua ? pa : 1 - pa) * (ub ? pb : 1 - pb));
  });
}

function information(weights, responses) {
  const joint = [outcomes.map(() => 0), outcomes.map(() => 0)];
  states.forEach(({order}, state) => {
    responses[state].forEach((probability, outcome) => {
      joint[order][outcome] += weights[state] * probability;
    });
  });
  const orderMarginal = joint.map(row => row.reduce((sum, probability) => sum + probability, 0));
  const responseMarginal = outcomes.map((_, index) => joint[0][index] + joint[1][index]);
  return joint.reduce((sum, row, order) => sum + row.reduce((subtotal, p, outcome) => {
    return p > 0 ? subtotal + p * Math.log2(p / (orderMarginal[order] * responseMarginal[outcome])) : subtotal;
  }, 0), 0);
}

function updatePosterior(responses, history) {
  const weighted = prior.map((mass, state) => mass * responses[state][history]);
  const probability = weighted.reduce((sum, mass) => sum + mass, 0);
  return {probability, weights: weighted.map(mass => mass / probability)};
}

function drawBars(container, rows, maximum, format) {
  container.replaceChildren(...rows.map(({label, value, highlight}) => {
    const row = document.createElement("div");
    row.className = "batch-bar-row";
    const name = document.createElement("span");
    name.textContent = label;
    const track = document.createElement("span");
    track.className = "batch-bar-track";
    track.setAttribute("aria-hidden", "true");
    const bar = document.createElement("span");
    bar.className = highlight ? "batch-bar batch-bar-highlight" : "batch-bar";
    bar.style.width = 100 * Math.max(0, value) / maximum + "%";
    track.append(bar);
    const number = document.createElement("strong");
    number.textContent = format(value);
    row.append(name, track, number);
    return row;
  }));
}

function renderInformation() {
  const slope = Number(discrimination.value);
  const itemDifficulty = Number(difficulty.value);
  const first = responseProbabilities(-0.5, slope);
  const second = responseProbabilities(itemDifficulty, slope);
  const standalone = information(prior, second);
  const histories = outcomes.map((_, index) => {
    const posterior = updatePosterior(first, index);
    return {...posterior, gain: information(posterior.weights, second)};
  });
  const conditional = histories.reduce((sum, {probability, gain}) => sum + probability * gain, 0);
  const difference = conditional - standalone;

  document.querySelector("#discrimination-value").textContent = slope;
  document.querySelector("#difficulty-value").textContent = itemDifficulty.toFixed(1);
  drawBars(document.querySelector("#information-chart"), [
    {label: "Item j alone", value: standalone},
    {label: "Item j after i, averaged", value: conditional, highlight: true}
  ], 1, value => value.toFixed(6));
  const interaction = Math.abs(difference) < 0.0000005 ? "No measurable change" : difference > 0 ? "Synergy" : "Redundancy";
  const sign = difference >= 0 ? "+" : "−";
  document.querySelector("#batch-feedback").textContent =
    interaction + " · " + sign + Math.abs(difference).toFixed(6) + " bits after conditioning (averaged over item i responses).";

  const {probability, gain, weights} = histories[Number(historySelect.value)];
  const ordering = weights.reduce((sum, mass, state) => sum + mass * states[state].order, 0);
  document.querySelector("#history-feedback").textContent =
    "This history occurs with probability " + (100 * probability).toFixed(3) +
    "%. It moves P(A outranks B) from 75% to " + (100 * ordering).toFixed(3) +
    "%. Item j adds " + gain.toFixed(6) + " bits in this branch.";
  drawBars(document.querySelector("#posterior-chart"), [
    {label: "Prior P(A outranks B)", value: 0.75},
    {label: "Posterior given this response", value: ordering, highlight: true}
  ], 1, value => (100 * value).toFixed(2) + "%");
}

const methods = ["Random batch", "Top‑n RankBALD", "Sequential RankBALD", "BatchRankBALD"];
const budgets = [10, 50, 100, 500];
const results = {
  distance: {
    max: 90, digits: 1, direction: "Lower is better",
    values: [[66.2, 45.8, 42.1, 36.6], [84.4, 39.3, 36.5, 35.5], [35.3, 29.1, 24.2, 22.5], [30.4, 27.1, 21.1, 18.9]],
    description: "Absolute rank difference from full evaluation on a second capability-matched benchmark."
  },
  variation: {
    max: 40, digits: 1, direction: "Lower is better",
    values: [[38.4, 27.9, 15.4, 23.6], [15.4, 11.0, 9.0, 6.9], [12.4, 6.1, 5.8, 4.0], [11.7, 4.9, 3.7, 2.1]],
    description: "Step-to-step variation in measured performance across training checkpoints, normalized by the endpoint change."
  },
  correlation: {
    max: 1, digits: 3, direction: "Higher indicates less saturation",
    values: [[0.382, 0.634, 0.691, 0.825], [0.584, 0.816, 0.844, 0.876], [0.728, 0.849, 0.861, 0.877], [0.750, 0.851, 0.877, 0.886]],
    description: "Absolute Spearman correlation between checkpoint order and measured performance."
  }
};

function renderResults() {
  const budgetIndex = Number(budgetSelect.value);
  const metric = results[metricSelect.value];
  const rows = methods.map((label, index) => ({
    label,
    value: metric.values[index][budgetIndex],
    highlight: index === methods.length - 1
  }));
  drawBars(document.querySelector("#results-chart"), rows, metric.max, value => value.toFixed(metric.digits));
  document.querySelector("#metric-note").textContent = budgets[budgetIndex] + " items per benchmark. " +
    metric.direction + ". Bars use a fixed 0–" + metric.max + " scale for this metric. " + metric.description;
}

[discrimination, difficulty].forEach(control => control.addEventListener("input", renderInformation));
historySelect.addEventListener("change", renderInformation);
document.querySelectorAll("[data-difficulty]").forEach(button => {
  button.addEventListener("click", () => {
    discrimination.value = "10";
    difficulty.value = button.dataset.difficulty;
    historySelect.value = "3";
    renderInformation();
  });
});
[metricSelect, budgetSelect].forEach(control => control.addEventListener("change", renderResults));

renderInformation();
renderResults();

const builderBudget = document.querySelector("#builder-budget");
const builderItems = document.querySelector("#builder-items");
const builderStatus = document.querySelector("#builder-status");
const builderPairs = ["A vs. B", "C vs. D", "E vs. F", "G vs. H", "I vs. J"];
const builderQuestions = [
  [0, .95], [0, .92], [0, .88], [1, .84], [0, .82],
  [1, .79], [2, .75], [0, .72], [1, .69], [2, .64],
  [3, .59], [4, .54], [2, .48], [3, .42], [4, .36]
];
let builderSelection = [];
const builderFormat = value => (100 * value).toFixed(1);

function remainingEvidence(selection) {
  const remaining = builderPairs.map(() => 1);
  selection.forEach(index => {
    const [pair, coverage] = builderQuestions[index];
    remaining[pair] *= 1 - coverage;
  });
  return remaining;
}

const builderCards = builderQuestions.map(([pair, coverage], index) => {
  const button = document.createElement("button");
  button.type = "button";
  const title = document.createElement("strong");
  title.textContent = "Question " + (index + 1) + " · " + builderPairs[pair];
  const detail = document.createElement("span");
  button.append(title, detail);
  button.addEventListener("click", () => {
    if (builderSelection.includes(index)) {
      builderSelection = builderSelection.filter(question => question !== index);
    } else if (builderSelection.length < Number(builderBudget.value)) {
      builderSelection.push(index);
    } else {
      builderStatus.textContent = "Batch full. Deselect a question or increase the batch size.";
      return;
    }
    renderBuilder();
  });
  builderItems.append(button);
  return {button, detail, pair, coverage};
});

function renderBuilder() {
  const remaining = remainingEvidence(builderSelection);
  builderCards.forEach(({button, detail, pair, coverage}, index) => {
    const slot = builderSelection.indexOf(index);
    button.setAttribute("aria-pressed", String(slot >= 0));
    detail.textContent = slot >= 0
      ? builderFormat(coverage) + "% alone · selected #" + (slot + 1)
      : builderFormat(coverage) + "% alone · +" + builderFormat(coverage * remaining[pair]) + " points";
  });
  const rows = builderPairs.map((label, pair) => ({
    label, value: 1 - remaining[pair], highlight: true
  }));
  drawBars(document.querySelector("#builder-chart"), rows, 1, value => builderFormat(value) + "%");
  const average = rows.reduce((sum, row) => sum + row.value, 0) / rows.length;
  builderStatus.textContent = builderSelection.length + " of " + builderBudget.value +
    " selected · " + builderFormat(average) + "% mean coverage across five comparisons.";
}

builderBudget.addEventListener("change", () => {
  builderSelection = builderSelection.slice(0, Number(builderBudget.value));
  renderBuilder();
});

document.querySelector("#builder-top").addEventListener("click", () => {
  builderSelection = builderQuestions.map((_, index) => index)
    .sort((left, right) => builderQuestions[right][1] - builderQuestions[left][1])
    .slice(0, Number(builderBudget.value));
  renderBuilder();
});

document.querySelector("#builder-greedy").addEventListener("click", () => {
  builderSelection = [];
  while (builderSelection.length < Number(builderBudget.value)) {
    const remaining = remainingEvidence(builderSelection);
    let best = -1;
    let bestGain = -1;
    builderQuestions.forEach(([pair, coverage], index) => {
      const gain = coverage * remaining[pair];
      if (!builderSelection.includes(index) && gain > bestGain) {
        best = index;
        bestGain = gain;
      }
    });
    builderSelection.push(best);
  }
  renderBuilder();
});

document.querySelector("#builder-clear").addEventListener("click", () => {
  builderSelection = [];
  renderBuilder();
});

renderBuilder();
