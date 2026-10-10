// Small shared UI helpers: toast notifications and a confirm dialog, used
// in place of native alert()/confirm() so the look matches the rest of the
// app and so it works even where native dialogs are unavailable/blocked.

let toastHost = null;

function ensureToastHost() {
  if (toastHost) return toastHost;
  toastHost = document.createElement("div");
  toastHost.id = "toast-host";
  toastHost.style.cssText =
    "position:fixed;left:50%;bottom:76px;transform:translateX(-50%);z-index:100;display:flex;flex-direction:column;gap:8px;align-items:center;pointer-events:none;width:100%;";
  document.body.appendChild(toastHost);
  return toastHost;
}

const TOAST_COLORS = {
  info: "var(--color-text)",
  success: "var(--color-success)",
  warning: "var(--color-warning)",
  error: "var(--color-danger)",
};

export function showToast(message, kind = "info") {
  const host = ensureToastHost();
  const el = document.createElement("div");
  el.textContent = message;
  el.style.cssText = `
    background: ${TOAST_COLORS[kind] || TOAST_COLORS.info};
    color: var(--color-on-primary);
    padding: 10px 18px;
    border-radius: var(--radius-md);
    font-size: 14px;
    font-weight: 600;
    box-shadow: 0 4px 12px rgba(0,0,0,0.2);
    opacity: 0;
    transition: opacity 0.2s, transform 0.2s;
    transform: translateY(8px);
    max-width: 90vw;
    text-align: center;
  `;
  host.appendChild(el);
  requestAnimationFrame(() => {
    el.style.opacity = "1";
    el.style.transform = "translateY(0)";
  });
  setTimeout(() => {
    el.style.opacity = "0";
    el.style.transform = "translateY(8px)";
    setTimeout(() => el.remove(), 200);
  }, 2200);
}

/** Returns a Promise<boolean> resolved true if the user confirms. */
export function confirmDialog({ title, message, confirmText = "Confirm", danger = true }) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.style.cssText =
      "position:fixed;inset:0;background:rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;z-index:50;padding:24px;";
    overlay.innerHTML = `
      <div style="background:var(--color-surface);width:100%;max-width:340px;border-radius:20px;padding:20px;">
        <h3 style="margin:0 0 8px;">${title}</h3>
        <p style="margin:0 0 18px;color:var(--color-text-secondary);font-size:14px;">${message}</p>
        <div class="row" style="justify-content:flex-end;gap:10px;">
          <button class="btn btn-text" id="confirm-cancel">Cancel</button>
          <button class="btn" id="confirm-ok" style="background:${
            danger ? "var(--color-danger)" : "var(--color-primary)"
          };color:var(--color-on-primary);">${confirmText}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const cleanup = (result) => {
      document.body.removeChild(overlay);
      resolve(result);
    };
    overlay.querySelector("#confirm-cancel").addEventListener("click", () => cleanup(false));
    overlay.querySelector("#confirm-ok").addEventListener("click", () => cleanup(true));
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) cleanup(false);
    });
  });
}

/** A generic bottom-sheet-style modal shell. Returns the overlay element;
 * caller fills `.querySelector(".modal-body")` and must remove the overlay
 * itself (e.g. via a close button) by calling the returned `close()`. */
export function openModal({ title, onClose } = {}) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.style.cssText =
    "position:fixed;inset:0;background:rgba(0,0,0,0.4);display:flex;align-items:flex-end;z-index:20;";
  overlay.innerHTML = `
    <div style="background:var(--color-surface);width:100%;max-height:85vh;border-radius:20px 20px 0 0;padding:16px;display:flex;flex-direction:column;">
      <div class="row" style="margin-bottom:10px;">
        <h3 style="margin:0;">${title || ""}</h3>
        <div class="spacer"></div>
        <button class="icon-btn" id="modal-close">✕</button>
      </div>
      <div class="modal-body" style="overflow-y:auto;"></div>
    </div>
  `;
  document.body.appendChild(overlay);
  const close = () => {
    if (overlay.parentNode) document.body.removeChild(overlay);
    if (onClose) onClose();
  };
  overlay.querySelector("#modal-close").addEventListener("click", close);
  return { overlay, body: overlay.querySelector(".modal-body"), close };
}
