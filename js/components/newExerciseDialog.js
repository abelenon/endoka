import * as db from "../db.js";
import { openModal } from "../ui.js";

const RECORD_TYPES = [
  ["reps_weight", "Reps & Weight"],
  ["duration", "Duration"],
  ["reps_only", "Reps only"],
];

function chipRow(options, selectedValue, onChange) {
  const row = document.createElement("div");
  row.style.cssText = "display:flex;flex-wrap:wrap;gap:8px;";
  function render() {
    row.innerHTML = "";
    for (const [value, label] of options) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.textContent = label;
      const active = value === selectedValue;
      chip.style.cssText = `
        padding: 6px 14px; border-radius: 999px; font-size: 13px; font-weight: 600; cursor: pointer;
        border: 1px solid ${active ? "var(--color-primary)" : "var(--color-border)"};
        background: ${active ? "var(--color-primary)" : "var(--color-surface)"};
        color: ${active ? "var(--color-on-primary)" : "var(--color-text)"};
      `;
      chip.addEventListener("click", () => {
        selectedValue = value;
        onChange(value);
        render();
      });
      row.appendChild(chip);
    }
  }
  render();
  return row;
}

function musclePickerRow(placeholder, initialValue, options, onChange) {
  const row = document.createElement("div");
  row.className = "row";
  row.style.cssText =
    "border:1px solid var(--color-border);border-radius:var(--radius-sm);padding:8px 10px;cursor:pointer;background:var(--color-surface);";
  let value = initialValue;

  const label = document.createElement("span");
  label.style.color = value ? "var(--color-text)" : "var(--color-text-secondary)";
  label.textContent = value || placeholder;
  row.appendChild(label);

  row.addEventListener("click", () => {
    const overlay = document.createElement("div");
    overlay.style.cssText =
      "position:fixed;inset:0;background:rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;z-index:60;padding:24px;";
    overlay.innerHTML = `
      <div style="background:var(--color-surface);width:100%;max-width:320px;max-height:70vh;overflow-y:auto;border-radius:20px;padding:16px;">
        <h3 style="margin:0 0 10px;">${placeholder}</h3>
        <div id="option-list"></div>
      </div>
    `;
    document.body.appendChild(overlay);
    const list = overlay.querySelector("#option-list");
    const allOptions = options.includes(null) ? options : options;
    for (const opt of options) {
      const optRow = document.createElement("div");
      optRow.textContent = opt === null ? "None" : opt;
      optRow.style.cssText = `padding:10px 6px;cursor:pointer;color:${
        opt === value ? "var(--color-primary)" : "var(--color-text)"
      };font-weight:${opt === value ? "700" : "400"};border-bottom:1px solid var(--color-border);`;
      optRow.addEventListener("click", () => {
        value = opt;
        label.textContent = value || placeholder;
        label.style.color = value ? "var(--color-text)" : "var(--color-text-secondary)";
        onChange(value);
        document.body.removeChild(overlay);
      });
      list.appendChild(optRow);
    }
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) document.body.removeChild(overlay);
    });
  });

  return row;
}

export function openNewExerciseDialog(onSave) {
  let primary = null;
  let secondary = null;
  let recordType = "reps_weight";
  let isTwoSided = false;

  const { body, close } = openModal({ title: "New Exercise" });

  body.innerHTML = `
    <div class="section">
      <div class="section-title">Exercise</div>
      <input type="text" id="ex-name" placeholder="Exercise name" />
      <div id="ex-error" style="color:var(--color-danger);font-size:12px;min-height:16px;margin-top:4px;"></div>
    </div>
    <div class="section">
      <div class="section-title">Muscles</div>
      <div style="font-size:12px;color:var(--color-text-secondary);margin-bottom:4px;">Primary muscle</div>
      <div id="primary-slot" style="margin-bottom:10px;"></div>
      <div style="font-size:12px;color:var(--color-text-secondary);margin-bottom:4px;">Secondary muscle</div>
      <div id="secondary-slot"></div>
    </div>
    <div class="section">
      <div class="section-title">Tracking</div>
      <div style="font-size:12px;color:var(--color-text-secondary);margin-bottom:6px;">Record type</div>
      <div id="record-type-slot" style="margin-bottom:12px;"></div>
      <div style="font-size:12px;color:var(--color-text-secondary);margin-bottom:6px;">Logging</div>
      <div id="sided-slot"></div>
    </div>
    <button class="btn btn-primary" id="save-exercise" style="width:100%;margin-top:4px;">Save Exercise</button>
  `;

  body.querySelector("#primary-slot").appendChild(
    musclePickerRow("Select muscle", primary, db.MUSCLE_GROUPS, (v) => {
      primary = v;
      body.querySelector("#ex-error").textContent = "";
    })
  );
  body.querySelector("#secondary-slot").appendChild(
    musclePickerRow("None", secondary, [null, ...db.MUSCLE_GROUPS], (v) => {
      secondary = v;
    })
  );
  body.querySelector("#record-type-slot").appendChild(
    chipRow(RECORD_TYPES, recordType, (v) => {
      recordType = v;
    })
  );
  body.querySelector("#sided-slot").appendChild(
    chipRow(
      [
        [false, "Single-sided"],
        [true, "Double-sided"],
      ],
      isTwoSided,
      (v) => {
        isTwoSided = v;
      }
    )
  );

  const nameInput = body.querySelector("#ex-name");
  nameInput.addEventListener("input", () => {
    body.querySelector("#ex-error").textContent = "";
  });

  body.querySelector("#save-exercise").addEventListener("click", async () => {
    const name = nameInput.value.trim();
    const errorEl = body.querySelector("#ex-error");
    if (!name) {
      errorEl.textContent = "Give the exercise a name.";
      return;
    }
    if (!primary) {
      errorEl.textContent = "Pick a primary muscle.";
      return;
    }
    if (db.listExercises(name).some((e) => e.name.toLowerCase() === name.toLowerCase())) {
      errorEl.textContent = `An exercise named "${name}" already exists.`;
      return;
    }
    const id = await db.addExercise({
      name,
      primaryMuscle: primary,
      secondaryMuscle: secondary,
      recordType,
      isTwoSided,
    });
    close();
    onSave(id, name);
  });
}
