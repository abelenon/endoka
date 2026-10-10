// Minimal inline-SVG line chart: points are [dateIso, value] pairs, x spaced
// evenly by index (not by real date gaps -- irrelevant here since callers
// already pass one point per day in the rolling-average series). `minSpan`
// keeps a near-flat series from being exaggerated into a huge visual swing.

const WIDTH = 320;
const HEIGHT = 160;
const PAD_LEFT = 38;
const PAD_RIGHT = 10;
const PAD_TOP = 14;
const PAD_BOTTOM = 14;

export function renderLineChart(container, points, options = {}) {
  const {
    color = "var(--color-primary)",
    yFormat = (v) => `${v.toFixed(0)}`,
    minSpan = 1,
    showPoints = true,
    showTrendArrow = false,
  } = options;

  if (!points || points.length === 0) {
    container.innerHTML = `<div class="placeholder" style="padding:24px;">No data yet.</div>`;
    return;
  }

  const values = points.map((p) => p[1]);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (max - min < minSpan) {
    const mid = (max + min) / 2;
    min = mid - minSpan / 2;
    max = mid + minSpan / 2;
  }
  const span = max - min || 1;

  const plotW = WIDTH - PAD_LEFT - PAD_RIGHT;
  const plotH = HEIGHT - PAD_TOP - PAD_BOTTOM;

  const xAt = (i) =>
    points.length === 1 ? PAD_LEFT + plotW / 2 : PAD_LEFT + (i / (points.length - 1)) * plotW;
  const yAt = (v) => PAD_TOP + (1 - (v - min) / span) * plotH;

  const pathD = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${xAt(i).toFixed(1)} ${yAt(p[1]).toFixed(1)}`)
    .join(" ");

  const pointsSvg = showPoints
    ? points
        .map((p, i) => `<circle cx="${xAt(i).toFixed(1)}" cy="${yAt(p[1]).toFixed(1)}" r="3" fill="${color}" />`)
        .join("")
    : "";

  let trendSvg = "";
  if (showTrendArrow && points.length >= 2) {
    const first = points[0][1];
    const last = points[points.length - 1][1];
    const isUp = last >= first;
    const arrowColor = isUp ? "var(--color-success)" : "var(--color-danger)";
    const lastX = xAt(points.length - 1);
    const lastY = yAt(last);
    trendSvg = `<text x="${lastX.toFixed(1)}" y="${(lastY - 8).toFixed(1)}" font-size="12" fill="${arrowColor}" text-anchor="middle">${
      isUp ? "▲" : "▼"
    }</text>`;
  }

  container.innerHTML = `
    <svg viewBox="0 0 ${WIDTH} ${HEIGHT}" style="width:100%;height:${HEIGHT}px;display:block;">
      <text x="2" y="${(PAD_TOP + 4).toFixed(1)}" font-size="10" fill="var(--color-text-secondary)">${yFormat(max)}</text>
      <text x="2" y="${(HEIGHT - PAD_BOTTOM + 2).toFixed(1)}" font-size="10" fill="var(--color-text-secondary)">${yFormat(min)}</text>
      <line x1="${PAD_LEFT}" y1="${PAD_TOP}" x2="${PAD_LEFT}" y2="${HEIGHT - PAD_BOTTOM}" stroke="var(--color-border)" stroke-width="1" />
      <path d="${pathD}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />
      ${pointsSvg}
      ${trendSvg}
    </svg>
  `;
}
