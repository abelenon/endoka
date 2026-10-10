import * as db from "../db.js";
import { openModal } from "../ui.js";
import { renderLineChart } from "./lineChart.js";

function formatDate(dateStr) {
  return new Date(dateStr + "T00:00:00").toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function openExerciseDetail(exerciseId, exerciseName) {
  const exercise = db.getExercise(exerciseId);
  const recordType = exercise ? exercise.record_type : "reps_weight";
  let rmTarget = 1;

  const { body } = openModal({ title: exerciseName });

  const subtitleParts = [];
  if (exercise) {
    subtitleParts.push(exercise.primary_muscle);
    if (exercise.secondary_muscle) subtitleParts.push(exercise.secondary_muscle);
  }
  const subtitle = subtitleParts.join(" • ") + (exercise && exercise.is_two_sided ? "   |   per side" : "");

  body.innerHTML = `
    <div style="color:var(--color-text-secondary);font-size:13px;margin-bottom:10px;">${subtitle}</div>
    <div class="row" style="gap:8px;margin-bottom:12px;">
      <button class="btn btn-secondary" id="tab-history" style="flex:1;">History</button>
      <button class="btn btn-secondary" id="tab-chart" style="flex:1;">Chart</button>
    </div>
    <div id="detail-content"></div>
  `;

  const content = body.querySelector("#detail-content");
  const historyBtn = body.querySelector("#tab-history");
  const chartBtn = body.querySelector("#tab-chart");

  function setActive(which) {
    historyBtn.className = which === "history" ? "btn btn-primary" : "btn btn-secondary";
    historyBtn.style.flex = "1";
    chartBtn.className = which === "chart" ? "btn btn-primary" : "btn btn-secondary";
    chartBtn.style.flex = "1";
  }

  function showHistory() {
    setActive("history");
    const history = db.getExerciseHistory(exerciseId);
    if (!history.length) {
      content.innerHTML = `<div class="placeholder">No completed sets yet.</div>`;
      return;
    }
    content.innerHTML = history
      .map((entry) => {
        let dateText = formatDate(entry.date);
        if (entry.mode) dateText += `  ·  ${entry.mode}`;
        let setsText;
        if (recordType === "duration") {
          setsText = entry.sets.map(([, , d]) => (d != null ? `${d}s` : "-")).join(", ");
        } else if (recordType === "reps_only") {
          setsText = entry.sets.map(([, r]) => (r != null ? `${r} reps` : "-")).join(", ");
        } else {
          setsText = entry.sets
            .map(([w, r]) => (w != null && r != null ? `${w}kg × ${r}` : "-"))
            .join(", ");
        }
        return `
          <div class="card">
            <strong>${dateText}</strong>
            <div style="color:var(--color-text-secondary);margin-top:2px;">${setsText}</div>
            ${entry.notes ? `<div style="color:var(--color-text-secondary);font-style:italic;font-size:13px;margin-top:2px;">${entry.notes}</div>` : ""}
          </div>
        `;
      })
      .join("");
  }

  function showChart() {
    setActive("chart");
    if (recordType === "duration") {
      const points = db.getExerciseDurationHistory(exerciseId);
      content.innerHTML = points.length
        ? `<div style="font-weight:700;margin-bottom:6px;">Latest best hold: ${points[points.length - 1][1]}s</div><div id="chart-slot"></div>`
        : `<div class="placeholder">No completed sets yet.</div>`;
      if (points.length) {
        renderLineChart(content.querySelector("#chart-slot"), points, {
          color: "var(--color-purple)",
          yFormat: (v) => `${v.toFixed(0)}s`,
        });
      }
      return;
    }
    if (recordType === "reps_only") {
      const points = db.getExerciseRepsHistory(exerciseId);
      content.innerHTML = points.length
        ? `<div style="font-weight:700;margin-bottom:6px;">Latest best set: ${points[points.length - 1][1]} reps</div><div id="chart-slot"></div>`
        : `<div class="placeholder">No completed sets yet.</div>`;
      if (points.length) {
        renderLineChart(content.querySelector("#chart-slot"), points, {
          color: "var(--color-success)",
          yFormat: (v) => `${v.toFixed(0)}`,
        });
      }
      return;
    }

    // reps_weight: estimated-RM chart with a 1RM/5RM toggle.
    const points = db.getExerciseRmHistory(exerciseId, rmTarget);
    content.innerHTML = `
      <div class="row" style="gap:8px;margin-bottom:8px;">
        <button class="btn ${rmTarget === 1 ? "btn-primary" : "btn-secondary"}" id="rm1" style="flex:1;">1RM</button>
        <button class="btn ${rmTarget === 5 ? "btn-primary" : "btn-secondary"}" id="rm5" style="flex:1;">5RM</button>
      </div>
      ${
        points.length
          ? `<div style="font-weight:700;margin-bottom:6px;">Latest est. ${rmTarget}RM: ${points[points.length - 1][1].toFixed(1)} kg</div><div id="chart-slot"></div>`
          : `<div class="placeholder">No completed sets yet.</div>`
      }
    `;
    content.querySelector("#rm1").addEventListener("click", () => {
      rmTarget = 1;
      showChart();
    });
    content.querySelector("#rm5").addEventListener("click", () => {
      rmTarget = 5;
      showChart();
    });
    if (points.length) {
      renderLineChart(content.querySelector("#chart-slot"), points, {
        yFormat: (v) => `${v.toFixed(0)}`,
      });
    }
  }

  historyBtn.addEventListener("click", showHistory);
  chartBtn.addEventListener("click", showChart);
  showHistory();
}
