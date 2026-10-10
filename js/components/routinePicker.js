import * as db from "../db.js";
import { openModal } from "../ui.js";

export function openRoutinePicker(onSelect) {
  let dismissing = false;
  const { body, close } = openModal({ title: "Add Routine" });

  const routines = db.listRoutines();
  if (!routines.length) {
    body.innerHTML = `<div class="placeholder">No routines yet. Create one from the Routines screen.</div>`;
    return;
  }

  body.innerHTML = routines
    .map((r) => {
      const exercises = db.getRoutineExercises(r.id);
      const namesText = exercises.length ? exercises.map((e) => e.name).join(", ") : "No exercises";
      return `
        <div class="card routine-pick-item" data-id="${r.id}" style="cursor:pointer;">
          <strong>${r.name}</strong>
          <div style="color:var(--color-text-secondary);font-size:13px;margin-top:2px;">${namesText}</div>
        </div>
      `;
    })
    .join("");

  body.querySelectorAll(".routine-pick-item").forEach((el) => {
    el.addEventListener("click", () => {
      if (dismissing) return;
      dismissing = true;
      onSelect(Number(el.dataset.id));
      close();
    });
  });
}
