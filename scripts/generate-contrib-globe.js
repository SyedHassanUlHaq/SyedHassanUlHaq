import fs from "fs/promises";

// GitHub Actions provides fetch in Node 20

const PURPLE = "#C576F6";
const ORANGE = "#FB9F16";
const BG_DARK = "#19000e";

async function fetchContributionCalendar(username, token) {
	if (!token) throw new Error("GITHUB_TOKEN is required to query GraphQL");
	const query = `
		query($login: String!) {
			user(login: $login) {
				contributionsCollection {
					contributionCalendar {
						totalContributions
						weeks {
							contributionDays { date contributionCount }
						}
					}
				}
			}
		}
	`;
	const res = await fetch("https://api.github.com/graphql", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"Authorization": `bearer ${token}`
		},
		body: JSON.stringify({ query, variables: { login: username } })
	});
	if (!res.ok) {
		const text = await res.text();
		throw new Error(`GraphQL error: ${res.status} ${text}`);
	}
	const json = await res.json();
	const weeks = json?.data?.user?.contributionsCollection?.contributionCalendar?.weeks || [];
	return weeks.map((w, wi) => w.contributionDays.map((d, di) => ({
		weekIndex: wi,
		dayIndex: new Date(d.date).getUTCDay(), // 0..6
		date: d.date,
		count: d.contributionCount
	}))).flat();
}

function lerp(a, b, t) {
	return a + (b - a) * t;
}

function colorForCount(count, maxCount) {
	if (count <= 0) return "rgba(0,0,0,0)";
	const t = Math.sqrt(Math.min(1, count / Math.max(1, maxCount)));
	// Interpolate between purple and orange for pop
	// Simple blend in RGB space
	const from = [197, 118, 246]; // PURPLE
	const to = [251, 159, 22]; // ORANGE
	const r = Math.round(lerp(from[0], to[0], t));
	const g = Math.round(lerp(from[1], to[1], t));
	const b = Math.round(lerp(from[2], to[2], t));
	return `rgb(${r},${g},${b})`;
}

function orthographicProject(lonDeg, latDeg, radius, cx, cy) {
	const lon = (lonDeg * Math.PI) / 180;
	const lat = (latDeg * Math.PI) / 180;
	const x = radius * Math.cos(lat) * Math.sin(lon);
	const y = -radius * Math.sin(lat);
	return [cx + x, cy + y];
}

function buildGlobeSVG(points) {
	const width = 720;
	const height = 480;
	const cx = width / 2;
	const cy = height / 2 + 6;
	const sphereRadius = Math.min(width, height) * 0.38;

	const svgParts = [];
	svgParts.push(`<?xml version="1.0" encoding="UTF-8"?>`);
	svgParts.push(`<svg xmlns='http://www.w3.org/2000/svg' width='${width}' height='${height}' viewBox='0 0 ${width} ${height}'>`);
	svgParts.push(`  <defs>
		<radialGradient id='bg' cx='50%' cy='50%' r='75%'>
			<stop offset='0%' stop-color='${BG_DARK}'/>
			<stop offset='100%' stop-color='#0f0009'/>
		</radialGradient>
		<radialGradient id='shade' cx='35%' cy='30%'>
			<stop offset='0%' stop-color='#ffffff' stop-opacity='0.18'/>
			<stop offset='60%' stop-color='#ffffff' stop-opacity='0.05'/>
			<stop offset='100%' stop-color='#000000' stop-opacity='0.25'/>
		</radialGradient>
		<filter id='glow' x='-30%' y='-30%' width='160%' height='160%'>
			<feGaussianBlur stdDeviation='1.4' result='coloredBlur'/>
			<feMerge>
				<feMergeNode in='coloredBlur'/>
				<feMergeNode in='SourceGraphic'/>
			</feMerge>
		</filter>
	</defs>`);
	// Background
	svgParts.push(`  <rect width='100%' height='100%' fill='url(#bg)'/>`);
	// Sphere base
	svgParts.push(`  <circle cx='${cx}' cy='${cy}' r='${sphereRadius}' fill='url(#shade)' stroke='${PURPLE}' stroke-opacity='0.15'/>`);

	// Graticules (lat/lon lines)
	const graticules = [];
	for (let lon = -150; lon <= 150; lon += 30) {
		const path = [];
		for (let lat = -80; lat <= 80; lat += 5) {
			const [x, y] = orthographicProject(lon, lat, sphereRadius, cx, cy);
			path.push(`${path.length === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`);
		}
		graticules.push(`<path d='${path.join(" ")}' fill='none' stroke='${PURPLE}' stroke-opacity='0.15' stroke-width='0.8'/>`);
	}
	for (let lat = -60; lat <= 60; lat += 30) {
		const path = [];
		for (let lon = -180; lon <= 180; lon += 5) {
			const [x, y] = orthographicProject(lon, lat, sphereRadius, cx, cy);
			path.push(`${path.length === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`);
		}
		graticules.push(`<path d='${path.join(" ")}' fill='none' stroke='${PURPLE}' stroke-opacity='0.12' stroke-width='0.7'/>`);
	}
	svgParts.push(`  <g id='graticules'>${graticules.join("")}</g>`);

	// Points layer grouped for rotation animation
	svgParts.push(`  <g id='rotating' transform='rotate(0 ${cx} ${cy})'>`);

	for (const p of points) {
		const color = p.color;
		const [x, y] = orthographicProject(p.lon, p.lat, sphereRadius, cx, cy);
		svgParts.push(`    <circle cx='${x.toFixed(1)}' cy='${y.toFixed(1)}' r='${p.size.toFixed(2)}' fill='${color}' filter='url(#glow)' fill-opacity='${p.opacity.toFixed(2)}'/>`);
	}

	// Continuous rotation
	svgParts.push(`    <animateTransform attributeName='transform' attributeType='XML' type='rotate' from='0 ${cx} ${cy}' to='360 ${cx} ${cy}' dur='24s' repeatCount='indefinite'/>`);
	svgParts.push(`  </g>`);

	// Title
	svgParts.push(`  <text x='50%' y='44' text-anchor='middle' font-family='Inter, ui-sans-serif, system-ui' font-size='20' fill='#fffffa'>Contribution Globe (Last 52 Weeks)</text>`);
	svgParts.push(`</svg>`);
	return svgParts.join("\n");
}

