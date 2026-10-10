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

function requestAccessToken({ silent } = {}) {
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
    client.requestAccessToken({ prompt: silent ? "none" : "consent" });
  });
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
  await requestAccessToken({ silent: false });
  await backupNow(dbBytes);
}

/** Uploads the given SQLite bytes as the single rolling backup file --
 * updates the existing Drive file in place after the first call, rather
 * than creating a new one every time. */
export async function backupNow(dbBytes) {
  if (!accessToken) {
    await requestAccessToken({ silent: true });
  }

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
    await requestAccessToken({ silent: true });
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
  if (!accessToken) {
    await requestAccessToken({ silent: true });
  }

  let response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (response.status === 401) {
    accessToken = null;
    await requestAccessToken({ silent: true });
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
