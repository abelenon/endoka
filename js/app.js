import * as db from "./db.js";
import { renderHome } from "./screens/home.js";
import { renderWorkout, hasUnfinishedSession } from "./screens/workout.js";
import { renderNutrition } from "./screens/nutrition.js";
import { renderProgress } from "./screens/progress.js";
import { renderRoutines } from "./screens/routines.js";

const SCREENS = {
  home: { render: renderHome, label: "Home", icon: "home" },
  workout: { render: renderWorkout, label: "Workout", icon: "dumbbell" },
  nutrition: { render: renderNutrition, label: "Nutrition", icon: "food" },
  progress: { render: renderProgress, label: "Progress", icon: "chart" },
  routines: { render: renderRoutines, label: "Routines", icon: "list" },
};

const screenContainer = document.getElementById("screen");
const navContainer = document.getElementById("nav");

let currentScreen = "home";
let currentCleanup = null;

export function navigateTo(name) {
  if (!SCREENS[name]) return;
  if (currentCleanup) {
    currentCleanup();
    currentCleanup = null;
  }
  currentScreen = name;
  screenContainer.innerHTML = "";
  currentCleanup = SCREENS[name].render(screenContainer, { navigateTo }) || null;
  updateNavActiveState();
  window.scrollTo(0, 0);
}

function updateNavActiveState() {
  for (const btn of navContainer.querySelectorAll("[data-screen]")) {
    btn.classList.toggle("active", btn.dataset.screen === currentScreen);
  }
}

function buildNav() {
  navContainer.innerHTML = "";
  for (const [name, screen] of Object.entries(SCREENS)) {
    const btn = document.createElement("button");
    btn.className = "nav-item";
    btn.dataset.screen = name;
    btn.innerHTML = `<span class="nav-icon icon-${screen.icon}"></span><span class="nav-label">${screen.label}</span>`;
    btn.addEventListener("click", () => navigateTo(name));
    navContainer.appendChild(btn);
  }
}

async function main() {
  buildNav();
  await db.initDb();

  // Bug-avoidance: an in-progress workout survives a reload/restart because
  // every set/exercise write is persisted immediately (see db.js) -- so on
  // load we just check whether one is sitting there unfinished and, if so,
  // land straight on the Workout screen so it's obviously still there.
  const startScreen = hasUnfinishedSession() ? "workout" : "home";
  navigateTo(startScreen);
}

main();
