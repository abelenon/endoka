// Google Drive auto-backup. No server of ours involved -- this talks
// directly to Google's APIs from the browser using Google Identity
// Services' token-client flow (https://accounts.google.com/gsi/client,
// loaded in index.html), which needs only a public Client ID, never a
// secret. Scope is drive.file: the app can only see/write files it itself
// created, not your whole Drive.

const CLIENT_ID = "133471136054-trpet0ap1k1sicn74cvgoa6t443k4er6.apps.googleusercontent.com";
const SCOPE = "https://www.googleapis.com/auth/drive.file";
const BACKUP_FILENAME = "endokalos-backup.db";

const DRIVE_FILE_ID_KEY = "endokalos-drive-file-id";
const LAST_BACKUP_KEY = "endokalos-drive-last-backup";

let tokenClient = null;
let accessToken = null; // in-memory only -- short-lived, never persisted

function ensureTokenClient() {
  if (tokenClient) return tokenClient;
  if (!window.google || !window.google.accounts) {
    throw new Error("Google sign-in hasn't loaded yet -- check your connection and try again.");
  }
  tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPE,
    callback: () => {}, // overridden per-call below
  });
  return tokenClient;
}

function requestAccessTokenRaw(prompt) {
  return new Promise((resolve, reject) => {
    const client = ensureTokenClient();
    client.callback = (response) => {
      if (response.error) {
        reject(new Error(response.error));
        return;
      }
      accessToken = response.access_token;
      resolve(accessToken);
    };
    client.requestAccessToken({ prompt });
  });
}

function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

/** Background/automatic use only (the post-workout auto-backup) -- tries a
 * silent, no-popup refresh and just fails if that doesn't work. Never
 * falls back to an interactive popup itself: see getAccessTokenInteractive
 * for why chaining the two is actually broken, not just slow. */
function getAccessTokenSilent() {
  if (accessToken) return Promise.resolve(accessToken);
  return withTimeout(requestAccessTokenRaw("none"), 3000, "silent token request timed out");
}

/** Click-triggered use (Connect/Back Up Now/Restore) -- requests a token
 * with Google's adaptive prompt, which only shows a popup if actually
 * needed. Called directly, with no `await` (and so no real delay) before
 * it, specifically to stay inside the click's user-gesture window.
 *
 * Earlier this tried silent-first-with-a-timeout, then fell back to a
 * popup on failure. That's what caused "stuck on Backing up... forever"
 * on Safari: the few seconds spent waiting on the silent attempt used up
 * the user-gesture window, so by the time the interactive popup was
 * requested, Safari no longer considered it a direct result of the click
 * and silently blocked it -- no error, just an unresolved promise. Going
 * straight to the interactive request, synchronously-ish from the click,
 * keeps it inside that window so the popup is actually allowed to open.
 * A generous (not tiny) timeout is still here as a last-resort safety net
 * against a genuinely stuck popup, not as the primary mechanism. */
function getAccessTokenInteractive() {
  if (accessToken) return Promise.resolve(accessToken);
  return withTimeout(
    requestAccessTokenRaw(""),
    120000,
    "Drive sign-in timed out -- try again."
  );
}

export function isConnected() {
  return !!localStorage.getItem(DRIVE_FILE_ID_KEY);
}

export function lastBackupTime() {
  const iso = localStorage.getItem(LAST_BACKUP_KEY);
  return iso ? new Date(iso) : null;
}

/** First-time connect: asks the user to grant access, then does an
 * initial backup immediately so "Connect" and "it's actually backed up"
 * happen together instead of leaving a connected-but-never-backed-up gap. */
export async function connectAndBackup(dbBytes) {
  await requestAccessTokenRaw("consent");
  await backupNow(dbBytes);
}

/** Uploads the given SQLite bytes as the single rolling backup file --
 * updates the existing Drive file in place after the first call, rather
 * than creating a new one every time.
 *
 * `interactive: false` (used for the silent post-workout auto-backup) means
 * "don't ever pop up a sign-in window for this -- just skip it if a cached
 * token isn't available." `interactive: true` (the default, for the
 * Back Up Now button) means "this came from a click, a popup is fine." */
export async function backupNow(dbBytes, { interactive = true } = {}) {
  await (interactive ? getAccessTokenInteractive() : getAccessTokenSilent());

  const fileId = localStorage.getItem(DRIVE_FILE_ID_KEY);
  const blob = new Blob([dbBytes], { type: "application/octet-stream" });

  let response;
  if (fileId) {
    response = await fetch(
      `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/octet-stream",
        },
        body: blob,
      }
    );
  } else {
    const metadata = { name: BACKUP_FILENAME };
    const form = new FormData();
    form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
    form.append("file", blob);

    response = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        body: form,
      }
    );
  }

  if (response.status === 401) {
    // Token expired mid-session -- get a fresh one and retry once.
    accessToken = null;
    await (interactive ? getAccessTokenInteractive() : getAccessTokenSilent());
    return backupNow(dbBytes, { interactive });
  }
  if (!response.ok) {
    throw new Error(`Drive upload failed (${response.status})`);
  }

  const data = await response.json();
  if (!fileId) localStorage.setItem(DRIVE_FILE_ID_KEY, data.id);
  localStorage.setItem(LAST_BACKUP_KEY, new Date().toISOString());
}

/** Downloads the current Drive backup file's bytes directly -- no file
 * picker, mirrors backupNow()'s "just talk to Drive" flow in reverse.
 * Only meaningful once connected (there's a file id to fetch). Always
 * click-triggered (the Restore button), so always interactive. */
export async function fetchBackupBytes() {
  const fileId = localStorage.getItem(DRIVE_FILE_ID_KEY);
  if (!fileId) {
    throw new Error("Not connected to Drive yet.");
  }
  await getAccessTokenInteractive();

  let response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (response.status === 401) {
    accessToken = null;
    await getAccessTokenInteractive();
    response = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
  }
  if (!response.ok) {
    throw new Error(`Drive download failed (${response.status})`);
  }
  return response.arrayBuffer();
}

export function disconnect() {
  if (accessToken && window.google?.accounts?.oauth2?.revoke) {
    window.google.accounts.oauth2.revoke(accessToken, () => {});
  }
  accessToken = null;
  localStorage.removeItem(DRIVE_FILE_ID_KEY);
  localStorage.removeItem(LAST_BACKUP_KEY);
}
