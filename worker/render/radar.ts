import type { RadarSettings, Vessel } from "../../shared/types";
import { COAST_POLYGONS } from "../../data/coastline.ts";
import { CHART, chartMetrics, projectToChart } from "../geo/project.ts";
import { DISPLAY_HEIGHT, DISPLAY_WIDTH } from "./png.ts";

const ARROW_TIP = 8;
const ARROW_TAIL = 4;
const ARROW_HALF_W = 5.5;

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
	const arrows = vesselArrows(settings, vessels);

	const rows = contacts
		.map((vessel, index) => {
			const origin = vessel.origin === "—" ? vessel.destination : vessel.origin;
			return `<text x="500" y="${118 + index * 28}" font-size="13" font-family="IBM Plex Mono, monospace" fill="#000">${esc(clip(vessel.name, 16))}</text>
        <text x="500" y="${132 + index * 28}" font-size="11" font-family="IBM Plex Mono, monospace" fill="#000">FROM ${esc(clip(origin, 18))}  ${vessel.sog.toFixed(1)}kn ${Math.round(vessel.cog)}°</text>`;
		})
		.join("");

	const empty =
		contacts.length === 0
			? `<text x="500" y="160" font-size="13" font-family="IBM Plex Mono, monospace" fill="#000">${options.error ? esc(options.error) : "NO MOVING CONTACTS"}</text>`
			: "";

	return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${DISPLAY_WIDTH}" height="${DISPLAY_HEIGHT}" viewBox="0 0 ${DISPLAY_WIDTH} ${DISPLAY_HEIGHT}">
  <rect width="100%" height="100%" fill="#fff"/>
  <rect x="${CHART.x}" y="${CHART.y}" width="${CHART.size}" height="${CHART.size}" fill="#fff" stroke="#000" stroke-width="2"/>
  <g clip-path="url(#chart)">
    <clipPath id="chart"><rect x="${CHART.x}" y="${CHART.y}" width="${CHART.size}" height="${CHART.size}"/></clipPath>
    ${coast}
    ${arrows}
    <line x1="${cx - 6}" y1="${cy}" x2="${cx + 6}" y2="${cy}" stroke="#fff" stroke-width="2.4"/>
    <line x1="${cx}" y1="${cy - 6}" x2="${cx}" y2="${cy + 6}" stroke="#fff" stroke-width="2.4"/>
    <line x1="${cx - 6}" y1="${cy}" x2="${cx + 6}" y2="${cy}" stroke="#000" stroke-width="1.2"/>
    <line x1="${cx}" y1="${cy - 6}" x2="${cx}" y2="${cy + 6}" stroke="#000" stroke-width="1.2"/>
  </g>
  ${labelPlate(12, 12, settings.areaLabel.toUpperCase(), 14)}
  ${labelPlate(12, CHART.y + CHART.size - 26, `${settings.radiusNm} NM  ${utc}  N↑`, 12)}
  <text x="500" y="28" font-size="18" font-family="IBM Plex Mono, monospace" font-weight="700" fill="#000">SHIP RADAR</text>
  <text x="500" y="48" font-size="12" font-family="IBM Plex Mono, monospace" fill="#000">MOVING ${vessels.length}   RANGE ${settings.radiusNm}NM</text>
  <line x1="492" y1="60" x2="788" y2="60" stroke="#000" stroke-width="2"/>
  ${rows}
  ${empty}
  <text x="500" y="468" font-size="11" font-family="IBM Plex Mono, monospace" fill="#000">SOG≥${settings.minSog}kn  ORIGIN FROM AIS DEST</text>
</svg>`;
}

function vesselArrows(settings: RadarSettings, vessels: Vessel[]): string {
	return vessels
		.map((vessel) => {
			const p = projectToChart(vessel.lat, vessel.lng, settings.lat, settings.lng, settings.radiusNm);
			if (p.x < CHART.x || p.x > CHART.x + CHART.size || p.y < CHART.y || p.y > CHART.y + CHART.size) return "";
			const points = arrowheadPoints(p.x, p.y, Number.isFinite(vessel.heading) ? vessel.heading : vessel.cog);
			return `<polygon points="${points}" fill="#fff" stroke="#fff" stroke-width="3.4" stroke-linejoin="round"/><polygon points="${points}" fill="#000" stroke="#000" stroke-width="1" stroke-linejoin="round"/>`;
		})
		.join("");
}

function arrowheadPoints(x: number, y: number, headingDeg: number): string {
	const heading = (headingDeg * Math.PI) / 180;
	const fx = Math.sin(heading);
	const fy = -Math.cos(heading);
	const rx = Math.cos(heading);
	const ry = Math.sin(heading);
	const tip = fmtPoint(x + fx * ARROW_TIP, y + fy * ARROW_TIP);
	const left = fmtPoint(x - fx * ARROW_TAIL - rx * ARROW_HALF_W, y - fy * ARROW_TAIL - ry * ARROW_HALF_W);
	const right = fmtPoint(x - fx * ARROW_TAIL + rx * ARROW_HALF_W, y - fy * ARROW_TAIL + ry * ARROW_HALF_W);
	return `${tip} ${left} ${right}`;
}

function fmtPoint(x: number, y: number): string {
	return `${x.toFixed(1)},${y.toFixed(1)}`;
}

function coastPaths(settings: RadarSettings): string {
	return COAST_POLYGONS.map((ring) => {
		const points = ring
			.map(([lng, lat]) => {
				if (lat == null || lng == null) return null;
				const p = projectToChart(lat, lng, settings.lat, settings.lng, settings.radiusNm);
				return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
			})
			.filter(Boolean)
			.join(" ");
		return `<polygon points="${points}" fill="#000" stroke="#000" stroke-width="1" stroke-linejoin="round"/>`;
	}).join("");
}

function labelPlate(x: number, y: number, text: string, fontSize: number): string {
	const width = Math.ceil(text.length * fontSize * 0.62 + 12);
	const height = fontSize + 8;
	const baseline = y + fontSize + 2;
	return `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="#fff"/><text x="${x + 6}" y="${baseline}" font-size="${fontSize}" font-family="IBM Plex Mono, monospace" font-weight="700" fill="#000">${esc(text)}</text>`;
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
