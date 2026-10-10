import * as db from "../db.js";
import { confirmDialog, showToast } from "../ui.js";
import { openNewRoutineDialog } from "../components/newRoutineDialog.js";

export function renderRoutines(container, { navigateTo }) {
  container.innerHTML = `
    <div class="row" style="margin-bottom: 12px;">
      <button class="icon-btn" id="go-home">←</button>
      <h1 style="margin: 0 0 0 4px;">Routines</h1>
      <div class="spacer"></div>
      <button class="icon-btn" id="new-routine">+</button>
    </div>
    <div id="routine-list"></div>
  `;

  container.querySelector("#go-home").addEventListener("click", () => navigateTo("home"));
  container.querySelector("#new-routine").addEventListener("click", () => {
    openNewRoutineDialog(() => refresh());
  });

  function refresh() {
    const listEl = container.querySelector("#routine-list");
    const routines = db.listRoutines();
    if (!routines.length) {
      listEl.innerHTML = `<div class="placeholder">No routines yet. Tap + to create one.</div>`;
      return;
    }
    listEl.innerHTML = "";
    for (const routine of routines) {
      const exercises = db.getRoutineExercises(routine.id);
      const namesText = exercises.length ? exercises.map((e) => e.name).join(", ") : "No exercises";

      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML = `
        <div class="row" style="margin-bottom:4px;">
          <strong style="flex:1;">${routine.name}</strong>
          <button class="icon-btn sm danger" data-action="delete">🗑</button>
        </div>
        <div style="color:var(--color-text-secondary);font-size:13px;margin-bottom:10px;">${namesText}</div>
        <button class="btn btn-secondary" data-action="add-to-workout" style="width:100%;">+ Add to Workout</button>
      `;

      card.querySelector('[data-action="delete"]').addEventListener("click", async () => {
        const ok = await confirmDialog({
          title: "Delete routine?",
          message: `"${routine.name}" will be permanently deleted.`,
          confirmText: "Delete",
        });
        if (!ok) return;
        await db.deleteRoutine(routine.id);
        refresh();
      });

      card.querySelector('[data-action="add-to-workout"]').addEventListener("click", async () => {
        if (!exercises.length) {
          showToast("This routine has no exercises.", "warning");
          return;
        }
        let sessionId = db.getUnfinishedSession()?.id;
        if (!sessionId) sessionId = await db.createSession();
        for (const exercise of exercises) {
          await db.addSessionExercise(sessionId, exercise.id);
        }
        navigateTo("workout");
      });

      listEl.appendChild(card);
    }
  }

  refresh();
}
