// Data layer: SQLite-in-the-browser via sql.js (WASM), persisted to
// IndexedDB after every write. Schema and query shapes are ported from
// kt/db.py to keep the same semantics -- same tables, same columns, same
// aggregation logic -- even though nothing here calls into Python.
//
// Bug-avoidance (see plan): every mutating function here persists to
// IndexedDB immediately, in the same call, rather than batching writes and
// flushing only when a workout is "finished". That's what makes an
// in-progress workout survive an app restart instead of vanishing.

const DB_STORE_NAME = "endokalos-db";
const DB_STORE_KEY = "sqlite-bytes";

const DEFAULT_EXERCISES = [
  ["Bench Press", "Chest", "Triceps"],
  ["Incline Bench Press", "Chest", "Shoulders"],
  ["Push Up", "Chest", "Triceps"],
  ["Dip", "Chest", "Triceps"],
  ["Squat", "Legs", "Core"],
  ["Deadlift", "Back", "Legs"],
  ["Romanian Deadlift", "Legs", "Back"],
  ["Leg Press", "Legs", null],
  ["Leg Extension", "Legs", null],
  ["Leg Curl", "Legs", null],
  ["Calf Raise", "Legs", null],
  ["Hip Thrust", "Legs", "Core"],
  ["Overhead Press", "Shoulders", "Triceps"],
  ["Dumbbell Shoulder Press", "Shoulders", "Triceps"],
  ["Lateral Raise", "Shoulders", null],
  ["Face Pull", "Shoulders", "Back"],
  ["Barbell Row", "Back", "Biceps"],
  ["Seated Row", "Back", "Biceps"],
  ["Lat Pulldown", "Back", "Biceps"],
  ["Pull Up", "Back", "Biceps"],
  ["Chin Up", "Back", "Biceps"],
  ["Bicep Curl", "Biceps", "Forearms"],
  ["Hammer Curl", "Biceps", "Forearms"],
  ["Tricep Pushdown", "Triceps", null],
  ["Tricep Extension", "Triceps", null],
  ["Plank", "Core", null],
  ["Crunch", "Core", null],
];

export const MUSCLE_GROUPS = [
  "Chest",
  "Back",
  "Legs",
  "Shoulders",
  "Biceps",
  "Triceps",
  "Forearms",
  "Core",
];

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS exercises (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    primary_muscle TEXT NOT NULL DEFAULT '',
    secondary_muscle TEXT,
    record_type TEXT NOT NULL DEFAULT 'reps_weight',
    is_two_sided INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    is_custom INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at TEXT NOT NULL,
    finished_at TEXT
  );

  CREATE TABLE IF NOT EXISTS session_exercises (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    exercise_id INTEGER NOT NULL REFERENCES exercises(id),
    position INTEGER NOT NULL,
    notes TEXT,
    mode TEXT
  );

  CREATE TABLE IF NOT EXISTS sets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_exercise_id INTEGER NOT NULL REFERENCES session_exercises(id) ON DELETE CASCADE,
    set_number INTEGER NOT NULL,
    reps INTEGER,
    weight REAL,
    duration_seconds INTEGER,
    completed INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS nutrition_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT UNIQUE NOT NULL,
    calories INTEGER,
    protein REAL,
    fat REAL,
    weight REAL
  );

  CREATE TABLE IF NOT EXISTS routines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS routine_exercises (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    routine_id INTEGER NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
    exercise_id INTEGER NOT NULL REFERENCES exercises(id),
    position INTEGER NOT NULL,
    UNIQUE(routine_id, exercise_id)
  );
