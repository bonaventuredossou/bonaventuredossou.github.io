(function () {
  "use strict";

  const byId = (id) =>
    document.getElementById(id);

  function initReadingProgress() {
    const bar =
      byId("reading-progress-bar");

    if (!bar) {
      return;
    }

    const update = () => {
      const root =
        document.documentElement;

      const available =
        root.scrollHeight -
        root.clientHeight;

      const progress =
        available > 0
          ? root.scrollTop / available
          : 0;

      bar.style.width =
        `${Math.min(
          100,
          Math.max(
            0,
            progress * 100
          )
        )}%`;
    };

    document.addEventListener(
      "scroll",
      update,
      { passive: true }
    );

    update();
  }

  function initEntropyExplorer() {
    const slider =
      byId("probability-slider");

    if (!slider) {
      return;
    }

    const barA =
      byId("probability-a");

    const barB =
      byId("probability-b");

    const labelA =
      byId("probability-a-label");

    const labelB =
      byId("probability-b-label");

    const value =
      byId("entropy-value");

    const meter =
      byId("entropy-meter-fill");

    const update = () => {
      const p =
        Number(slider.value) /
        100;

      const q =
        1 - p;

      const entropy =
        -(
          p * Math.log(p) +
          q * Math.log(q)
        );

      const normalized =
        entropy / Math.log(2);

      barA.style.width =
        `${p * 100}%`;

      barB.style.width =
        `${q * 100}%`;

      labelA.textContent =
        `Class A: ${
          Math.round(p * 100)
        }%`;

      labelB.textContent =
        `Class B: ${
          Math.round(q * 100)
        }%`;

      value.textContent =
        `${entropy.toFixed(3)} nats`;

      meter.style.width =
        `${normalized * 100}%`;
    };

    slider.addEventListener(
      "input",
      update
    );

    update();
  }

  function initMCDropout() {
    const container =
      byId("model-votes");

    if (!container) {
      return;
    }

    const buttons =
      document.querySelectorAll(
        "[data-uncertainty]"
      );

    const meanLabel =
      byId("mc-mean");

    const disagreementLabel =
      byId("mc-disagreement");

    const explanation =
      byId("mc-explanation");

    const cases = {
      aleatoric: {
        values: [
          46,
          52,
          48,
          54,
          49,
          51,
          47,
          53,
          50,
          50
        ],
        disagreement: "Low",
        explanation:
          "Every plausible model is individually unsure. More labels may not remove uncertainty inherent in the example."
      },

      epistemic: {
        values: [
          8,
          91,
          14,
          87,
          6,
          94,
          12,
          89,
          9,
          90
        ],
        disagreement: "High",
        explanation:
          "The models are individually confident but split on the answer. This is the disagreement active learning can exploit."
      }
    };

    function render(type) {
      const current =
        cases[type];

      container.textContent = "";

      current.values.forEach(
        (probability, index) => {
          const vote =
            document.createElement(
              "div"
            );

          vote.className =
            "model-vote";

          vote.style.setProperty(
            "--probability",
            `${probability}%`
          );

          vote.title =
            `Pass ${index + 1}: ` +
            `${probability}% Class A`;

          container.appendChild(vote);
        }
      );

      const mean =
        current.values.reduce(
          (sum, item) =>
            sum + item,
          0
        ) /
        current.values.length;

      meanLabel.textContent =
        `${Math.round(mean)} / ` +
        `${Math.round(100 - mean)}`;

      disagreementLabel.textContent =
        current.disagreement;

      explanation.textContent =
        current.explanation;

      buttons.forEach((button) => {
        button.classList.toggle(
          "active",
          button.dataset.uncertainty ===
            type
        );
      });
    }

    buttons.forEach((button) => {
      button.addEventListener(
        "click",
        () => {
          render(
            button.dataset.uncertainty
          );
        }
      );
    });

    render("aleatoric");
  }

  function initFinetuningDemo() {
    const slider =
      byId("round-slider");

    if (!slider) {
      return;
    }

    const roundValue =
      byId("round-value");

    const faCurrent =
      byId("fa-current");

    const faCumulative =
      byId("fa-cumulative");

    const cfCumulative =
      byId("cf-cumulative");

    const faBatches =
      byId("fa-batches");

    const cfBatches =
      byId("cf-batches");

    function toSubscript(number) {
      const digits = {
        "0": "₀",
        "1": "₁",
        "2": "₂",
        "3": "₃",
        "4": "₄",
        "5": "₅",
        "6": "₆",
        "7": "₇",
        "8": "₈",
        "9": "₉"
      };

      return String(number)
        .split("")
        .map(
          (digit) =>
            digits[digit]
        )
        .join("");
    }

    function createBlock(
      label,
      className,
      description
    ) {
      const node =
        document.createElement(
          "span"
        );

      node.className =
        className
          ? `batch-block ${className}`
          : "batch-block";

      node.textContent =
        label;

      node.title =
        description;

      return node;
    }

    function update() {
      const round =
        Number(slider.value);

      const currentFA =
        500 + round * 100;

      const cumulativeFA =
        500 * round +
        50 * round *
        (round + 1);

      const cumulativeCF =
        100 * round;

      roundValue.textContent =
        round;

      faCurrent.textContent =
        `${currentFA.toLocaleString()} ` +
        "examples this round";

      faCumulative.textContent =
        cumulativeFA.toLocaleString();

      cfCumulative.textContent =
        cumulativeCF.toLocaleString();

      faBatches.textContent = "";

      faBatches.appendChild(
        createBlock(
          "D₀ = 500",
          "seed",
          "Initial labeled dataset containing 500 examples"
        )
      );

      for (
        let index = 1;
        index <= round;
        index += 1
      ) {
        faBatches.appendChild(
          createBlock(
            `Q′${toSubscript(
              index
            )} = 100`,
            "query-batch",
            `Acquisition batch from round ${index}, containing 100 examples`
          )
        );
      }

      cfBatches.textContent = "";

      cfBatches.appendChild(
        createBlock(
          `Q′${toSubscript(
            round
          )} = 100`,
          "query-batch",
          `Most recently acquired batch from round ${round}, containing 100 examples`
        )
      );
    }

    slider.addEventListener(
      "input",
      update
    );

    update();
  }

  function initSavingsExplorer() {
    const root =
      byId("savings-explorer");

    if (!root) {
      return;
    }

    const data = {
      masakha: {
        memory: 33.56,
        flops: 33.78,
        time: 34.83
      },

      sib: {
        memory: 31.76,
        flops: 34.08,
        time: 37.08
      }
    };

    const buttons =
      root.querySelectorAll(
        "[data-dataset]"
      );

    function render(dataset) {
      Object.entries(
        data[dataset]
      ).forEach(
        ([key, number]) => {
          const bar =
            root.querySelector(
              `[data-saving="${key}"]`
            );

          const label =
            root.querySelector(
              `[data-saving-value="${key}"]`
            );

          bar.style.width =
            `${number}%`;

          label.textContent =
            `${number.toFixed(2)}%`;
        }
      );

      buttons.forEach((button) => {
        button.classList.toggle(
          "active",
          button.dataset.dataset ===
            dataset
        );
      });
    }

    buttons.forEach((button) => {
      button.addEventListener(
        "click",
        () => {
          render(
            button.dataset.dataset
          );
        }
      );
    });

    render("masakha");
  }

  function initLanguageExplorer() {
    const select =
      byId("language-select");

    if (!select) {
      return;
    }

    const languages = {
      yoruba: {
        code: "YOR",
        name: "Yoruba",
        family:
          "Niger-Congo, Defoid",
        pretrained: "Yes",
        outcome: "Strong",
        tone: "positive",
        note:
          "CF consistently benefits Yoruba, combining strong initial representations with informative updates. Random acquisition, however, sharply weakens the result."
      },

      swahili: {
        code: "SWA",
        name: "Swahili",
        family:
          "Niger-Congo, Bantu",
        pretrained: "Yes",
        outcome: "Strong",
        tone: "positive",
        note:
          "Swahili is represented in pretraining and generally supports stable continual updates. In some later rounds, FA can also be affected by noisy or repetitive acquisitions."
      },

      xhosa: {
        code: "XHO",
        name: "Xhosa",
        family:
          "Niger-Congo, Bantu",
        pretrained: "Yes",
        outcome: "Strong",
        tone: "positive",
        note:
          "Xhosa combines pretraining coverage with strong Bantu representations. CF remains competitive, while random acquisition causes a clear degradation."
      },

      luganda: {
        code: "LUG",
        name: "Luganda",
        family:
          "Niger-Congo, Bantu",
        pretrained: "No",
        outcome: "Promising",
        tone: "positive",
        note:
          "Although not explicitly included in pretraining, Luganda benefits from proximity to pretrained Bantu languages such as Zulu and Xhosa."
      },

      tswana: {
        code: "TSN",
        name: "Tswana",
        family:
          "Niger-Congo, Bantu",
        pretrained: "No",
        outcome: "Promising",
        tone: "positive",
        note:
          "Tswana illustrates that exact pretraining coverage is not always required. Related linguistic structure can support effective targeted updates."
      },

      amharic: {
        code: "AMH",
        name: "Amharic",
        family:
          "Afro-Asiatic, Semitic, Ge'ez script",
        pretrained:
          "Limited alignment",
        outcome:
          "FA often safer",
        tone: "cautious",
        note:
          "Amharic shows greater volatility. Distinctive script and morphosyntax, together with weak alignment, can make accumulated full finetuning more robust."
      },

      tigrinya: {
        code: "TIR",
        name: "Tigrinya",
        family:
          "Afro-Asiatic, Semitic, Ge'ez script",
        pretrained:
          "Limited alignment",
        outcome:
          "FA often safer",
        tone: "cautious",
        note:
          "Tigrinya is a case where targeted batches may not provide enough structural adaptation. Revisiting accumulated labels can be valuable."
      },

      fon: {
        code: "FON",
        name: "Fon",
        family:
          "Niger-Congo, Gbe",
        pretrained: "No",
        outcome: "Mixed",
        tone: "mixed",
        note:
          "Fon shows erratic behavior across settings. Family membership alone is insufficient: lexical overlap, data quality, and actual pretraining exposure also matter."
      },

      ewe: {
        code: "EWE",
        name: "Ewe",
        family:
          "Niger-Congo, Gbe",
        pretrained: "No",
        outcome: "Mixed",
        tone: "mixed",
        note:
          "Ewe reinforces the need for caution when generalizing from typology. Limited resource quality and weak alignment can make continual updates unstable."
      }
    };

    function update() {
      const item =
        languages[select.value];

      byId(
        "language-code"
      ).textContent =
        item.code;

      byId(
        "language-name"
      ).textContent =
        item.name;

      byId(
        "language-family"
      ).textContent =
        item.family;

      byId(
        "language-pretrained"
      ).textContent =
        item.pretrained;

      const outcome =
        byId("language-outcome");

      outcome.textContent =
        item.outcome;

      outcome.className =
        item.tone;

      byId(
        "language-note"
      ).textContent =
        item.note;
    }

    select.addEventListener(
      "change",
      update
    );

    update();
  }

  function initActiveLearningPlayground() {
    const canvas =
      byId("al-canvas");

    if (!canvas) {
      return;
    }

    const context =
      canvas.getContext("2d");

    const width =
      canvas.width;

    const height =
      canvas.height;

    const padding = 28;
    const points = [];

    const acquireButton =
      byId("al-acquire");

    const batchSize = 4;

    let labeled =
      new Set();

    let weights =
      [0, 0, 0];

    let queryIndices = [];
    let acquisitionRound = 0;
    let randomState = 971;

    function seededRandom() {
      randomState =
        (
          randomState *
          48271
        ) %
        2147483647;

      return (
        randomState - 1
      ) /
      2147483646;
    }

    function gaussian() {
      const u =
        Math.max(
          seededRandom(),
          1e-8
        );

      const v =
        seededRandom();

      return (
        Math.sqrt(
          -2 *
          Math.log(u)
        ) *
        Math.cos(
          2 *
          Math.PI *
          v
        )
      );
    }

    function createData() {
      points.length = 0;
      randomState = 4321;

      for (
        let index = 0;
        index < 160;
        index += 1
      ) {
        const x =
          -1.12 +
          seededRandom() *
          2.24;

        const y =
          -0.95 +
          seededRandom() *
          1.9;

        const latent =
          y -
          (
            0.68 * x -
            0.06
          ) +
          0.12 *
          Math.sin(4 * x) +
          gaussian() *
          0.08;

        points.push({
          x,
          y,
          label:
            latent > 0
              ? 1
              : 0
        });
      }
    }

    function initialLabels() {
      labeled =
        new Set();

      [0, 1].forEach(
        (label) => {
          points
            .map(
              (
                point,
                index
              ) => ({
                ...point,
                index,
                certainty:
                  Math.abs(
                    point.y -
                    (
                      0.68 *
                      point.x -
                      0.06
                    )
                  )
              })
            )
            .filter(
              (point) =>
                point.label ===
                label
            )
            .sort(
              (a, b) =>
                b.certainty -
                a.certainty
            )
            .slice(0, 4)
            .forEach(
              (point) => {
                labeled.add(
                  point.index
                );
              }
            );
        }
      );
    }

    const sigmoid = (value) =>
      1 /
      (
        1 +
        Math.exp(
          -Math.max(
            -20,
            Math.min(
              20,
              value
            )
          )
        )
      );

    const predict = (point) =>
      sigmoid(
        weights[0] +
        weights[1] *
        point.x +
        weights[2] *
        point.y
      );

    function train() {
      weights =
        [0, 0, 0];

      const ids =
        Array.from(labeled);

      for (
        let step = 0;
        step < 900;
        step += 1
      ) {
        const gradient =
          [0, 0, 0];

        ids.forEach((index) => {
          const point =
            points[index];

          const error =
            predict(point) -
            point.label;

          gradient[0] +=
            error;

          gradient[1] +=
            error *
            point.x;

          gradient[2] +=
            error *
            point.y;
        });

        const rate =
          0.6 /
          Math.sqrt(
            1 +
            step / 120
          );

        weights[0] -=
          rate *
          gradient[0] /
          ids.length;

        weights[1] -=
          rate *
          (
            gradient[1] /
            ids.length +
            0.012 *
            weights[1]
          );

        weights[2] -=
          rate *
          (
            gradient[2] /
            ids.length +
            0.012 *
            weights[2]
          );
      }
    }

    function strategy() {
      const selected =
        document.querySelector(
          'input[name="strategy"]:checked'
        );

      return selected.value;
    }

    function chooseQueries() {
      const candidates =
        points
          .map(
            (
              point,
              index
            ) => ({
              point,
              index
            })
          )
          .filter(
            (item) =>
              !labeled.has(
                item.index
              )
          );

      if (
        strategy() ===
        "uncertainty"
      ) {
        candidates.sort(
          (a, b) =>
            Math.abs(
              predict(
                a.point
              ) -
              0.5
            ) -
            Math.abs(
              predict(
                b.point
              ) -
              0.5
            )
        );
      } else {
        candidates.sort(
          (a, b) => {
            const scoreA =
              (
                (
                  a.index + 19
                ) *
                (
                  acquisitionRound +
                  7
                ) *
                7919
              ) %
              104729;

            const scoreB =
              (
                (
                  b.index + 19
                ) *
                (
                  acquisitionRound +
                  7
                ) *
                7919
              ) %
              104729;

            return (
              scoreA -
              scoreB
            );
          }
        );
      }

      queryIndices =
        candidates
          .slice(
            0,
            batchSize
          )
          .map(
            (item) =>
              item.index
          );
    }

    function coordinates(point) {
      return {
        x:
          padding +
          (
            (
              point.x +
              1.2
            ) /
            2.4
          ) *
          (
            width -
            padding * 2
          ),

        y:
          height -
          padding -
          (
            (
              point.y +
              1.05
            ) /
            2.1
          ) *
          (
            height -
            padding * 2
          )
      };
    }

    function draw() {
      context.clearRect(
        0,
        0,
        width,
        height
      );

      context.fillStyle =
        "#f6f8f4";

      context.fillRect(
        0,
        0,
        width,
        height
      );

      const cell = 22;

      for (
        let pixelX = padding;
        pixelX <
        width - padding;
        pixelX += cell
      ) {
        for (
          let pixelY = padding;
          pixelY <
          height - padding;
          pixelY += cell
        ) {
          const x =
            (
              (
                pixelX -
                padding
              ) /
              (
                width -
                padding * 2
              )
            ) *
            2.4 -
            1.2;

          const y =
            (
              (
                height -
                padding -
                pixelY
              ) /
              (
                height -
                padding * 2
              )
            ) *
            2.1 -
            1.05;

          const probability =
            sigmoid(
              weights[0] +
              weights[1] *
              x +
              weights[2] *
              y
            );

          if (
            probability >
            0.5
          ) {
            context.fillStyle =
              `rgba(55,108,155,${
                0.035 +
                Math.abs(
                  probability -
                  0.5
                ) *
                0.10
              })`;
          } else {
            context.fillStyle =
              `rgba(216,111,94,${
                0.035 +
                Math.abs(
                  probability -
                  0.5
                ) *
                0.10
              })`;
          }

          context.fillRect(
            pixelX,
            pixelY,
            cell,
            cell
          );
        }
      }

      context.strokeStyle =
        "rgba(16,40,50,.10)";

      context.lineWidth = 1;

      for (
        let index = 0;
        index <= 6;
        index += 1
      ) {
        const x =
          padding +
          index *
          (
            width -
            2 * padding
          ) /
          6;

        context.beginPath();

        context.moveTo(
          x,
          padding
        );

        context.lineTo(
          x,
          height - padding
        );

        context.stroke();
      }

      for (
        let index = 0;
        index <= 4;
        index += 1
      ) {
        const y =
          padding +
          index *
          (
            height -
            2 * padding
          ) /
          4;

        context.beginPath();

        context.moveTo(
          padding,
          y
        );

        context.lineTo(
          width - padding,
          y
        );

        context.stroke();
      }

      if (
        Math.abs(
          weights[2]
        ) >
        0.001
      ) {
        const leftPoint = {
          x: -1.2,
          y:
            -(
              weights[0] +
              weights[1] *
              -1.2
            ) /
            weights[2]
        };

        const rightPoint = {
          x: 1.2,
          y:
            -(
              weights[0] +
              weights[1] *
              1.2
            ) /
            weights[2]
        };

        const left =
          coordinates(
            leftPoint
          );

        const right =
          coordinates(
            rightPoint
          );

        context.strokeStyle =
          "#102832";

        context.lineWidth = 3;

        context.beginPath();

        context.moveTo(
          left.x,
          left.y
        );

        context.lineTo(
          right.x,
          right.y
        );

        context.stroke();
      }

      points.forEach(
        (
          point,
          index
        ) => {
          const position =
            coordinates(point);

          const isLabeled =
            labeled.has(index);

          context.beginPath();

          context.arc(
            position.x,
            position.y,
            isLabeled
              ? 6.5
              : 3.5,
            0,
            Math.PI * 2
          );

          if (isLabeled) {
            context.fillStyle =
              point.label
                ? "#376c9b"
                : "#d86f5e";
          } else {
            context.fillStyle =
              "rgba(16,40,50,.26)";
          }

          context.fill();

          if (isLabeled) {
            context.strokeStyle =
              "#ffffff";

            context.lineWidth = 2;
            context.stroke();
          }
        }
      );

      queryIndices.forEach(
        (index) => {
          const position =
            coordinates(
              points[index]
            );

          context.beginPath();

          context.arc(
            position.x,
            position.y,
            10,
            0,
            Math.PI * 2
          );

          context.strokeStyle =
            "#c99a42";

          context.lineWidth = 3;
          context.stroke();
        }
      );

      let correct = 0;

      points.forEach((point) => {
        const predicted =
          predict(point) >= 0.5
            ? 1
            : 0;

        if (
          predicted ===
          point.label
        ) {
          correct += 1;
        }
      });

      byId(
        "al-labeled"
      ).textContent =
        labeled.size;

      byId(
        "al-accuracy"
      ).textContent =
        `${Math.round(
          correct /
          points.length *
          100
        )}%`;

      if (
        queryIndices.length ===
        0
      ) {
        acquireButton.disabled =
          true;

        acquireButton.textContent =
          "Pool exhausted";

        byId(
          "al-note"
        ).textContent =
          "All 160 pool items have now been labeled. Reset the simulation or choose another strategy to compare from the same starting point.";

        return;
      }

      acquireButton.disabled =
        false;

      acquireButton.textContent =
        `Acquire next batch of ${
          queryIndices.length
        }`;

      const nextRound =
        acquisitionRound + 1;

      if (
        strategy() ===
        "uncertainty"
      ) {
        byId(
          "al-note"
        ).textContent =
          `Gold rings mark Q′${nextRound}, the next batch of ${queryIndices.length} individually scored items closest to the current 50/50 boundary.`;
      } else {
        byId(
          "al-note"
        ).textContent =
          `Gold rings mark Q′${nextRound}, the next batch of ${queryIndices.length} items selected without using the model's uncertainty.`;
      }
    }

    function refresh() {
      train();
      chooseQueries();
      draw();
    }

    function reset() {
      createData();
      initialLabels();
      acquisitionRound = 0;
      refresh();
    }

    acquireButton.addEventListener(
      "click",
      () => {
        if (
          queryIndices.length ===
          0
        ) {
          return;
        }

        queryIndices.forEach(
          (index) => {
            labeled.add(index);
          }
        );

        acquisitionRound += 1;
        refresh();
      }
    );

    byId(
      "al-reset"
    ).addEventListener(
      "click",
      reset
    );

    document
      .querySelectorAll(
        'input[name="strategy"]'
      )
      .forEach((radio) => {
        radio.addEventListener(
          "change",
          reset
        );
      });

    reset();
  }

  document.addEventListener(
    "DOMContentLoaded",
    () => {
      initReadingProgress();
      initEntropyExplorer();
      initMCDropout();
      initFinetuningDemo();
      initSavingsExplorer();
      initLanguageExplorer();
      initActiveLearningPlayground();
    }
  );
}());