import * as db from "../db.js";
import { confirmDialog, showToast } from "../ui.js";
import * as drive from "../driveBackup.js";
import { hasUnfinishedSession } from "./workout.js";

function formatTime(totalSeconds) {
  const mins = Math.round(totalSeconds / 60);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function formatBackupTime(date) {
  if (!date) return "";
  const diffMs = Date.now() - date.getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function renderHome(container, { navigateTo }) {
  const stats = db.getWeekStats();
  const resuming = hasUnfinishedSession();
  const driveConnected = drive.isConnected();

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

    <div class="section" style="margin-top: 20px;">
      <div class="section-title">Backup</div>
      ${
        driveConnected
          ? `
            <div class="row">
              <div style="flex:1;">
                <div>Google Drive connected</div>
                <div style="color:var(--color-text-secondary);font-size:12px;" id="last-backup-text">
                  ${drive.lastBackupTime() ? `Last backup ${formatBackupTime(drive.lastBackupTime())}` : "Not backed up yet"}
                </div>
              </div>
              <button class="btn btn-secondary" id="backup-now">Back Up Now</button>
            </div>
            <div class="row" style="margin-top:8px;gap:16px;">
              <button class="btn-text" id="restore-drive" style="padding:0;">Restore from Drive</button>
              <button class="btn-text" id="disconnect-drive" style="padding:0;">Disconnect</button>
            </div>
          `
          : `
            <div class="row">
              <div style="flex:1;color:var(--color-text-secondary);font-size:13px;">
                Automatically keep a copy of your data in Google Drive.
              </div>
              <button class="btn btn-secondary" id="connect-drive">Connect Drive</button>
            </div>
          `
      }
    </div>

    <button class="btn-text" id="import-backup" style="display:block;margin:12px auto 0;">Import from file</button>
    <input type="file" id="import-file-input" accept=".db,.sqlite,.sqlite3" style="display:none;" />
  `;

  container.querySelector("#start-workout").addEventListener("click", () => navigateTo("workout"));
  container.querySelector("#go-nutrition").addEventListener("click", () => navigateTo("nutrition"));
  container.querySelector("#go-progress").addEventListener("click", () => navigateTo("progress"));
  container.querySelector("#go-routines").addEventListener("click", () => navigateTo("routines"));

  if (driveConnected) {
    container.querySelector("#backup-now").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = "Backing up...";
      try {
        await drive.backupNow(db.exportBytes());
        showToast("Backed up to Drive", "success");
        navigateTo("home");
      } catch (err) {
        showToast(err.message || "Backup failed.", "error");
        btn.disabled = false;
        btn.textContent = "Back Up Now";
      }
    });

    container.querySelector("#restore-drive").addEventListener("click", async (e) => {
      const ok = await confirmDialog({
        title: "Restore from Drive?",
        message: "This replaces everything currently in this app with your latest Drive backup. This can't be undone.",
        confirmText: "Restore",
        danger: true,
      });
      if (!ok) return;

      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = "Restoring...";
      try {
        const bytes = await drive.fetchBackupBytes();
        await db.importDatabaseBackup(bytes);
        showToast("Restored from Drive", "success");
        navigateTo("home");
      } catch (err) {
        showToast(err.message || "Restore failed.", "error");
        btn.disabled = false;
        btn.textContent = "Restore from Drive";
      }
    });

    container.querySelector("#disconnect-drive").addEventListener("click", async () => {
      const ok = await confirmDialog({
        title: "Disconnect Google Drive?",
        message: "Stops automatic backups. Your existing backup file in Drive is left as-is.",
        confirmText: "Disconnect",
      });
      if (!ok) return;
      drive.disconnect();
      navigateTo("home");
    });
  } else {
    container.querySelector("#connect-drive").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = "Connecting...";
      try {
        await drive.connectAndBackup(db.exportBytes());
        showToast("Connected and backed up", "success");
        navigateTo("home");
      } catch (err) {
        showToast(err.message || "Couldn't connect to Drive.", "error");
        btn.disabled = false;
        btn.textContent = "Connect Drive";
      }
    });
  }

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