`;

let SQL = null;
let db = null;

/** 'YYYY-MM-DD' for a Date in the viewer's LOCAL calendar day -- never
 * Date#toISOString().slice(0, 10), which reads the UTC day and silently
 * shifts dates near midnight in any non-UTC timezone (e.g. a nutrition log
 * saved for "today" showing up dated "yesterday" on the chart). */
function toLocalIsoDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// --- IndexedDB persistence (the raw sqlite file, as bytes) ---------------

function openMetaDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("endokalos-meta", 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(DB_STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function loadPersistedBytes() {
  const meta = await openMetaDb();
  return new Promise((resolve, reject) => {
    const tx = meta.transaction(DB_STORE_NAME, "readonly");
    const req = tx.objectStore(DB_STORE_NAME).get(DB_STORE_KEY);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

/** Raw SQLite file bytes for the current database -- used by the Drive
 * backup feature and the Export/Import flows, which all just move this
 * same byte array around rather than reading/writing individual rows. */
export function exportBytes() {
  return db.export();
}

export async function persist() {
  const bytes = db.export();
  const meta = await openMetaDb();
  return new Promise((resolve, reject) => {
    const tx = meta.transaction(DB_STORE_NAME, "readwrite");
    tx.objectStore(DB_STORE_NAME).put(bytes, DB_STORE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Replaces the entire database with the contents of an uploaded SQLite
 * file (e.g. a .db backup pulled from the old Kivy app's own storage --
 * same table/column shapes, so it loads directly). Overwrites everything
 * currently in this browser permanently once persisted. */
export async function importDatabaseBackup(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const candidate = new SQL.Database(bytes);

  const hasExercisesTable = candidate.exec(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='exercises'"
  );
  if (!hasExercisesTable.length) {
    candidate.close();
    throw new Error("That file doesn't look like an Endokalos database backup.");
  }

  candidate.run("PRAGMA foreign_keys = ON");
  candidate.run(SCHEMA_SQL); // CREATE TABLE IF NOT EXISTS -- fills in any tables an older backup predates.

  if (db) db.close();
  db = candidate;
  await persist();
}

// --- setup -----------------------------------------------------------------

export async function initDb() {
  SQL = await window.initSqlJs({
    locateFile: (file) => `js/vendor/${file}`,
  });

  const existingBytes = await loadPersistedBytes();
  db = existingBytes ? new SQL.Database(existingBytes) : new SQL.Database();

  // Off by default in SQLite -- without it, DELETE FROM sessions/
  // session_exercises would silently leave orphaned child rows instead of
  // cascading, since the ON DELETE CASCADE clauses in the schema below are
  // no-ops while this is off.
  db.run("PRAGMA foreign_keys = ON");
  db.run(SCHEMA_SQL);

  const isFresh = !existingBytes;
  if (isFresh) {
    const stmt = db.prepare(
      "INSERT INTO exercises (name, primary_muscle, secondary_muscle, is_custom) VALUES (?, ?, ?, 0)"
    );
    for (const row of DEFAULT_EXERCISES) {
      stmt.run(row);
    }
    stmt.free();
    await persist();
  }
}

// --- generic query helpers --------------------------------------------------

function queryAll(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function queryOne(sql, params = []) {
  const rows = queryAll(sql, params);
  return rows.length ? rows[0] : null;
}

function run(sql, params = []) {
  db.run(sql, params);
  return db.exec("SELECT last_insert_rowid() AS id")[0].values[0][0];
}

// --- exercises ---------------------------------------------------------------

export function listExercises(search = "", muscleGroup = null) {
  let sql = "SELECT * FROM exercises WHERE 1=1";
  const params = [];
  if (search) {
    sql += " AND name LIKE ?";
    params.push(`%${search}%`);
  }
  if (muscleGroup) {
    sql += " AND (primary_muscle = ? OR secondary_muscle = ?)";
    params.push(muscleGroup, muscleGroup);
  }
  sql += " ORDER BY name";
  return queryAll(sql, params);
}

export function getExercise(id) {
  return queryOne("SELECT * FROM exercises WHERE id = ?", [id]);
}

export async function updateExerciseNotes(exerciseId, notes) {
  db.run("UPDATE exercises SET notes = ? WHERE id = ?", [notes || null, exerciseId]);
  await persist();
}

export async function addExercise({
  name,
  primaryMuscle,
  secondaryMuscle = null,
  recordType = "reps_weight",
  isTwoSided = false,
}) {
  const id = run(
    `INSERT INTO exercises (name, primary_muscle, secondary_muscle, record_type, is_two_sided, is_custom)
     VALUES (?, ?, ?, ?, ?, 1)`,
    [name.trim(), primaryMuscle, secondaryMuscle, recordType, isTwoSided ? 1 : 0]
  );
  await persist();
  return id;
}

export function lastCompletedSet(exerciseId) {
  return queryOne(
    `SELECT s.reps, s.weight, s.duration_seconds
     FROM sets s
     JOIN session_exercises se ON s.session_exercise_id = se.id
     JOIN sessions sess ON se.session_id = sess.id
     WHERE se.exercise_id = ? AND s.completed = 1 AND sess.finished_at IS NOT NULL
     ORDER BY sess.finished_at DESC, s.set_number DESC
     LIMIT 1`,
    [exerciseId]
  );
}

// --- workout sessions --------------------------------------------------------
// Every function below persists immediately -- see the module docstring.

export async function createSession() {
  const id = run("INSERT INTO sessions (started_at) VALUES (?)", [
    new Date().toISOString(),
  ]);
  await persist();
  return id;
}

/** The most recent session with no finished_at, if any -- used on app load
 * to offer resuming an in-progress workout instead of losing it. */
export function getUnfinishedSession() {
  return queryOne(
    "SELECT * FROM sessions WHERE finished_at IS NULL ORDER BY started_at DESC LIMIT 1"
  );
}

export async function addSessionExercise(sessionId, exerciseId, notes = null, mode = null) {
  const position = queryOne(
    "SELECT COALESCE(MAX(position), -1) + 1 AS next FROM session_exercises WHERE session_id = ?",
    [sessionId]
  ).next;
  const id = run(
    `INSERT INTO session_exercises (session_id, exercise_id, position, notes, mode)
     VALUES (?, ?, ?, ?, ?)`,
    [sessionId, exerciseId, position, notes, mode]
  );
  await persist();
  return id;
}

export function getSessionExercises(sessionId) {
  return queryAll(
    `SELECT se.id, se.notes, se.mode, e.id AS exercise_id, e.name, e.record_type, e.is_two_sided, e.notes AS exercise_notes
     FROM session_exercises se
     JOIN exercises e ON e.id = se.exercise_id
     WHERE se.session_id = ?
     ORDER BY se.position ASC`,
    [sessionId]
  );
}

export async function deleteSessionExercise(sessionExerciseId) {
  db.run("DELETE FROM session_exercises WHERE id = ?", [sessionExerciseId]);
  await persist();
}

export async function updateSessionExerciseMode(sessionExerciseId, mode) {
  db.run("UPDATE session_exercises SET mode = ? WHERE id = ?", [mode || null, sessionExerciseId]);
  await persist();
}

export function getSets(sessionExerciseId) {
  return queryAll(
    "SELECT * FROM sets WHERE session_exercise_id = ? ORDER BY set_number ASC",
    [sessionExerciseId]
  );
}

export async function addSet(sessionExerciseId, { reps = null, weight = null, durationSeconds = null } = {}) {
  const setNumber =
    queryOne(
      "SELECT COALESCE(MAX(set_number), 0) + 1 AS next FROM sets WHERE session_exercise_id = ?",
      [sessionExerciseId]
    ).next;
  const id = run(
    `INSERT INTO sets (session_exercise_id, set_number, reps, weight, duration_seconds, completed)
     VALUES (?, ?, ?, ?, ?, 0)`,
    [sessionExerciseId, setNumber, reps, weight, durationSeconds]
  );
  await persist();
  return id;
}

export async function updateSet(setId, { reps, weight, durationSeconds, completed }) {
  const fields = [];
  const params = [];
  if (reps !== undefined) {
    fields.push("reps = ?");
    params.push(reps);
  }
  if (weight !== undefined) {
    fields.push("weight = ?");
    params.push(weight);
  }
  if (durationSeconds !== undefined) {
    fields.push("duration_seconds = ?");
    params.push(durationSeconds);
  }
  if (completed !== undefined) {
    fields.push("completed = ?");
    params.push(completed ? 1 : 0);
  }
  if (!fields.length) return;
  params.push(setId);
  db.run(`UPDATE sets SET ${fields.join(", ")} WHERE id = ?`, params);
  await persist();
}

export async function deleteSet(setId) {
  db.run("DELETE FROM sets WHERE id = ?", [setId]);
  await persist();
}

export async function finishSession(sessionId, { startedAt, finishedAt } = {}) {
  const finished = finishedAt || new Date().toISOString();
  if (startedAt) {
    db.run("UPDATE sessions SET started_at = ?, finished_at = ? WHERE id = ?", [
      startedAt,
      finished,
      sessionId,
    ]);
  } else {
    db.run("UPDATE sessions SET finished_at = ? WHERE id = ?", [finished, sessionId]);
  }
  await persist();
}

export async function deleteSession(sessionId) {
  db.run("DELETE FROM sessions WHERE id = ?", [sessionId]);
  await persist();
}

// --- home/progress stats (basic slice for now) --------------------------------

/** The rolling 7-day window ending on `d` (inclusive), e.g. today back
 * through 6 days ago -- not a Mon-Sun calendar week, so it always reflects
 * "the last 7 days" rather than resetting to near-empty every Monday. */
function rollingWeekBounds(d) {
  const end = new Date(d);
  const start = new Date(d);
  start.setDate(start.getDate() - 6);
  return [start, end];
}

function volumeAndTimeSeconds(start, end) {
  const sessions = queryAll(
    `SELECT id, started_at, finished_at FROM sessions
     WHERE finished_at IS NOT NULL
       AND date(finished_at) >= date(?) AND date(finished_at) <= date(?)`,
    [toLocalIsoDate(start), toLocalIsoDate(end)]
  );

  let totalSeconds = 0;
  for (const sess of sessions) {
    totalSeconds += (new Date(sess.finished_at) - new Date(sess.started_at)) / 1000;
  }

  let volume = 0;
  if (sessions.length) {
    const placeholders = sessions.map(() => "?").join(",");
    const rows = queryAll(
      `SELECT s.weight, s.reps, e.is_two_sided
       FROM sets s
       JOIN session_exercises se ON s.session_exercise_id = se.id
       JOIN exercises e ON se.exercise_id = e.id
       WHERE se.session_id IN (${placeholders}) AND s.completed = 1`,
      sessions.map((s) => s.id)
    );
    for (const row of rows) {
      if (row.weight != null && row.reps != null) {
        const sides = row.is_two_sided ? 2 : 1;
        volume += row.weight * row.reps * sides;
      }
    }
  }
  return { volume, totalSeconds };
}

function pctChange(newVal, oldVal) {
  if (oldVal <= 0) return null;
  return ((newVal - oldVal) / oldVal) * 100;
}

export function getWeekStats(referenceDate = new Date()) {
  const [thisStart, thisEnd] = rollingWeekBounds(referenceDate);
  const lastRef = new Date(referenceDate);
  lastRef.setDate(lastRef.getDate() - 7);
  const [lastStart, lastEnd] = rollingWeekBounds(lastRef);

  const thisWeek = volumeAndTimeSeconds(thisStart, thisEnd);
  const lastWeek = volumeAndTimeSeconds(lastStart, lastEnd);

  return {
    weekStart: thisStart,
    weekEnd: thisEnd,
    volume: thisWeek.volume,
    volumePctChange: pctChange(thisWeek.volume, lastWeek.volume),
    timeSeconds: thisWeek.totalSeconds,
    timePctChange: pctChange(thisWeek.totalSeconds, lastWeek.totalSeconds),
  };
}

// --- routines ------------------------------------------------------------

export async function createRoutine(name) {
  const id = run("INSERT INTO routines (name, created_at) VALUES (?, ?)", [
    name.trim(),
    new Date().toISOString(),
  ]);
  await persist();
  return id;
}

export async function deleteRoutine(routineId) {
  db.run("DELETE FROM routines WHERE id = ?", [routineId]);
  await persist();
}

export function listRoutines() {
  return queryAll(
    `SELECT r.id, r.name, COUNT(re.id) AS exercise_count
     FROM routines r
     LEFT JOIN routine_exercises re ON re.routine_id = r.id
     GROUP BY r.id
     ORDER BY r.name`
  );
}

export function getRoutineExercises(routineId) {
  return queryAll(
    `SELECT e.id, e.name, e.primary_muscle, e.secondary_muscle, e.record_type
     FROM routine_exercises re
     JOIN exercises e ON e.id = re.exercise_id
     WHERE re.routine_id = ?
     ORDER BY re.position ASC`,
    [routineId]
  );
}

export async function addRoutineExercise(routineId, exerciseId) {
  const nextPosition = queryOne(
    "SELECT COALESCE(MAX(position), -1) + 1 AS next FROM routine_exercises WHERE routine_id = ?",
    [routineId]
  ).next;
  db.run(
    "INSERT OR IGNORE INTO routine_exercises (routine_id, exercise_id, position) VALUES (?, ?, ?)",
    [routineId, exerciseId, nextPosition]
  );
  await persist();
}

export async function removeRoutineExercise(routineId, exerciseId) {
  db.run("DELETE FROM routine_exercises WHERE routine_id = ? AND exercise_id = ?", [
    routineId,
    exerciseId,
  ]);
  await persist();
}

// --- exercise history / estimated-RM charting -----------------------------

/** [{date, notes, mode, sets: [[weight, reps, durationSeconds], ...]}, ...]
 * for completed sets, most recent day first. Multiple sessions on the same
 * calendar date are merged. */
export function getExerciseHistory(exerciseId) {
  const rows = queryAll(
    `SELECT sess.finished_at, se.notes, se.mode, s.weight, s.reps, s.duration_seconds, s.set_number
     FROM sets s
     JOIN session_exercises se ON s.session_exercise_id = se.id
     JOIN sessions sess ON se.session_id = sess.id
     WHERE se.exercise_id = ? AND s.completed = 1 AND sess.finished_at IS NOT NULL
     ORDER BY sess.finished_at DESC, s.set_number ASC`,
    [exerciseId]
  );

  const history = [];
  const byDate = {};
  for (const row of rows) {
    const date = row.finished_at.slice(0, 10);
    if (!byDate[date]) {
      byDate[date] = { date, notes: row.notes, mode: row.mode, sets: [] };
      history.push(byDate[date]);
    }
    byDate[date].sets.push([row.weight, row.reps, row.duration_seconds]);
    if (row.notes && !byDate[date].notes) byDate[date].notes = row.notes;
    if (row.mode && !byDate[date].mode) byDate[date].mode = row.mode;
  }
  return history;
}

export function epley1RM(weight, reps) {
  if (!weight || !reps || weight <= 0 || reps <= 0) return 0;
  return weight * (1 + reps / 30);
}

export function epleyNRM(oneRm, n) {
  return oneRm / (1 + n / 30);
}

/** [[date, estimatedRm], ...] sorted oldest -> newest, for charting. */
export function getExerciseRmHistory(exerciseId, targetReps = 1) {
  const history = getExerciseHistory(exerciseId);
  const points = [];
  for (const entry of history) {
    let best1Rm = 0;
    for (const [weight, reps] of entry.sets) {
      best1Rm = Math.max(best1Rm, epley1RM(weight, reps));
    }
    if (best1Rm <= 0) continue;
    const value = targetReps === 1 ? best1Rm : epleyNRM(best1Rm, targetReps);
    points.push([entry.date, value]);
  }
  points.reverse();
  return points;
}

export function getExerciseDurationHistory(exerciseId) {
  const history = getExerciseHistory(exerciseId);
  const points = [];
  for (const entry of history) {
    const durations = entry.sets.map(([, , d]) => d).filter((d) => d);
    if (!durations.length) continue;
    points.push([entry.date, Math.max(...durations)]);
  }
  points.reverse();
  return points;
}

export function getExerciseRepsHistory(exerciseId) {
  const history = getExerciseHistory(exerciseId);
  const points = [];
  for (const entry of history) {
    const repsValues = entry.sets.map(([, r]) => r).filter((r) => r);
    if (!repsValues.length) continue;
    points.push([entry.date, Math.max(...repsValues)]);
  }
  points.reverse();
  return points;
}

// --- nutrition -------------------------------------------------------------

export function getNutritionLog(dateStr) {
  return queryOne("SELECT * FROM nutrition_logs WHERE date = ?", [dateStr]);
}

export async function saveNutritionLog(dateStr, calories, protein, fat = null, weight = null) {
  db.run(
    `INSERT INTO nutrition_logs (date, calories, protein, fat, weight)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(date) DO UPDATE SET
       calories = excluded.calories,
       protein = excluded.protein,
       fat = excluded.fat,
       weight = excluded.weight`,
    [dateStr, calories, protein, fat, weight]
  );
  await persist();
}

export function latestNutritionDate() {
  const row = queryOne("SELECT date FROM nutrition_logs ORDER BY date DESC LIMIT 1");
  return row ? row.date : null;
}

export function getAllNutritionLogs() {
  return queryAll(
    "SELECT date, calories, protein, fat, weight FROM nutrition_logs ORDER BY date ASC"
  );
}

export function getLatestWeight() {
  const row = queryOne(
    "SELECT weight, date FROM nutrition_logs WHERE weight IS NOT NULL ORDER BY date DESC LIMIT 1"
  );
  return row ? [row.weight, row.date] : [null, null];
}

/** points: [[Date, value], ...] sorted ascending (from all history up to
 * the range's end, so the average at the start of the range isn't dragged
 * down by a missing lookback window). Returns [[dateIso, avg], ...]
 * restricted to dates >= start. */
function rollingAverage(points, start, windowDays = 6) {
  const result = [];
  for (const [d] of points) {
    if (d < start) continue;
    const windowStart = new Date(d);
    windowStart.setDate(windowStart.getDate() - windowDays);
    const windowVals = points
      .filter(([wd]) => wd >= windowStart && wd <= d)
      .map(([, v]) => v);
    const avg = windowVals.reduce((a, b) => a + b, 0) / windowVals.length;
    result.push([toLocalIsoDate(d), avg]);
  }
  return result;
}

export function getNutritionChartSeries(startDate, endDate) {
  const calorieRows = queryAll(
    "SELECT date, calories FROM nutrition_logs WHERE calories IS NOT NULL AND date <= ? ORDER BY date ASC",
    [endDate]
  );
  const weightRows = queryAll(
    "SELECT date, weight FROM nutrition_logs WHERE weight IS NOT NULL AND date <= ? ORDER BY date ASC",
    [endDate]
  );

  const start = new Date(startDate + "T00:00:00");
  const caloriePoints = calorieRows.map((r) => [new Date(r.date + "T00:00:00"), r.calories]);
  const weightPoints = weightRows.map((r) => [new Date(r.date + "T00:00:00"), r.weight]);

  return {
    caloriesRolling: rollingAverage(caloriePoints, start),
    weightRolling: rollingAverage(weightPoints, start),
  };
}

// --- calendar / recent PRs / day detail -----------------------------------

export function getMonthCalendar(year, month) {
  const rows = queryAll(
    `SELECT finished_at FROM sessions
     WHERE finished_at IS NOT NULL
       AND strftime('%Y', finished_at) = ?
       AND strftime('%m', finished_at) = ?`,
    [String(year).padStart(4, "0"), String(month).padStart(2, "0")]
  );
  const days = new Set(rows.map((r) => Number(r.finished_at.slice(8, 10))));
  return { days, totalSessions: rows.length };
}

export function getSessionsOnDate(dateStr) {
  const sessions = queryAll(
    `SELECT id, started_at, finished_at FROM sessions
     WHERE finished_at IS NOT NULL AND date(finished_at) = date(?)
     ORDER BY started_at ASC`,
    [dateStr]
  );

  const result = [];
  for (const sess of sessions) {
    const exRows = queryAll(
      `SELECT se.id, se.notes, se.mode, e.name, e.record_type, e.is_two_sided
       FROM session_exercises se
       JOIN exercises e ON e.id = se.exercise_id
       WHERE se.session_id = ?
       ORDER BY se.position ASC`,
      [sess.id]
    );

    const exercises = exRows.map((ex) => ({
      name: ex.name,
      notes: ex.notes,
      mode: ex.mode,
      record_type: ex.record_type,
      is_two_sided: !!ex.is_two_sided,
      sets: queryAll(
        `SELECT set_number, weight, reps, duration_seconds, completed
         FROM sets WHERE session_exercise_id = ? ORDER BY set_number ASC`,
        [ex.id]
      ),
    }));

    result.push({
      sessionId: sess.id,
      startedAt: sess.started_at,
      finishedAt: sess.finished_at,
      exercises,
    });
  }
  return result;
}

/** [{exerciseId, name, prWeight, prReps, prRm, lastPerformed}, ...] for
 * exercises with a completed set in a session finished within the last
 * `months` months, sorted by most recently performed first. */
export function getRecentPRs(months = 3) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30 * months);
  const cutoffStr = toLocalIsoDate(cutoff);

  const rows = queryAll(
    `SELECT e.id AS exercise_id, e.name, s.weight, s.reps, sess.finished_at
     FROM sets s
     JOIN session_exercises se ON s.session_exercise_id = se.id
     JOIN sessions sess ON se.session_id = sess.id
     JOIN exercises e ON se.exercise_id = e.id
     WHERE s.completed = 1 AND sess.finished_at IS NOT NULL
       AND e.record_type = 'reps_weight'
       AND date(sess.finished_at) >= date(?)
     ORDER BY sess.finished_at DESC`,
    [cutoffStr]
  );

  const byExercise = {};
  const order = [];
  for (const row of rows) {
    const exId = row.exercise_id;
    const rm = epley1RM(row.weight, row.reps);
    let entry = byExercise[exId];
    if (!entry) {
      entry = {
        exerciseId: exId,
        name: row.name,
        prWeight: row.weight,
        prReps: row.reps,
        prRm: rm,
        lastPerformed: row.finished_at.slice(0, 10),
      };
      byExercise[exId] = entry;
      order.push(exId);
    } else if (rm > entry.prRm) {
      entry.prWeight = row.weight;
      entry.prReps = row.reps;
      entry.prRm = rm;
    }
  }

  const result = order.map((id) => byExercise[id]);
  result.sort((a, b) => (a.lastPerformed < b.lastPerformed ? 1 : -1));
  return result;
}
