import * as db from "../db.js";
import { renderMonthCalendar } from "../components/monthCalendar.js";
import { renderLineChart } from "../components/lineChart.js";

const RANGE_OPTIONS = [
  ["1M", 30],
  ["3M", 91],
  ["6M", 182],
  ["12M", 365],
  ["All", null],
];

function formatVolume(kg) {
  return `${Math.round(kg).toLocaleString()} kg`;
}

function formatDuration(seconds) {
  const totalMinutes = Math.floor(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function formatDate(dateStr) {
  return new Date(dateStr + "T00:00:00").toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function statCard(title, valueText, pctChange) {
  let trendHtml;
  if (pctChange === null || pctChange === undefined) {
    trendHtml = `<span style="color:var(--color-text-secondary);font-size:12px;">No data in prior 7 days</span>`;
  } else {
    const isUp = pctChange >= 0;
    const color = isUp ? "var(--color-success)" : "var(--color-danger)";
    trendHtml = `<span style="color:${color};font-size:12px;font-weight:600;">${isUp ? "▲" : "▼"} ${pctChange >= 0 ? "+" : ""}${pctChange.toFixed(0)}% vs prior 7 days</span>`;
  }
  return `
    <div class="card" style="flex:1;">
      <div style="color:var(--color-text-secondary);font-size:12px;">${title}</div>
      <div style="font-size:20px;font-weight:700;margin:2px 0 4px;">${valueText}</div>
      ${trendHtml}
    </div>
  `;
}

export function renderProgress(container, { navigateTo }) {
  let currentTab = "activity";
  let nutritionRangeDays = 91; // default 3M

  container.innerHTML = `
    <div class="row" style="margin-bottom: 4px;">
      <button class="icon-btn" id="go-home">←</button>
      <h1 style="margin:0 0 0 4px;">Progress</h1>
    </div>
    <div class="row" style="margin:12px 0 14px;gap:8px;">
      <button class="btn" id="tab-activity" style="flex:1;">Activity</button>
      <button class="btn" id="tab-nutrition" style="flex:1;">Nutrition</button>
    </div>
    <div id="tab-content"></div>
  `;

  container.querySelector("#go-home").addEventListener("click", () => navigateTo("home"));

  const activityBtn = container.querySelector("#tab-activity");
  const nutritionBtn = container.querySelector("#tab-nutrition");
  const content = container.querySelector("#tab-content");

  function styleTabs() {
    activityBtn.className = currentTab === "activity" ? "btn btn-primary" : "btn btn-secondary";
    activityBtn.style.flex = "1";
    nutritionBtn.className = currentTab === "nutrition" ? "btn btn-primary" : "btn btn-secondary";
    nutritionBtn.style.flex = "1";
  }

  function renderActivity() {
    const stats = db.getWeekStats();
    const prs = db.getRecentPRs(3);

    content.innerHTML = `
      <div class="row" style="gap:10px;margin-bottom:16px;">
        ${statCard("Volume", formatVolume(stats.volume), stats.volumePctChange)}
        ${statCard("Workout Time", formatDuration(stats.timeSeconds), stats.timePctChange)}
      </div>
      <div class="section" id="calendar-slot"></div>
      <h3>Personal Records</h3>
      <p style="color:var(--color-text-secondary);font-size:12px;margin-top:-6px;">Best estimated 1RM, last 3 months</p>
      <div id="pr-list"></div>
    `;

    renderMonthCalendar(content.querySelector("#calendar-slot"));

    const prList = content.querySelector("#pr-list");
    if (!prs.length) {
      prList.innerHTML = `<div class="placeholder">No personal records in the last 3 months yet.</div>`;
    } else {
      prList.innerHTML = prs
        .map(
          (pr) => `
        <div class="row" style="background:var(--color-accent-soft);border:1px solid var(--color-accent);border-radius:12px;padding:8px 12px;margin-bottom:8px;align-items:center;">
          <span style="font-size:18px;margin-right:8px;">🏆</span>
          <span style="flex:1;">${pr.name}</span>
          <strong>${pr.prRm.toFixed(0)} kg</strong>
        </div>
      `
        )
        .join("");
    }
  }

  function renderNutritionTab() {
    const [latestWeight] = db.getLatestWeight();

    content.innerHTML = `
      <div style="margin-bottom:16px;">
        <div style="color:var(--color-text-secondary);font-size:12px;">Current weight</div>
        <div style="font-size:26px;font-weight:700;">${latestWeight != null ? `${latestWeight}kg` : "No weight logged yet"}</div>
      </div>
      <div class="row" id="range-row" style="gap:6px;margin-bottom:16px;flex-wrap:wrap;"></div>
      <h3>Calories intake (7-day avg)</h3>
      <div id="calories-chart"></div>
      <div id="calories-range" style="text-align:center;color:var(--color-text-secondary);font-size:12px;margin:4px 0 16px;"></div>
      <h3>Body weight (7-day avg)</h3>
      <div id="weight-chart"></div>
      <div id="weight-range" style="text-align:center;color:var(--color-text-secondary);font-size:12px;margin-top:4px;"></div>
    `;

    const rangeRow = content.querySelector("#range-row");
    function styleRangeButtons() {
      rangeRow.innerHTML = "";
      for (const [label, days] of RANGE_OPTIONS) {
        const btn = document.createElement("button");
        btn.textContent = label;
        const active = days === nutritionRangeDays;
        btn.className = active ? "btn btn-primary" : "btn btn-secondary";
        btn.style.cssText = "flex:1;padding:6px 0;font-size:13px;";
        btn.addEventListener("click", () => {
          nutritionRangeDays = days;
          styleRangeButtons();
          updateCharts();
        });
        rangeRow.appendChild(btn);
      }
    }

    function updateCharts() {
      const end = new Date();
      const start = nutritionRangeDays === null ? new Date(1970, 0, 1) : new Date();
      if (nutritionRangeDays !== null) start.setDate(end.getDate() - nutritionRangeDays);

      // Local calendar date, not toISOString() -- that reads the UTC day
      // and can shift the range by one near midnight in other timezones.
      const toLocalIso = (d) => {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        return `${y}-${m}-${day}`;
      };
      const series = db.getNutritionChartSeries(toLocalIso(start), toLocalIso(end));

      const calories = series.caloriesRolling;
      renderLineChart(content.querySelector("#calories-chart"), calories, {
        color: "var(--color-secondary)",
        yFormat: (v) => `${v.toFixed(0)}`,
        minSpan: 400,
      });
      content.querySelector("#calories-range").textContent = calories.length
        ? `${formatDate(calories[0][0])}   →   ${formatDate(calories[calories.length - 1][0])}`
        : "No calorie logs in this range.";

      const weight = series.weightRolling;
      renderLineChart(content.querySelector("#weight-chart"), weight, {
        yFormat: (v) => `${v.toFixed(1)}`,
        minSpan: 4,
        showTrendArrow: true,
      });
      content.querySelector("#weight-range").textContent = weight.length
        ? `${formatDate(weight[0][0])}   →   ${formatDate(weight[weight.length - 1][0])}`
        : "No weight logs in this range.";
    }

    styleRangeButtons();
    updateCharts();
  }

  function showTab(tab) {
    currentTab = tab;
    styleTabs();
    if (tab === "activity") renderActivity();
    else renderNutritionTab();
  }

  activityBtn.addEventListener("click", () => showTab("activity"));
  nutritionBtn.addEventListener("click", () => showTab("nutrition"));

  showTab("activity");
}
