import * as db from "../db.js";
import { openWorkoutDetail } from "./workoutDetail.js";

const WEEKDAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"];

export function renderMonthCalendar(container) {
  const today = new Date();
  let year = today.getFullYear();
  let month = today.getMonth() + 1; // 1-12

  function isCurrentMonth() {
    return year === today.getFullYear() && month === today.getMonth() + 1;
  }

  function nextMonth() {
    if (isCurrentMonth()) return;
    if (month === 12) {
      year += 1;
      month = 1;
    } else {
      month += 1;
    }
    render();
  }

  function prevMonth() {
    if (month === 1) {
      year -= 1;
      month = 12;
    } else {
      month -= 1;
    }
    render();
  }

  function render() {
    const info = db.getMonthCalendar(year, month);
    const sessionDays = info.days;
    const monthName = new Date(year, month - 1, 1).toLocaleDateString(undefined, {
      month: "long",
      year: "numeric",
    });

    const firstWeekday = (new Date(year, month - 1, 1).getDay() + 6) % 7; // Monday=0
    const daysInMonth = new Date(year, month, 0).getDate();

    const cells = [];
    for (let i = 0; i < firstWeekday; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    while (cells.length % 7 !== 0) cells.push(null);

    const weeks = [];
    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

    container.innerHTML = `
      <div class="row" style="margin-bottom:8px;">
        <button class="icon-btn sm" id="cal-prev">‹</button>
        <div class="spacer"></div>
        <strong>${monthName}</strong>
        <div class="spacer"></div>
        <button class="icon-btn sm" id="cal-next" ${isCurrentMonth() ? "disabled" : ""}>›</button>
      </div>
      <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin-bottom:4px;">
        ${WEEKDAY_LABELS.map((l) => `<div style="text-align:center;font-size:11px;color:var(--color-text-secondary);">${l}</div>`).join("")}
      </div>
      ${weeks
        .map(
          (week) => `
        <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin-bottom:4px;">
          ${week
            .map((d) => {
              if (d === null) return `<div></div>`;
              const hasSession = sessionDays.has(d);
              return `
                <div style="display:flex;justify-content:center;">
                  <button class="day-dot" data-day="${d}" ${hasSession ? "" : "disabled"} style="
                    width:30px;height:30px;border-radius:50%;border:none;font-size:13px;
                    background:${hasSession ? "var(--color-primary)" : "var(--color-section-tint)"};
                    color:${hasSession ? "var(--color-on-primary)" : "var(--color-text-secondary)"};
                    font-weight:${hasSession ? "700" : "400"};
                    cursor:${hasSession ? "pointer" : "default"};
                  ">${d}</button>
                </div>
              `;
            })
            .join("")}
        </div>
      `
        )
        .join("")}
      <div style="text-align:center;color:var(--color-text-secondary);font-size:13px;margin-top:4px;">${info.totalSessions} total sessions</div>
    `;

    container.querySelector("#cal-prev").addEventListener("click", prevMonth);
    const nextBtn = container.querySelector("#cal-next");
    if (!isCurrentMonth()) nextBtn.addEventListener("click", nextMonth);

    container.querySelectorAll(".day-dot:not(:disabled)").forEach((btn) => {
      btn.addEventListener("click", () => {
        const d = Number(btn.dataset.day);
        const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        openWorkoutDetail(dateStr);
      });
    });
  }

  render();
}
