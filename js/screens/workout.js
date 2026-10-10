import * as db from "../db.js";
import { confirmDialog, showToast } from "../ui.js";
import { openExercisePicker } from "../components/exercisePicker.js";
import { openRoutinePicker } from "../components/routinePicker.js";
import { openSessionSummaryDialog } from "../components/sessionSummaryDialog.js";
import * as drive from "../driveBackup.js";

const REST_SECONDS = 90;
const REST_TIMER_KEY = "endokalos-rest-timer-end"; // localStorage: an end timestamp (ms)
const LONG_WORKOUT_WARNING_SECONDS = 3600; // 1h

let sessionId = null;
let restTickHandle = null;
let sessionTickHandle = null;
let restTotalSeconds = REST_SECONDS;

export function hasUnfinishedSession() {
  return !!db.getUnfinishedSession();
}

function formatSeconds(totalSeconds) {
  totalSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function renderWorkout(container, { navigateTo }) {
  const unfinished = db.getUnfinishedSession();
  sessionId = unfinished ? unfinished.id : null;

  container.innerHTML = `
    <div class="row" style="margin-bottom: 4px;">
      <button class="icon-btn" id="go-home">←</button>
      <h1 style="margin: 0 0 0 4px;">Workout</h1>
      <div class="spacer"></div>
      <button class="btn-text" id="discard" style="display: none;">Discard</button>
    </div>
    <div id="session-timer" style="text-align:center;color:var(--color-text-secondary);font-weight:600;min-height:20px;margin-bottom:8px;"></div>
    <div id="rest-bar"></div>
    <div id="exercise-list"></div>
    <div id="empty-state" class="placeholder" style="display: none;">
      No exercises yet.<br />Tap "Add Exercise" to begin.
    </div>
    <div class="row" style="gap: 8px; margin-top: 12px;">
      <button class="btn btn-secondary" style="flex: 1;" id="add-exercise">+ Exercise</button>
      <button class="btn btn-secondary" id="add-routine" style="width:48px;">▤</button>
      <button class="btn btn-primary" style="flex: 1;" id="finish-workout" disabled>Finish</button>
    </div>
  `;

  container.querySelector("#go-home").addEventListener("click", () => navigateTo("home"));
  container.querySelector("#add-exercise").addEventListener("click", () => openPicker(container));
  container.querySelector("#add-routine").addEventListener("click", () => openRoutinePickerForWorkout(container));
  container.querySelector("#finish-workout").addEventListener("click", () => finishWorkout(container, navigateTo));
  container.querySelector("#discard").addEventListener("click", () => discardWorkout(container, navigateTo));

  renderExerciseList(container);
  renderRestBar(container);
  startSessionTimer(container);

  // Stops the UI-only interval timers (session clock, rest countdown) when
  // navigating away. The underlying session/rest-timer state is untouched --
  // it's all timestamp-based (see below) so it just picks back up correctly
  // next time this screen renders, same as after a reload.
  return () => {
    stopSessionTimer();
    if (restTickHandle) {
      clearInterval(restTickHandle);
      restTickHandle = null;
    }
  };
}

async function ensureSession() {
  if (sessionId) return sessionId;
  sessionId = await db.createSession();
  return sessionId;
}

// --- session elapsed timer: timestamp-based, same bug-avoidance pattern as
// the rest timer below -- always recomputed from the session's real
// started_at rather than ticked in JS, so it reads correctly after a reload
// or a backgrounded tab instead of drifting or freezing. ---------------------

function startSessionTimer(container) {
  if (sessionTickHandle) {
    clearInterval(sessionTickHandle);
    sessionTickHandle = null;
  }
  const label = container.querySelector("#session-timer");

  const draw = () => {
    if (!sessionId) {
      label.textContent = "";
      return;
    }
    const session = db.getUnfinishedSession();
    if (!session) {
      label.textContent = "";
      return;
    }
    const elapsed = (Date.now() - new Date(session.started_at).getTime()) / 1000;
    label.textContent = formatSeconds(elapsed);
    label.style.color = elapsed >= LONG_WORKOUT_WARNING_SECONDS ? "var(--color-warning)" : "var(--color-text-secondary)";
  };

  draw();
  sessionTickHandle = setInterval(draw, 1000);
}

function stopSessionTimer() {
  if (sessionTickHandle) {
    clearInterval(sessionTickHandle);
    sessionTickHandle = null;
  }
}

function renderExerciseList(container) {
  const listEl = container.querySelector("#exercise-list");
  const emptyEl = container.querySelector("#empty-state");
  const finishBtn = container.querySelector("#finish-workout");
  const discardSlot = container.querySelector("#discard");

  const exercises = sessionId ? db.getSessionExercises(sessionId) : [];
  listEl.innerHTML = "";

  // Discard only needs an active session to make sense (bailing out of an
  // empty one you only just started) -- Finish is the one gated on having
  // something worth saving. Tying both to exercises.length meant an
  // accidentally-started empty session, especially a RESUMED one from a
  // previous visit, had no way out of the screen at all.
  if (discardSlot) discardSlot.style.display = sessionId ? "inline-block" : "none";

  if (!exercises.length) {
    emptyEl.style.display = "block";
    finishBtn.disabled = true;
    return;
  }
  emptyEl.style.display = "none";
  finishBtn.disabled = false;

  for (const ex of exercises) {
    listEl.appendChild(buildExerciseCard(container, ex));
  }
}

function buildExerciseCard(container, ex) {
  const card = document.createElement("div");
  card.className = "card";

  const sets = db.getSets(ex.id);
  const previous = db.lastCompletedSet(ex.exercise_id);
  const previousText = previous
    ? ex.record_type === "duration"
      ? `${previous.duration_seconds || 0}s`
      : ex.record_type === "reps_only"
      ? `${previous.reps || 0} reps`
      : `${previous.weight || 0}kg x ${previous.reps || 0}`
    : "-";

  const sideBadge = ex.is_two_sided ? '<span class="badge">PER SIDE</span>' : "";

  card.innerHTML = `
    <div class="row" style="margin-bottom: 4px;">
      <strong style="flex:1;">${ex.name}</strong> ${sideBadge}
      <button class="icon-btn sm danger" data-action="remove-exercise">🗑</button>
    </div>
    <button class="btn-text" data-action="toggle-mode" style="padding:2px 0;font-size:12px;">${ex.mode ? ex.mode : "+ Add Mode"}</button>
    <div class="mode-slot" style="display:none;margin-bottom:6px;">
      <input type="text" placeholder="Mode (e.g. Dumbbell)" data-field="mode" value="${ex.mode || ""}" />
    </div>
    <div class="sets" style="margin-top:4px;"></div>
    <button class="btn-text" data-action="add-set">+ Add Set</button>
    <input type="text" placeholder="Note (optional)" data-field="notes" value="${ex.exercise_notes || ""}" style="margin-top:8px;" />
  `;

  const setsEl = card.querySelector(".sets");
  for (const s of sets) {
    setsEl.appendChild(buildSetRow(container, ex, s, previousText, sets.length));
  }

  card.querySelector('[data-action="add-set"]').addEventListener("click", async () => {
    await db.addSet(ex.id, {});
    renderExerciseList(container);
  });

  card.querySelector('[data-action="remove-exercise"]').addEventListener("click", async () => {
    await db.deleteSessionExercise(ex.id);
    renderExerciseList(container);
  });

  const modeSlot = card.querySelector(".mode-slot");
  const modeToggle = card.querySelector('[data-action="toggle-mode"]');
  modeToggle.addEventListener("click", () => {
    modeSlot.style.display = modeSlot.style.display === "none" ? "block" : "none";
    if (modeSlot.style.display === "block") modeSlot.querySelector("input").focus();
  });
  const modeInput = card.querySelector('[data-field="mode"]');
  modeInput.addEventListener("change", async () => {
    await db.updateSessionExerciseMode(ex.id, modeInput.value.trim());
    modeToggle.textContent = modeInput.value.trim() || "+ Add Mode";
  });

  const notesInput = card.querySelector('[data-field="notes"]');
  notesInput.addEventListener("change", async () => {
    await db.updateExerciseNotes(ex.exercise_id, notesInput.value.trim());
  });

  return card;
}

function buildSetRow(container, ex, setRow, previousText, totalSets) {
  const row = document.createElement("div");
  row.className = "row";
  row.style.marginBottom = "6px";

  let inputsHtml = "";
  if (ex.record_type === "duration") {
    inputsHtml = `<input type="number" placeholder="sec" value="${setRow.duration_seconds ?? ""}" data-field="durationSeconds" style="width: 70px;" />`;
  } else if (ex.record_type === "reps_only") {
    inputsHtml = `<input type="number" placeholder="reps" value="${setRow.reps ?? ""}" data-field="reps" style="width: 70px;" />`;
  } else {
    inputsHtml = `
      <input type="number" placeholder="${ex.is_two_sided ? "kg/side" : "kg"}" value="${setRow.weight ?? ""}" data-field="weight" style="width: 70px;" />
      <input type="number" placeholder="reps" value="${setRow.reps ?? ""}" data-field="reps" style="width: 60px;" />
    `;
  }

  row.innerHTML = `
    <span style="width: 18px; color: var(--color-text-secondary); font-size: 12px;">${setRow.set_number}</span>
    <span style="width: 60px; color: var(--color-text-secondary); font-size: 12px;">${previousText}</span>
    ${inputsHtml}
    <button data-action="complete" style="border:none;background:none;font-size:20px;cursor:pointer;color:${
      setRow.completed ? "var(--color-success)" : "var(--color-text-secondary)"
    };">${setRow.completed ? "✓" : "○"}</button>
    <button data-action="delete" ${totalSets <= 1 ? "disabled style=\"opacity:0.3;\"" : ""} style="border:none;background:none;font-size:16px;cursor:pointer;color:var(--color-text-secondary);">✕</button>
  `;

  for (const input of row.querySelectorAll("input")) {
    input.addEventListener("change", async () => {
      const field = input.dataset.field;
      const value = input.value === "" ? null : Number(input.value);
      await db.updateSet(setRow.id, { [field]: value });
    });
  }

  row.querySelector('[data-action="complete"]').addEventListener("click", async () => {
    const nowCompleted = !setRow.completed;
    await db.updateSet(setRow.id, { completed: nowCompleted });
    if (nowCompleted) startRestTimer(container);
    renderExerciseList(container);
  });

  const deleteBtn = row.querySelector('[data-action="delete"]');
  if (totalSets > 1) {
    deleteBtn.addEventListener("click", async () => {
      await db.deleteSet(setRow.id);
      renderExerciseList(container);
    });
  }

  return row;
}

// --- exercise / routine pickers ---------------------------------------------

function openPicker(container) {
  openExercisePicker({
    onSelect: async (exerciseId) => {
      const sid = await ensureSession();
      await db.addSessionExercise(sid, exerciseId);
      renderExerciseList(container);
      startSessionTimer(container);
    },
  });
}

function openRoutinePickerForWorkout(container) {
  openRoutinePicker(async (routineId) => {
    const exercises = db.getRoutineExercises(routineId);
    if (!exercises.length) {
      showToast("This routine has no exercises.", "warning");
      return;
    }
    const sid = await ensureSession();
    for (const exercise of exercises) {
      await db.addSessionExercise(sid, exercise.id);
    }
    renderExerciseList(container);
    startSessionTimer(container);
    showToast(`Added ${exercises.length} exercises`, "success");
  });
}

// --- rest timer: timestamp-based, survives backgrounding/reload -------------
// Bug-avoidance #1: never a decrementing counter. We store the real end
// timestamp and always recompute remaining = endTime - now(), so a
// suspended/backgrounded tab (or a full reload) just resumes correctly
// instead of the display freezing.

function startRestTimer(container) {
  const endTime = Date.now() + REST_SECONDS * 1000;
  restTotalSeconds = REST_SECONDS;
  localStorage.setItem(REST_TIMER_KEY, String(endTime));
  renderRestBar(container);
}

function adjustRestTimer(container, deltaSeconds) {
  const endTime = Number(localStorage.getItem(REST_TIMER_KEY) || 0);
  if (!endTime) return;
  const newEnd = Math.max(Date.now(), endTime + deltaSeconds * 1000);
  const newRemaining = Math.round((newEnd - Date.now()) / 1000);
  restTotalSeconds = Math.max(restTotalSeconds, newRemaining);
  localStorage.setItem(REST_TIMER_KEY, String(newEnd));
  renderRestBar(container);
}

function stopRestTimer(container) {
  localStorage.removeItem(REST_TIMER_KEY);
  if (restTickHandle) {
    clearInterval(restTickHandle);
    restTickHandle = null;
  }
  if (container && container.querySelector) renderRestBar(container);
}

function playRestDoneSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.4);
  } catch {
    // Audio unavailable (autoplay-blocked, no AudioContext, etc.) -- rest
    // timer completion is still visible on screen, so this is non-critical.
  }
}

