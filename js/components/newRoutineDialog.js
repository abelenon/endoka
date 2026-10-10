import * as db from "../db.js";
import { openModal } from "../ui.js";
import { openExercisePicker } from "./exercisePicker.js";

export function openNewRoutineDialog(onSave) {
  const picked = []; // [[id, name], ...] insertion order
  const { body, close } = openModal({ title: "New Routine" });

  body.innerHTML = `
    <input type="text" id="routine-name" placeholder="Routine name" style="margin-bottom:14px;" />
    <div class="row" style="margin-bottom:8px;">
      <span style="font-size:12px;color:var(--color-text-secondary);">EXERCISES</span>
      <div class="spacer"></div>
      <button class="btn-text" id="add-exercise">+ Add</button>
    </div>
    <div id="picked-list" style="margin-bottom:14px;"></div>
    <button class="btn btn-primary" id="save-routine" style="width:100%;">Save Routine</button>
  `;

  const pickedList = body.querySelector("#picked-list");

  function refreshList() {
    if (!picked.length) {
      pickedList.innerHTML = `<div style="color:var(--color-text-secondary);font-size:13px;">No exercises added yet.</div>`;
      return;
    }
    pickedList.innerHTML = picked
      .map(
        ([id, name]) => `
        <div class="row" style="padding:6px 0;border-bottom:1px solid var(--color-border);">
          <span style="flex:1;">${name}</span>
          <button class="icon-btn sm remove-picked" data-id="${id}">✕</button>
        </div>
      `
      )
      .join("");
    pickedList.querySelectorAll(".remove-picked").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = Number(btn.dataset.id);
        const idx = picked.findIndex(([pid]) => pid === id);
        if (idx !== -1) picked.splice(idx, 1);
        refreshList();
      });
    });
  }

  body.querySelector("#add-exercise").addEventListener("click", () => {
    openExercisePicker({
      keepOpen: true,
      selectedIds: new Set(picked.map(([id]) => id)),
      onSelect: (id, name) => {
        if (!picked.some(([pid]) => pid === id)) picked.push([id, name]);
        refreshList();
      },
      onDeselect: (id) => {
        const idx = picked.findIndex(([pid]) => pid === id);
        if (idx !== -1) picked.splice(idx, 1);
        refreshList();
      },
    });
  });

  body.querySelector("#save-routine").addEventListener("click", async () => {
    const name = body.querySelector("#routine-name").value.trim();
    if (!name || !picked.length) return;
    const routineId = await db.createRoutine(name);
    for (const [exerciseId] of picked) {
      await db.addRoutineExercise(routineId, exerciseId);
    }
    close();
    onSave(routineId, name);
  });

  refreshList();
}
