// PDF export for nutrition logs, matching the old Kivy app's
// nutrition_export.py table layout (same columns, same teal header).
// jsPDF + its autotable plugin are loaded from a CDN on demand -- only
// when Export is actually clicked -- rather than on every page load, since
// most visits never touch this. That does mean this one feature needs a
// network connection, unlike the rest of the (offline-first) app.

const JSPDF_URL = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
const AUTOTABLE_URL =
  "https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js";

const PRIMARY_RGB = [33, 141, 174]; // --color-primary
const TEXT_RGB = [22, 50, 60]; // --color-text

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded) resolve();
      else existing.addEventListener("load", () => resolve());
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.onload = () => {
      script.dataset.loaded = "true";
      resolve();
    };
    script.onerror = () => reject(new Error("Couldn't load the PDF library -- check your connection."));
    document.head.appendChild(script);
  });
}

async function ensureJsPdf() {
  if (!window.jspdf) await loadScript(JSPDF_URL);
  if (!window.jspdf.jsPDF.API.autoTable) await loadScript(AUTOTABLE_URL);
}

function cellText(value, fmt) {
  return value != null ? fmt(value) : "-";
}

export async function exportNutritionPdf(logs) {
  await ensureJsPdf();
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "mm", format: "a4" });

  doc.setTextColor(...PRIMARY_RGB);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("Endokalos - Nutrition Logs", 14, 18);

  doc.setTextColor(...TEXT_RGB);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(`Exported ${new Date().toISOString().slice(0, 10)}`, 14, 25);

  const rows = logs.map((l) => [
    l.date,
    cellText(l.calories, (v) => `${Math.round(v)}`),
    cellText(l.protein, (v) => v.toFixed(2)),
    cellText(l.fat, (v) => v.toFixed(2)),
    cellText(l.weight, (v) => v.toFixed(2)),
  ]);

  doc.autoTable({
    startY: 32,
    head: [["Date", "Calories (kcal)", "Protein (g)", "Fat (g)", "Weight (kg)"]],
    body: rows.length ? rows : [["No nutrition logs yet.", "", "", "", ""]],
    styles: { fontSize: 9, textColor: TEXT_RGB },
    headStyles: { fillColor: PRIMARY_RGB, textColor: [255, 255, 255] },
    alternateRowStyles: { fillColor: [238, 251, 253] }, // --color-section-tint
  });

  doc.save(`endokalos_nutrition_logs_${new Date().toISOString().slice(0, 10)}.pdf`);
}
