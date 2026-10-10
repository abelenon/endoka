import * as db from "../db.js";
import { openModal } from "../ui.js";

function formatDate(dateStr) {
  return new Date(dateStr + "T00:00:00").toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function setsText(exercise) {
  if (exercise.record_type === "duration") {
    return exercise.sets
      .map((s) => (s.duration_seconds != null ? `${s.duration_seconds}s` : "-"))
      .join(", ");
  }
  if (exercise.record_type === "reps_only") {
    return exercise.sets.map((s) => (s.reps != null ? `${s.reps} reps` : "-")).join(", ");
  }
  return exercise.sets
    .map((s) => (s.weight != null && s.reps != null ? `${s.weight}kg × ${s.reps}` : "-"))
    .join(", ");
}

export function openWorkoutDetail(dateStr) {
  const { body } = openModal({ title: formatDate(dateStr) });
  const sessions = db.getSessionsOnDate(dateStr);

  if (!sessions.length) {
    body.innerHTML = `<div class="placeholder">No workout recorded for this day.</div>`;
    return;
  }

  const multi = sessions.length > 1;
  body.innerHTML = sessions
    .map((session, i) => {
      const header = multi
        ? `<div style="color:var(--color-text-secondary);font-size:12px;margin:10px 0 4px;">Session ${i + 1}</div>`
        : "";
      const cards = session.exercises
        .map((ex) => {
          let title = ex.name;
          if (ex.mode) title += `  ·  ${ex.mode}`;
          if (ex.is_two_sided) title += "  ·  per side";
          return `
            <div class="card">
              <strong>${title}</strong>
              <div style="color:var(--color-text-secondary);margin-top:4px;">${setsText(ex)}</div>
              ${ex.notes ? `<div style="color:var(--color-text-secondary);font-style:italic;font-size:13px;margin-top:4px;">${ex.notes}</div>` : ""}
            </div>
          `;
        })
        .join("");
      return header + cards;
    })
    .join("");
}
