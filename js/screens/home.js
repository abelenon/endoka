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

/** Restore/Import both wipe the whole database, including any workout
 * mid-flight. Rather than just scaring the user with a confirm dialog they
 * might click through on autopilot, block the action outright while a
 * session is active and send them to resolve it first. Returns true if the
 * caller should stop (a toast was already shown). */
function blockIfUnfinishedSession(navigateTo) {
  if (!hasUnfinishedSession()) return false;
  showToast("Finish or discard your current workout first -- this would erase it.", "warning");
  navigateTo("workout");
  return true;
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
      <div class="section-title row" style="gap:6px;">
        <svg width="14" height="14" viewBox="0 0 18 18" aria-hidden="true">
          <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"/>
          <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z"/>
          <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/>
          <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/>
        </svg>
        <span>Drive Connection</span>
      </div>
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

    <div class="row" style="justify-content:center;gap:16px;margin-top:12px;">
      <button class="btn-text" id="import-backup" style="padding:0;">Import from file</button>
      <button class="btn-text" id="download-backup" style="padding:0;">Download local data</button>
    </div>
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
      const btn = e.currentTarget;
      // One try/catch around the whole flow -- including the unfinished-
      // session check -- so ANY failure shows up as a toast instead of the
      // click silently doing nothing with the real error only visible in
      // a console we may not have access to (e.g. on a phone).
      try {
        if (blockIfUnfinishedSession(navigateTo)) return;

        // Get Drive access as the very first thing, directly from this
        // click -- before the confirm dialog's own, separate click. A
        // popup requested after an intervening dialog click is too far
        // removed from "the" user gesture for Safari to reliably allow it.
        await drive.ensureAccessToken();

        const ok = await confirmDialog({
          title: "Restore from Drive?",
          message: "This replaces everything currently in this app with your latest Drive backup. This can't be undone.",
          confirmText: "Restore",
          danger: true,
        });
        if (!ok) return;

        btn.disabled = true;
        btn.textContent = "Restoring...";
        const bytes = await drive.fetchBackupBytes();
        await db.importDatabaseBackup(bytes);
        showToast("Restored from Drive", "success");
        navigateTo("home");
      } catch (err) {
        console.error("Restore from Drive failed:", err);
        showToast((err && err.message) || "Restore failed.", "error");
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
        // connect() only signs in and checks whether a backup already
        // exists -- it never silently pushes local data over it. That's
        // deliberate: a fresh browser/device's local data is usually
        // empty, and auto-backing-up on connect is exactly what
        // overwrote a real backup with nothing, twice, before this fix.
        const foundExisting = await drive.connect();

        if (foundExisting) {
          btn.disabled = false;
          btn.textContent = "Connect Drive";
          if (blockIfUnfinishedSession(navigateTo)) return;

          const restore = await confirmDialog({
            title: "Existing Drive backup found",
            message: "Restore it now? This replaces everything currently in this app. Skip this and your local data stays untouched.",
            confirmText: "Restore",
            danger: true,
          });
          if (restore) {
            btn.disabled = true;
            btn.textContent = "Restoring...";
            const bytes = await drive.fetchBackupBytes();
            await db.importDatabaseBackup(bytes);
            showToast("Connected and restored from Drive", "success");
          } else {
            showToast("Connected to Drive", "success");
          }
        } else {
          await drive.backupNow(db.exportBytes());
          showToast("Connected and backed up", "success");
        }
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
    try {
      if (blockIfUnfinishedSession(navigateTo)) return;
      const ok = await confirmDialog({
        title: "Import backup?",
        message: "This replaces everything currently in this app with the contents of the backup file. This can't be undone.",
        confirmText: "Choose File",
        danger: true,
      });
      if (ok) fileInput.click();
    } catch (err) {
      console.error("Import backup failed:", err);
      showToast((err && err.message) || "Couldn't start the import.", "error");
    }
  });

  // Non-destructive -- just a save-to-device of whatever's local right
  // now, separate from Drive entirely. Mainly here so "what does this
  // browser actually have locally" can be checked directly, independent
  // of whether Drive backup/restore have their own problems.
  container.querySelector("#download-backup").addEventListener("click", () => {
    const bytes = db.exportBytes();
    const blob = new Blob([bytes], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    a.download = `endokalos-local-${stamp}.db`;
    a.click();
    URL.revokeObjectURL(url);
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