function renderRestBar(container) {
  const barEl = container.querySelector("#rest-bar");
  if (!barEl) return;
  if (restTickHandle) {
    clearInterval(restTickHandle);
    restTickHandle = null;
  }

  const endTime = Number(localStorage.getItem(REST_TIMER_KEY) || 0);
  const remaining = Math.round((endTime - Date.now()) / 1000);

  if (!endTime || remaining <= 0) {
    if (endTime) localStorage.removeItem(REST_TIMER_KEY);
    barEl.innerHTML = "";
    return;
  }

  // Built once; each tick only patches the label text and bar width below,
  // instead of replacing the whole subtree -- rebuilding (and re-binding
  // click listeners) every second made the ±15/skip buttons a moving target
  // for any click whose mousedown-to-mouseup straddled a redraw.
  barEl.innerHTML = `
    <div class="card" style="background: var(--color-light-cyan); padding: 10px 12px;">
      <div class="row" style="align-items: center;">
        <button class="icon-btn sm" id="rest-minus" style="width:auto;padding:0 10px;border-radius:999px;">−15</button>
        <div class="spacer"></div>
        <span id="rest-label" style="font-weight:700;font-size:18px;"></span>
        <div class="spacer"></div>
        <button class="icon-btn sm" id="rest-plus" style="width:auto;padding:0 10px;border-radius:999px;">+15</button>
        <button class="icon-btn sm" id="skip-rest">✕</button>
      </div>
      <div style="height:4px;background:var(--color-border);border-radius:2px;margin-top:8px;overflow:hidden;">
        <div id="rest-fill" style="height:100%;width:0%;background:var(--color-primary);transition:width 1s linear;"></div>
      </div>
    </div>
  `;
  barEl.querySelector("#rest-minus").addEventListener("click", () => adjustRestTimer(container, -15));
  barEl.querySelector("#rest-plus").addEventListener("click", () => adjustRestTimer(container, 15));
  barEl.querySelector("#skip-rest").addEventListener("click", () => stopRestTimer(container));

  const label = barEl.querySelector("#rest-label");
  const fill = barEl.querySelector("#rest-fill");

  const draw = () => {
    const secs = Math.max(0, Math.round((endTime - Date.now()) / 1000));
    if (secs <= 0) {
      stopRestTimer(container);
      playRestDoneSound();
      return;
    }
    const fraction = Math.max(0, Math.min(1, secs / restTotalSeconds));
    label.textContent = formatSeconds(secs);
    fill.style.width = `${(fraction * 100).toFixed(0)}%`;
  };

  draw();
  restTickHandle = setInterval(draw, 1000);
}

