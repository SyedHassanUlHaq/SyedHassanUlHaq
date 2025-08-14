import fs from "fs/promises";

// Node 20 has fetch globally

function polarToCartesian(cx, cy, r, angleRad) {
  return [cx + r * Math.cos(angleRad), cy + r * Math.sin(angleRad)];
}

function buildPolygonPoints(languages, maxValue, cx, cy, radius) {
  const count = languages.length;
  return languages.map((lang, idx) => {
    const ratio = maxValue === 0 ? 0 : lang.value / maxValue;
    const r = radius * ratio;
    const angle = (-Math.PI / 2) + (2 * Math.PI * idx) / count;
    const [x, y] = polarToCartesian(cx, cy, r, angle);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
}

async function fetchWakatimeLanguages() {
  const wakatimeUsername = process.env.WAKATIME_USERNAME;
  const wakatimeApiKey = process.env.WAKATIME_API_KEY;
  if (!wakatimeUsername || !wakatimeApiKey) {
    return [];
  }
  const res = await fetch(`https://wakatime.com/api/v1/users/${wakatimeUsername}/stats/last_90_days?api_key=${wakatimeApiKey}`);
  if (!res.ok) return [];
  const data = await res.json();
  const langs = (data?.data?.languages || []).map(l => ({ name: l.name, value: l.total_seconds || 0 }));
  return langs;
}

async function main() {
  const rawLangs = await fetchWakatimeLanguages();
  if (!rawLangs.length) {
    await fs.writeFile("skill-radar.svg", `<svg xmlns='http://www.w3.org/2000/svg' width='500' height='380'><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' font-family='sans-serif' font-size='16'>No WakaTime data</text></svg>`);
    console.log("Wrote placeholder skill-radar.svg");
    return;
  }

  const top = rawLangs
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);

  const total = top.reduce((s, l) => s + l.value, 0);
  const maxValue = Math.max(...top.map(l => l.value));

  const width = 700;
  const height = 520;
  const cx = width / 2;
  const cy = height / 2 + 10;
  const radius = Math.min(width, height) * 0.32;

  const gridLevels = 5;
  const gridPolygons = [];
  for (let i = 1; i <= gridLevels; i++) {
    const r = (radius * i) / gridLevels;
    const points = buildPolygonPoints(
      top.map(t => ({ name: t.name, value: maxValue })),
      maxValue,
      cx,
      cy,
      r
    );
    gridPolygons.push(`<polygon points='${points}' fill='none' stroke='#3a2f3f' stroke-width='1' />`);
  }

  const dataPoints = buildPolygonPoints(top, maxValue, cx, cy, radius);

  const axes = top.map((lang, idx) => {
    const angle = (-Math.PI / 2) + (2 * Math.PI * idx) / top.length;
    const [x, y] = polarToCartesian(cx, cy, radius + 12, angle);
    return `<line x1='${cx}' y1='${cy}' x2='${x.toFixed(1)}' y2='${y.toFixed(1)}' stroke='#3a2f3f' stroke-width='1' />`;
  }).join("");

  const labels = top.map((lang, idx) => {
    const angle = (-Math.PI / 2) + (2 * Math.PI * idx) / top.length;
    const [x, y] = polarToCartesian(cx, cy, radius + 28, angle);
    const pct = ((lang.value / total) * 100).toFixed(1);
    return `<text x='${x.toFixed(1)}' y='${y.toFixed(1)}' text-anchor='middle' dominant-baseline='middle' font-family='Inter, ui-sans-serif, system-ui' font-size='12' fill='#C576F6'>${lang.name} (${pct}%)</text>`;
  }).join("");

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns='http://www.w3.org/2000/svg' width='${width}' height='${height}' viewBox='0 0 ${width} ${height}'>
  <defs>
    <radialGradient id='bg' cx='50%' cy='50%' r='75%'>
      <stop offset='0%' stop-color='#19000e' />
      <stop offset='100%' stop-color='#0f0009' />
    </radialGradient>
  </defs>
  <rect width='100%' height='100%' fill='url(#bg)'/>
  <g>
    ${gridPolygons.join("\n    ")}
    ${axes}
    <polygon points='${dataPoints}' fill='rgba(197,118,246,0.25)' stroke='#FB9F16' stroke-width='2' />
    ${labels}
  </g>
  <text x='50%' y='36' text-anchor='middle' font-family='Inter, ui-sans-serif, system-ui' font-size='20' fill='#fffffa'>Skill Radar (Last 90 Days)</text>
</svg>`;

  await fs.writeFile("skill-radar.svg", svg, "utf8");
  console.log("✅ Generated skill-radar.svg");
}

main().catch(err => {
  console.error("Failed to generate skill radar:", err);
  process.exit(1);
}); 