import type { RadarSettings, Vessel } from "../../shared/types";
import { COAST_LINES } from "../../data/coastline.ts";
import { projectToRadar } from "../geo/project.ts";
import { DISPLAY_HEIGHT, DISPLAY_WIDTH } from "./png.ts";

const SCOPE = 470;
const CX = 248;
const CY = 248;
const RADIUS = 214;

export function renderRadarSvg(
	settings: RadarSettings,
	vessels: Vessel[],
	options: { updatedAt: number; error?: string },
): string {
	const contacts = vessels.slice(0, 12);
	const now = new Date(options.updatedAt);
	const utc = `${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}Z`;
	const coast = coastPaths(settings);

	const ticks = vessels
		.map((vessel) => {
			const p = projectToRadar(vessel.lat, vessel.lng, settings.lat, settings.lng, settings.radiusNm, CX, CY, RADIUS);
			if (p.rangeNm > settings.radiusNm) return "";
			const heading = ((vessel.heading || vessel.cog) * Math.PI) / 180;
			const x2 = p.x + Math.sin(heading) * 10;
			const y2 = p.y - Math.cos(heading) * 10;
			return `<g>
        <polygon points="${p.x},${p.y - 5} ${p.x - 3.5},${p.y + 4} ${p.x + 3.5},${p.y + 4}" fill="#000"/>
        <line x1="${p.x}" y1="${p.y}" x2="${x2}" y2="${y2}" stroke="#000" stroke-width="1.4"/>
      </g>`;
		})
		.join("");

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
  <rect x="8" y="8" width="${SCOPE}" height="${SCOPE}" fill="none" stroke="#000" stroke-width="2"/>
  <circle cx="${CX}" cy="${CY}" r="${RADIUS}" fill="#fff" stroke="#000" stroke-width="2"/>
  ${[0.25, 0.5, 0.75, 1].map((f) => `<circle cx="${CX}" cy="${CY}" r="${RADIUS * f}" fill="none" stroke="#000" stroke-width="${f === 1 ? 2 : 1}"/>`).join("")}
  <line x1="${CX}" y1="${CY - RADIUS}" x2="${CX}" y2="${CY + RADIUS}" stroke="#000" stroke-width="1"/>
  <line x1="${CX - RADIUS}" y1="${CY}" x2="${CX + RADIUS}" y2="${CY}" stroke="#000" stroke-width="1"/>
  <text x="${CX}" y="${CY - RADIUS + 16}" text-anchor="middle" font-size="11" font-family="Courier New, monospace">N</text>
  <g clip-path="url(#scope)">
    <clipPath id="scope"><circle cx="${CX}" cy="${CY}" r="${RADIUS}"/></clipPath>
    ${coast}
    ${ticks}
  </g>
  <circle cx="${CX}" cy="${CY}" r="3" fill="#000"/>
  <text x="16" y="28" font-size="14" font-family="Courier New, monospace" font-weight="700">${esc(settings.areaLabel.toUpperCase())}</text>
  <text x="16" y="${SCOPE - 6}" font-size="12" font-family="Courier New, monospace">${settings.radiusNm} NM  ${utc}</text>
  <text x="500" y="28" font-size="18" font-family="Courier New, monospace" font-weight="700">SHIP RADAR</text>
  <text x="500" y="48" font-size="12" font-family="Courier New, monospace">MOVING ${vessels.length}   RANGE ${settings.radiusNm}NM</text>
  <line x1="492" y1="60" x2="788" y2="60" stroke="#000" stroke-width="2"/>
  ${rows}
  ${empty}
  <text x="500" y="468" font-size="11" font-family="Courier New, monospace">SOG≥${settings.minSog}kn  ORIGIN FROM AIS DEST</text>
</svg>`;
}

function coastPaths(settings: RadarSettings): string {
	return COAST_LINES.map((line) => {
		const points = line
			.map(([lng, lat]) => {
				if (lat == null || lng == null) return null;
				const p = projectToRadar(lat, lng, settings.lat, settings.lng, settings.radiusNm, CX, CY, RADIUS);
				return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
			})
			.filter(Boolean)
			.join(" ");
		return `<polyline points="${points}" fill="none" stroke="#000" stroke-width="2" stroke-linejoin="round"/>`;
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