// --- finish / discard ---------------------------------------------------------

function finishWorkout(container, navigateTo) {
  if (!sessionId) return;
  const session = db.getUnfinishedSession();
  const elapsed = session ? (Date.now() - new Date(session.started_at).getTime()) / 1000 : 0;

  openSessionSummaryDialog(elapsed, async (selectedDate, durationSeconds) => {
    const finishedAt = new Date(selectedDate);
    const now = new Date();
    finishedAt.setHours(now.getHours(), now.getMinutes(), now.getSeconds());
    const startedAt = new Date(finishedAt.getTime() - durationSeconds * 1000);

    await db.finishSession(sessionId, {
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
    });
    resetSessionState(container);
    navigateTo("home");
    showToast("Workout saved", "success");

    // Best-effort, silent -- a failed background backup shouldn't interrupt
    // or alarm the user right after a successful save. They can always
    // retry from Home, where a real failure would also show up.
    if (drive.isConnected()) {
      drive.backupNow(db.exportBytes(), { interactive: false }).catch((err) => {
        console.warn("Drive auto-backup failed:", err);
      });
    }
  });
}

async function discardWorkout(container, navigateTo) {
  if (!sessionId) return;
  const ok = await confirmDialog({
    title: "Discard workout?",
    message: "This will delete everything logged in this session. This can't be undone.",
    confirmText: "Discard",
  });
  if (!ok) return;
  await db.deleteSession(sessionId);
  resetSessionState(container);
  navigateTo("home");
  showToast("Workout discarded");
}

function resetSessionState(container) {
  stopRestTimer(container);
  stopSessionTimer();
  sessionId = null;
}
