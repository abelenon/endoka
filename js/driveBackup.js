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

/** Gets a usable access token: tries a silent (no popup) refresh first,
 * which works in Chrome via its existing Google session, then falls back
 * to an interactive popup if that fails or times out.
 *
 * The timeout matters specifically for Safari: its Intelligent Tracking
 * Prevention blocks the cross-site cookie check the silent flow relies on,
 * and the request can then just hang with no error ever firing -- so
 * "restore doesn't work on Safari" was this, not a caching issue. Falling
 * back after a few seconds, instead of waiting on a promise that may never
 * resolve, is what actually fixes it there. */
async function getAccessToken() {
  if (accessToken) return accessToken;
  try {
    return await withTimeout(requestAccessTokenRaw("none"), 3000, "silent token request timed out");
  } catch {
    return requestAccessTokenRaw(""); // adaptive -- shows a popup only if actually needed
  }
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
 * than creating a new one every time. */
export async function backupNow(dbBytes) {
  await getAccessToken();

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
    await getAccessToken();
    return backupNow(dbBytes);
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
 * Only meaningful once connected (there's a file id to fetch). */
export async function fetchBackupBytes() {
  const fileId = localStorage.getItem(DRIVE_FILE_ID_KEY);
  if (!fileId) {
    throw new Error("Not connected to Drive yet.");
  }
  await getAccessToken();

  let response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (response.status === 401) {
    accessToken = null;
    await getAccessToken();
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
