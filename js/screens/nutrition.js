import * as db from "../db.js";
import { showToast } from "../ui.js";
import { exportNutritionPdf } from "../nutritionExport.js";

function toLocalDateInputValue(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatDisplayDate(date) {
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function dateFromIso(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function renderNutrition(container, { navigateTo }) {
  const latest = db.latestNutritionDate();
  let currentDate = latest ? dateFromIso(latest) : new Date();

  container.innerHTML = `
    <div class="row" style="margin-bottom: 8px;">
      <button class="icon-btn" id="go-home">←</button>
      <h1 style="margin: 0 0 0 4px;">Nutrition</h1>
      <div class="spacer"></div>
      <button class="btn-text" id="export-pdf">Export</button>
    </div>
    <div class="row" style="justify-content:center;align-items:center;margin-bottom:18px;">
      <button class="icon-btn" id="date-prev">‹</button>
      <strong id="date-label" style="margin:0 12px;"></strong>
      <button class="icon-btn" id="date-next">›</button>
    </div>
    <div class="section" id="fields"></div>
  `;

  const fieldsEl = container.querySelector("#fields");
  const dateLabel = container.querySelector("#date-label");
  const nextBtn = container.querySelector("#date-next");

  function statRow(id, placeholder, unit, quickAddKey) {
    return `
      <div class="row" style="margin-bottom: 14px; align-items: center;">
        <input type="number" step="any" id="${id}" placeholder="${placeholder}" style="font-size: 22px; font-weight: 700; width: 110px; text-align:center;" />
        <span style="color: var(--color-text-secondary); width: 80px;">${unit}</span>
        ${quickAddKey ? `<button class="icon-btn sm" data-quick="${quickAddKey}">+</button>` : ""}
      </div>
      ${quickAddKey ? `<div class="quick-add-slot" data-slot="${quickAddKey}" style="margin:-8px 0 10px 0;"></div>` : ""}
    `;
  }

  fieldsEl.innerHTML =
    statRow("weight-field", "-", "kg") +
    statRow("calories-field", "-", "Kcal", "calories") +
    statRow("protein-field", "-", "g Protein", "protein") +
    statRow("fat-field", "-", "g Fat");

  const weightField = fieldsEl.querySelector("#weight-field");
  const caloriesField = fieldsEl.querySelector("#calories-field");
  const proteinField = fieldsEl.querySelector("#protein-field");
  const fatField = fieldsEl.querySelector("#fat-field");

  function persistCurrentFields() {
    const weight = weightField.value ? Number(weightField.value) : null;
    const calories = caloriesField.value ? Math.round(Number(caloriesField.value)) : null;
    const protein = proteinField.value ? Number(proteinField.value) : null;
    const fat = fatField.value ? Number(fatField.value) : null;
    db.saveNutritionLog(toLocalDateInputValue(currentDate), calories, protein, fat, weight);
  }

  for (const field of [weightField, caloriesField, proteinField, fatField]) {
    field.addEventListener("change", persistCurrentFields);
  }

  function toggleQuickAdd(key) {
    const slot = fieldsEl.querySelector(`.quick-add-slot[data-slot="${key}"]`);
    if (slot.dataset.open === "true") {
      slot.innerHTML = "";
      slot.dataset.open = "false";
      return;
    }
    slot.dataset.open = "true";
    const hint = key === "calories" ? "Add calories" : "Add protein (g)";
    const unit = key === "calories" ? "kcal" : "g protein";
    slot.innerHTML = `
      <div class="row">
        <input type="number" step="any" placeholder="${hint}" class="quick-amount" style="flex:1;" />
        <button class="btn btn-secondary quick-add-btn">Add</button>
      </div>
    `;
    slot.querySelector(".quick-add-btn").addEventListener("click", () => {
      const amountInput = slot.querySelector(".quick-amount");
      const amount = Number(amountInput.value) || 0;
      if (!amount) return;
      const targetField = key === "calories" ? caloriesField : proteinField;
      const current = Number(targetField.value) || 0;
      targetField.value = current + amount;
      persistCurrentFields();
      toggleQuickAdd(key);
      showToast(`Added ${amount} ${unit}`, "success");
    });
  }

  fieldsEl.querySelectorAll("[data-quick]").forEach((btn) => {
    btn.addEventListener("click", () => toggleQuickAdd(btn.dataset.quick));
  });

  function refresh() {
    dateLabel.textContent = formatDisplayDate(currentDate);
    const isToday = startOfDay(currentDate).getTime() >= startOfDay(new Date()).getTime();
    nextBtn.disabled = isToday;

    const log = db.getNutritionLog(toLocalDateInputValue(currentDate));
    weightField.value = log && log.weight != null ? log.weight : "";
    caloriesField.value = log && log.calories != null ? log.calories : "";
    proteinField.value = log && log.protein != null ? log.protein : "";
    fatField.value = log && log.fat != null ? log.fat : "";

    for (const key of ["calories", "protein"]) {
      const slot = fieldsEl.querySelector(`.quick-add-slot[data-slot="${key}"]`);
      slot.innerHTML = "";
      slot.dataset.open = "false";
    }
  }

  container.querySelector("#go-home").addEventListener("click", () => navigateTo("home"));
  container.querySelector("#date-prev").addEventListener("click", () => {
    currentDate = new Date(currentDate);
    currentDate.setDate(currentDate.getDate() - 1);
    refresh();
  });
  container.querySelector("#date-next").addEventListener("click", () => {
    const next = new Date(currentDate);
    next.setDate(next.getDate() + 1);
    if (startOfDay(next).getTime() > startOfDay(new Date()).getTime()) return;
    currentDate = next;
    refresh();
  });

  container.querySelector("#export-pdf").addEventListener("click", async (e) => {
    const logs = db.getAllNutritionLogs();
    if (!logs.length) {
      showToast("No nutrition logs to export yet.", "warning");
      return;
    }
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = "Exporting...";
    try {
      await exportNutritionPdf(logs);
    } catch (err) {
      showToast(err.message || "Couldn't export the PDF.", "error");
    } finally {
      btn.disabled = false;
      btn.textContent = "Export";
    }
  });

  refresh();
}
