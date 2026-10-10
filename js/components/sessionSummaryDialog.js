import { openModal } from "../ui.js";

function toLocalDateInputValue(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** elapsedSeconds: real elapsed time, used as the editable default duration.
 * onConfirm(dateObj, durationSeconds) */
export function openSessionSummaryDialog(elapsedSeconds, onConfirm) {
  const today = new Date();
  const { body, close } = openModal({ title: "Finish Workout" });

  const hours = Math.floor(elapsedSeconds / 3600);
  const minutes = Math.floor((elapsedSeconds % 3600) / 60);

  body.innerHTML = `
    <div style="font-size:12px;color:var(--color-text-secondary);margin-bottom:4px;">Date</div>
    <input type="date" id="session-date" value="${toLocalDateInputValue(today)}" max="${toLocalDateInputValue(today)}" style="margin-bottom:14px;" />
    <div style="font-size:12px;color:var(--color-text-secondary);margin-bottom:4px;">Duration</div>
    <div class="row" style="margin-bottom:16px;">
      <input type="number" id="session-hours" value="${hours}" min="0" style="width:70px;" />
      <span style="color:var(--color-text-secondary);">h</span>
      <input type="number" id="session-minutes" value="${minutes}" min="0" max="59" style="width:70px;" />
      <span style="color:var(--color-text-secondary);">min</span>
    </div>
    <button class="btn btn-primary" id="save-session" style="width:100%;">Save Workout</button>
  `;

  body.querySelector("#save-session").addEventListener("click", () => {
    const dateVal = body.querySelector("#session-date").value;
    const h = Number(body.querySelector("#session-hours").value) || 0;
    const m = Number(body.querySelector("#session-minutes").value) || 0;
    const [y, mo, d] = dateVal.split("-").map(Number);
    const selectedDate = new Date(y, mo - 1, d);
    close();
    onConfirm(selectedDate, h * 3600 + m * 60);
  });
}
