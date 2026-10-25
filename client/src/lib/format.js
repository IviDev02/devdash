const rtf = new Intl.RelativeTimeFormat("es", { numeric: "auto" });
const compact = new Intl.NumberFormat("es", { notation: "compact", maximumFractionDigits: 1 });

export function timeAgo(date, now = Date.now()) {
  const secs = Math.round((new Date(date).getTime() - now) / 1000);
  const abs = Math.abs(secs);
  if (abs < 60) return rtf.format(secs, "second");
  if (abs < 3600) return rtf.format(Math.round(secs / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(secs / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(secs / 86400), "day");
  if (abs < 86400 * 365) return rtf.format(Math.round(secs / (86400 * 30)), "month");
  return rtf.format(Math.round(secs / (86400 * 365)), "year");
}

export function formatNumber(n) {
  return n >= 10000 ? compact.format(n) : n.toLocaleString("es");
}

export function formatBytes(bytes, digits = 1) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** i;
  return `${value.toFixed(i === 0 || value >= 100 ? 0 : digits)} ${units[i]}`;
}

export const formatRate = (bytesPerSec) => `${formatBytes(bytesPerSec)}/s`;

export function formatPercent(n, digits = 1) {
  return `${n.toFixed(n >= 100 ? 0 : digits)}%`;
}

export function shortDate(iso) {
  return new Date(iso + "T00:00:00").toLocaleDateString("es", { day: "numeric", month: "short" });
}

export function clockTime(t) {
  return new Date(t).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

const UNITS = {
  second: ["s", "s"],
  minute: ["min", "min"],
  hour: ["h", "h"],
  day: ["día", "días"],
  week: ["semana", "semanas"],
  month: ["mes", "meses"],
  year: ["año", "años"],
};

function translateDuration(text) {
  if (/less than a second/i.test(text)) return "menos de 1 s";
  return text
    .replace(/^(about )?an? /i, "1 ")
    .replace(/(\d+) (second|minute|hour|day|week|month|year)s?/i, (_, n, unit) => `${n} ${UNITS[unit.toLowerCase()][n === "1" ? 0 : 1]}`);
}

const HEALTH = { healthy: " · sano", unhealthy: " · con fallos", "health: starting": " · arrancando", Paused: " · en pausa" };

// "Up 3 hours (healthy)" / "Exited (0) 2 days ago" de Docker, en castellano
export function translateStatus(status = "") {
  const up = status.match(/^Up (.+?)(?: \((healthy|unhealthy|health: starting|Paused)\))?$/);
  if (up) return `En marcha · ${translateDuration(up[1])}${HEALTH[up[2]] ?? ""}`;
  const exited = status.match(/^Exited \((\d+)\) (.+) ago$/);
  if (exited) return `Parado hace ${translateDuration(exited[2])}${exited[1] !== "0" ? ` · código ${exited[1]}` : ""}`;
  if (status === "Created") return "Creado";
  return status;
}

// Colores de lenguajes como los de GitHub
const LANG_COLORS = {
  JavaScript: "#f1e05a",
  TypeScript: "#3178c6",
  Python: "#3572A5",
  HTML: "#e34c26",
  CSS: "#663399",
  SCSS: "#c6538c",
  Java: "#b07219",
  "C#": "#178600",
  "C++": "#f34b7d",
  C: "#555555",
  Go: "#00ADD8",
  Rust: "#dea584",
  PHP: "#4F5D95",
  Ruby: "#701516",
  Shell: "#89e051",
  Dockerfile: "#384d54",
  Vue: "#41b883",
  Svelte: "#ff3e00",
  Kotlin: "#A97BFF",
  Swift: "#F05138",
  Dart: "#00B4AB",
  "Jupyter Notebook": "#DA5B0B",
};
const FALLBACK = ["#ff7a59", "#2dd4bf", "#a78bfa", "#60a5fa", "#f472b6", "#facc15"];

export function langColor(name, i = 0) {
  if (name === "Otros") return "#4b4b5e";
  return LANG_COLORS[name] ?? FALLBACK[i % FALLBACK.length];
}

// Colores de las gráficas (los atributos SVG no siempre resuelven var(--x))
export const CHART = {
  grid: "rgba(255, 255, 255, 0.06)",
  axis: "#8b8ba3",
  hover: "rgba(255, 255, 255, 0.04)",
  push: "#ff7a59",
  pr: "#2dd4bf",
  issue: "#a78bfa",
  other: "#5b5b72",
  series: ["#ff7a59", "#2dd4bf", "#a78bfa", "#60a5fa", "#f472b6", "#facc15"],
};
