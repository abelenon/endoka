// Cache-first app shell so the PWA works fully offline after first load.
// Bump CACHE_NAME whenever any cached file changes so clients pick up the
// new version instead of serving stale files forever.
const CACHE_NAME = "endokalos-shell-v6";

const SHELL_FILES = [
  "./",
  "index.html",
  "manifest.json",
  "css/theme.css",
  "css/app.css",
  "js/app.js",
  "js/db.js",
  "js/ui.js",
  "js/driveBackup.js",
  "js/nutritionExport.js",
  "js/screens/home.js",
  "js/screens/workout.js",
  "js/screens/nutrition.js",
  "js/screens/progress.js",
  "js/screens/routines.js",
  "js/components/lineChart.js",
  "js/components/exerciseDetail.js",
  "js/components/exercisePicker.js",
  "js/components/newExerciseDialog.js",
  "js/components/newRoutineDialog.js",
  "js/components/routinePicker.js",
  "js/components/sessionSummaryDialog.js",
  "js/components/workoutDetail.js",
  "js/components/monthCalendar.js",
  "js/vendor/sql-wasm.js",
  "js/vendor/sql-wasm.wasm",
  "assets/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