function mapCalendarToSphere(contrib, options = {}) {
	const { maxWeeks = 52 } = options;
	if (!contrib.length) return [];
	// Determine max per-day count for color scaling
	const maxCount = contrib.reduce((m, d) => Math.max(m, d.count), 0);

	// Compute total number of weeks in data
	const lastWeekIndex = contrib.reduce((m, d) => Math.max(m, d.weekIndex), 0);
	const firstWeek = Math.max(0, lastWeekIndex - (maxWeeks - 1));

	const points = [];
	for (const d of contrib) {
		if (d.weekIndex < firstWeek) continue;
		// Map week index to longitude: left (-180) to right (+180)
		const relWeek = d.weekIndex - firstWeek; // 0..51 approx
		const lon = -180 + (360 * relWeek) / (maxWeeks - 1);
		// Map day index (0..6, Sun..Sat) to latitude (-55 .. +55) for nicer framing
		const lat = -55 + (110 * d.dayIndex) / 6;

		const baseSize = 1.2; // px
		const size = baseSize + (d.count > 0 ? Math.min(2.5, Math.sqrt(d.count) * 0.5) : 0);
		const opacity = d.count > 0 ? Math.min(0.95, 0.2 + d.count / Math.max(3, maxCount)) : 0.0;
		const color = colorForCount(d.count, maxCount);

		points.push({ lon, lat, size, opacity, color });
	}
	return points;
}

async function main() {
	const username = process.env.GITHUB_USERNAME || "SyedHassanUlHaq";
	const token = process.env.GITHUB_TOKEN;
	let contrib;
	try {
		contrib = await fetchContributionCalendar(username, token);
	} catch (err) {
		console.error("Failed to fetch contribution calendar:", err.message);
		const fallback = `<svg xmlns='http://www.w3.org/2000/svg' width='500' height='300'><rect width='100%' height='100%' fill='${BG_DARK}'/><text x='50%' y='50%' text-anchor='middle' dominant-baseline='middle' fill='#fff'>No contribution data</text></svg>`;
		await fs.writeFile("contrib-globe.svg", fallback, "utf8");
		return;
	}

	const points = mapCalendarToSphere(contrib, { maxWeeks: 52 });
	const svg = buildGlobeSVG(points);
	await fs.writeFile("contrib-globe.svg", svg, "utf8");
	console.log("✅ Generated contrib-globe.svg");
}

main().catch(err => {
	console.error("Globe generation failed:", err);
	process.exit(1);
}); 