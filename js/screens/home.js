import * as db from "../db.js";
import { confirmDialog, showToast } from "../ui.js";
import { hasUnfinishedSession } from "./workout.js";

function formatTime(totalSeconds) {
  const mins = Math.round(totalSeconds / 60);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

export function renderHome(container, { navigateTo }) {
  const stats = db.getWeekStats();
  const resuming = hasUnfinishedSession();

  container.innerHTML = `
    <h1>endokalos</h1>
    <p style="color: var(--color-text-secondary); margin-top: -4px;">Last 7 days</p>

    <div class="row" style="margin-bottom: 16px;">
      <div class="card" style="flex: 1;">
        <div class="section-title">Volume</div>
        <div style="font-size: 22px; font-weight: 700;">${Math.round(stats.volume)} kg</div>
      </div>
      <div class="card" style="flex: 1;">
        <div class="section-title">Workout time</div>
        <div style="font-size: 22px; font-weight: 700;">${formatTime(stats.timeSeconds)}</div>
      </div>
    </div>

    <button class="btn btn-primary" style="width: 100%; padding: 16px;" id="start-workout">
      ${resuming ? "Resume Workout" : "Start a New Workout"}
    </button>

    <div class="row" style="margin-top: 12px; gap: 12px;">
      <button class="btn btn-secondary" style="flex: 1;" id="go-nutrition">Nutrition</button>
      <button class="btn btn-secondary" style="flex: 1;" id="go-progress">Progress</button>
      <button class="btn btn-secondary" style="flex: 1;" id="go-routines">Routines</button>
    </div>

    <button class="btn-text" id="import-backup" style="display:block;margin:20px auto 0;">Import backup</button>
    <input type="file" id="import-file-input" accept=".db,.sqlite,.sqlite3" style="display:none;" />
  `;

  container.querySelector("#start-workout").addEventListener("click", () => navigateTo("workout"));
  container.querySelector("#go-nutrition").addEventListener("click", () => navigateTo("nutrition"));
  container.querySelector("#go-progress").addEventListener("click", () => navigateTo("progress"));
  container.querySelector("#go-routines").addEventListener("click", () => navigateTo("routines"));

  const fileInput = container.querySelector("#import-file-input");
  container.querySelector("#import-backup").addEventListener("click", async () => {
    const ok = await confirmDialog({
      title: "Import backup?",
      message: "This replaces everything currently in this app with the contents of the backup file. This can't be undone.",
      confirmText: "Choose File",
      danger: true,
    });
    if (ok) fileInput.click();
  });

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    fileInput.value = "";
    if (!file) return;
    try {
      const buffer = await file.arrayBuffer();
      await db.importDatabaseBackup(buffer);
      showToast("Backup imported", "success");
      navigateTo("home");
    } catch (err) {
      showToast(err.message || "Couldn't import that file.", "error");
    }
  });
}
