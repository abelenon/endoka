import * as db from "../db.js";
import { openModal, showToast } from "../ui.js";
import { openNewExerciseDialog } from "./newExerciseDialog.js";
import { openExerciseDetail } from "./exerciseDetail.js";

/** options: { onSelect(id, name), keepOpen, selectedIds: Set, onDeselect(id) } */
export function openExercisePicker({ onSelect, keepOpen = false, selectedIds = null, onDeselect = null } = {}) {
  const selected = selectedIds || new Set();
  let muscleFilter = null;
  let dismissing = false;

  const { body, close } = openModal({ title: "Add Exercise" });

  body.innerHTML = `
    <div class="row" style="margin-bottom:8px;">
      <input type="text" id="picker-search" placeholder="Search exercises" />
      <button class="btn-text" id="new-exercise" style="white-space:nowrap;">+ New</button>
    </div>
    <div id="muscle-chips" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;"></div>
    <div id="picker-list"></div>
  `;

  const searchEl = body.querySelector("#picker-search");
  const listEl = body.querySelector("#picker-list");
  const chipsEl = body.querySelector("#muscle-chips");

  function renderChips() {
    chipsEl.innerHTML = "";
    const options = [[null, "All"], ...db.MUSCLE_GROUPS.map((m) => [m, m])];
    for (const [value, label] of options) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.textContent = label;
      const active = value === muscleFilter;
      chip.style.cssText = `
        padding: 5px 12px; border-radius: 999px; font-size: 12px; font-weight: 600; cursor: pointer;
        border: 1px solid ${active ? "var(--color-primary)" : "var(--color-border)"};
        background: ${active ? "var(--color-primary)" : "var(--color-surface)"};
        color: ${active ? "var(--color-on-primary)" : "var(--color-text)"};
      `;
      chip.addEventListener("click", () => {
        muscleFilter = value;
        renderChips();
        refresh();
      });
      chipsEl.appendChild(chip);
    }
  }

  function refresh() {
    listEl.innerHTML = "";
    const rows = db.listExercises(searchEl.value.trim(), muscleFilter);
    for (const row of rows) {
      let muscles = row.primary_muscle;
      if (row.secondary_muscle) muscles += ` • ${row.secondary_muscle}`;

      const isSelected = selected.has(row.id);
      const item = document.createElement("div");
      item.className = "row";
      item.style.cssText = `padding:8px 4px;border-bottom:1px solid var(--color-border);border-radius:8px;${
        isSelected ? "background:var(--color-light-cyan);" : ""
      }`;

      const tapArea = document.createElement("div");
      tapArea.className = "row";
      tapArea.style.cssText = "flex:1;cursor:pointer;";
      tapArea.innerHTML = `
        <div style="flex:1;">
          <div>${row.name}</div>
          <div style="color:var(--color-text-secondary);font-size:12px;">${muscles}</div>
        </div>
        ${keepOpen ? `<span style="font-size:18px;color:${isSelected ? "var(--color-primary)" : "var(--color-border)"};">${isSelected ? "✓" : "○"}</span>` : ""}
      `;
      tapArea.addEventListener("click", () => select(row.id, row.name));
      item.appendChild(tapArea);

      const chartBtn = document.createElement("button");
      chartBtn.className = "icon-btn sm";
      chartBtn.textContent = "📈";
      chartBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        openExerciseDetail(row.id, row.name);
      });
      item.appendChild(chartBtn);

      listEl.appendChild(item);
    }
  }

  function select(id, name) {
    if (!keepOpen) {
      if (dismissing) return;
      dismissing = true;
      onSelect(id, name);
      close();
      return;
    }
    if (selected.has(id)) {
      selected.delete(id);
      if (onDeselect) onDeselect(id);
      showToast(`Removed ${name}`);
    } else {
      selected.add(id);
      onSelect(id, name);
      showToast(`Added ${name}`, "success");
    }
    refresh();
  }

  searchEl.addEventListener("input", refresh);
  body.querySelector("#new-exercise").addEventListener("click", () => {
    openNewExerciseDialog((id, name) => {
      refresh();
      select(id, name);
    });
  });

  renderChips();
  refresh();
}
