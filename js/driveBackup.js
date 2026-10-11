// Google Drive auto-backup. No server of ours involved -- this talks
// directly to Google's APIs from the browser using Google Identity
// Services' token-client flow (https://accounts.google.com/gsi/client,
// loaded in index.html), which needs only a public Client ID, never a
// secret. Scope is drive.file: the app can only see/write files it itself
// created, not your whole Drive.

const CLIENT_ID = "133471136054-trpet0ap1k1sicn74cvgoa6t443k4er6.apps.googleusercontent.com";
const SCOPE = "https://www.googleapis.com/auth/drive.file";
const BACKUP_FILENAME = "endokalos-backup.db";

// Whether THIS browser has ever connected -- just a local convenience flag
// for the UI ("show Connect vs show Back Up Now"), not the source of truth
// for which Drive file is the backup. See findBackupFileId() below for why
// that distinction matters.
const DRIVE_CONNECTED_KEY = "endokalos-drive-connected";
const LAST_BACKUP_KEY = "endokalos-drive-last-backup";

let tokenClient = null;
let accessToken = null; // in-memory only -- short-lived, never persisted

// Resolved by searching Drive (see findBackupFileId), cached in memory only
// for this page load -- never localStorage. Each browser/device used to
// cache its own file ID in localStorage, which meant two different
// browsers signed into the same Google account had no way of knowing they
// should be looking at the same file: each one just created its own on
// first connect, silently fragmenting into multiple backups. Searching
// Drive by filename instead means any browser, on any device, finds the
// one real file every time.
let cachedFileId = null;

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
 * it, specifically to stay inside the click's user-gesture window -- see
 * git history for why chaining a silent-then-popup fallback here broke
 * Safari specifically (the delay forfeits the gesture window). A generous
 * timeout is still here as a last-resort safety net, not the primary
 * mechanism. */
function getAccessTokenInteractive() {
  if (accessToken) return Promise.resolve(accessToken);
  return withTimeout(
    requestAccessTokenRaw(""),
    120000,
    "Drive sign-in timed out -- try again."
  );
}

/** Public wrapper so callers that need a Drive access token ahead of some
 * other UI (like a confirm dialog) can get one as the very first thing
 * they do on click -- see fetchBackupBytes's caller in home.js for why
 * that ordering specifically matters on Safari. */
export function ensureAccessToken() {
  return getAccessTokenInteractive();
}

/** Searches Drive (not localStorage) for the backup file by name, so any
 * browser/device finds the same one. If more than one exists -- leftover
 * from before this fix -- picks the most recently modified and leaves the
 * others alone rather than deleting anything automatically. */
async function findBackupFileId() {
  if (cachedFileId) return cachedFileId;
  const query = encodeURIComponent(`name='${BACKUP_FILENAME}' and trashed=false`);
  const orderBy = encodeURIComponent("modifiedTime desc");
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,modifiedTime)&orderBy=${orderBy}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!response.ok) {
    throw new Error(`Drive search failed (${response.status})`);
  }
  const data = await response.json();
  const files = data.files || [];
  // Sort client-side too, not just via the request's orderBy -- belt and
  // suspenders against exactly the kind of silent mis-ordering that sent
  // an older duplicate back instead of the newest one.
  files.sort((a, b) => new Date(b.modifiedTime) - new Date(a.modifiedTime));
  cachedFileId = files.length ? files[0].id : null;
  return cachedFileId;
}

export function isConnected() {
  return !!localStorage.getItem(DRIVE_CONNECTED_KEY);
}

export function lastBackupTime() {
  const iso = localStorage.getItem(LAST_BACKUP_KEY);
  return iso ? new Date(iso) : null;
}

/** Signs in and checks whether a backup already exists in Drive, but does
 * NOT decide what to do about it -- that's a UI decision (ask the user
 * whether to restore it), which belongs in home.js, not here. Returns
 * true if an existing backup was found. This replaces the old
 * connectAndBackup(), which always pushed local data up immediately --
 * exactly the mechanism that twice overwrote a real backup with an empty
 * local database on a fresh browser/device. */
export async function connect() {
  await requestAccessTokenRaw("consent");
  localStorage.setItem(DRIVE_CONNECTED_KEY, "true");
  const fileId = await findBackupFileId();
  return fileId != null;
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

  const fileId = await findBackupFileId();
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
  if (!fileId) cachedFileId = data.id;
  localStorage.setItem(DRIVE_CONNECTED_KEY, "true");
  localStorage.setItem(LAST_BACKUP_KEY, new Date().toISOString());
}

/** Downloads the current Drive backup file's bytes directly -- no file
 * picker, mirrors backupNow()'s "just talk to Drive" flow in reverse.
 * Always click-triggered (the Restore button), so always interactive. */
export async function fetchBackupBytes() {
  await getAccessTokenInteractive();
  const fileId = await findBackupFileId();
  if (!fileId) {
    throw new Error("No backup found in Drive yet.");
  }

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
  cachedFileId = null;
  localStorage.removeItem(DRIVE_CONNECTED_KEY);
  localStorage.removeItem(LAST_BACKUP_KEY);
}
