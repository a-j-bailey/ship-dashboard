import type { RadarSettings, Vessel } from "../../shared/types";
import { COAST_LINES } from "../../data/coastline.ts";
import { CHART, chartMetrics, projectToChart } from "../geo/project.ts";
import { DISPLAY_HEIGHT, DISPLAY_WIDTH } from "./png.ts";

const TICK_LEN = 7;

export function renderRadarSvg(
	settings: RadarSettings,
	vessels: Vessel[],
	options: { updatedAt: number; error?: string },
): string {
	const contacts = vessels.slice(0, 12);
	const now = new Date(options.updatedAt);
	const utc = `${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}Z`;
	const { cx, cy } = chartMetrics();
	const coast = coastPaths(settings);
	const ticks = vesselTicks(settings, vessels);

	const rows = contacts
		.map((vessel, index) => {
			const origin = vessel.origin === "—" ? vessel.destination : vessel.origin;
			return `<text x="500" y="${118 + index * 28}" font-size="13" font-family="Courier New, monospace" fill="#000">${esc(clip(vessel.name, 16))}</text>
        <text x="500" y="${132 + index * 28}" font-size="11" font-family="Courier New, monospace" fill="#000">FROM ${esc(clip(origin, 18))}  ${vessel.sog.toFixed(1)}kn ${Math.round(vessel.cog)}°</text>`;
		})
		.join("");

	const empty =
		contacts.length === 0
			? `<text x="500" y="160" font-size="13" font-family="Courier New, monospace" fill="#000">${options.error ? esc(options.error) : "NO MOVING CONTACTS"}</text>`
			: "";

	return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${DISPLAY_WIDTH}" height="${DISPLAY_HEIGHT}" viewBox="0 0 ${DISPLAY_WIDTH} ${DISPLAY_HEIGHT}">
  <rect width="100%" height="100%" fill="#fff"/>
  <rect x="${CHART.x}" y="${CHART.y}" width="${CHART.size}" height="${CHART.size}" fill="#fff" stroke="#000" stroke-width="2"/>
  <g clip-path="url(#chart)">
    <clipPath id="chart"><rect x="${CHART.x}" y="${CHART.y}" width="${CHART.size}" height="${CHART.size}"/></clipPath>
    ${coast}
    ${ticks}
    <line x1="${cx - 6}" y1="${cy}" x2="${cx + 6}" y2="${cy}" stroke="#000" stroke-width="1.6"/>
    <line x1="${cx}" y1="${cy - 6}" x2="${cx}" y2="${cy + 6}" stroke="#000" stroke-width="1.6"/>
  </g>
  <text x="16" y="28" font-size="14" font-family="Courier New, monospace" font-weight="700">${esc(settings.areaLabel.toUpperCase())}</text>
  <text x="16" y="${CHART.y + CHART.size - 10}" font-size="12" font-family="Courier New, monospace">${settings.radiusNm} NM  ${utc}  N↑</text>
  <text x="500" y="28" font-size="18" font-family="Courier New, monospace" font-weight="700">SHIP RADAR</text>
  <text x="500" y="48" font-size="12" font-family="Courier New, monospace">MOVING ${vessels.length}   RANGE ${settings.radiusNm}NM</text>
  <line x1="492" y1="60" x2="788" y2="60" stroke="#000" stroke-width="2"/>
  ${rows}
  ${empty}
  <text x="500" y="468" font-size="11" font-family="Courier New, monospace">SOG≥${settings.minSog}kn  ORIGIN FROM AIS DEST</text>
</svg>`;
}

function vesselTicks(settings: RadarSettings, vessels: Vessel[]): string {
	return vessels
		.map((vessel) => {
			const p = projectToChart(vessel.lat, vessel.lng, settings.lat, settings.lng, settings.radiusNm);
			if (p.x < CHART.x || p.x > CHART.x + CHART.size || p.y < CHART.y || p.y > CHART.y + CHART.size) return "";
			const heading = ((vessel.heading || vessel.cog) * Math.PI) / 180;
			const dx = Math.sin(heading) * TICK_LEN;
			const dy = -Math.cos(heading) * TICK_LEN;
			return `<line x1="${(p.x - dx).toFixed(1)}" y1="${(p.y - dy).toFixed(1)}" x2="${(p.x + dx).toFixed(1)}" y2="${(p.y + dy).toFixed(1)}" stroke="#000" stroke-width="2.2" stroke-linecap="square"/>`;
		})
		.join("");
}

function coastPaths(settings: RadarSettings): string {
	return COAST_LINES.map((line) => {
		const points = line
			.map(([lng, lat]) => {
				if (lat == null || lng == null) return null;
				const p = projectToChart(lat, lng, settings.lat, settings.lng, settings.radiusNm);
				return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
			})
			.filter(Boolean)
			.join(" ");
		return `<polyline points="${points}" fill="none" stroke="#000" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>`;
	}).join("");
}

function pad(value: number): string {
	return String(value).padStart(2, "0");
}

function clip(value: string, max: number): string {
	return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function esc(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
