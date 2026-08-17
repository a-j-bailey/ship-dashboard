import { describe, expect, it } from "vitest";
import { COAST_POLYGONS } from "../data/coastline";
import { DISPLAY_HEIGHT, DISPLAY_WIDTH, MAX_PNG_BYTES, parsePngHeader, rgbaToEinkPngAsync } from "../worker/render/png";
import { renderRadarSvg } from "../worker/render/radar";
import { CHART, projectToChart } from "../worker/geo/project";
import { DEFAULT_SETTINGS } from "../shared/types";

describe("e-ink PNG", () => {
	it("encodes an 800x480 1-bit PNG under 90KB", async () => {
		const rgba = new Uint8Array(DISPLAY_WIDTH * DISPLAY_HEIGHT * 4);
		for (let i = 0; i < rgba.length; i += 4) {
			const on = ((i / 4) % 17) === 0;
			rgba[i] = on ? 0 : 255;
			rgba[i + 1] = on ? 0 : 255;
			rgba[i + 2] = on ? 0 : 255;
			rgba[i + 3] = 255;
		}
		const png = await rgbaToEinkPngAsync(rgba);
		expect(png.bytes.length).toBeLessThan(MAX_PNG_BYTES);
		expect(parsePngHeader(png.bytes)).toEqual({
			width: 800,
			height: 480,
			bitDepth: 1,
			colorType: 0,
		});
	});
});

describe("radar SVG", () => {
	it("keeps the contact list tight to the header and spaced between ships", () => {
		const vessels = Array.from({ length: 3 }, (_, index) => ({
			mmsi: index + 1,
			name: `SHIP ${index + 1}`,
			lat: 41.62,
			lng: -71.31,
			sog: 8.2,
			cog: 120,
			heading: 120,
			origin: "Halifax",
			destination: "Boston",
			navStatus: 0,
			updatedAt: 1,
		}));
		const svg = renderRadarSvg({ ...DEFAULT_SETTINGS }, vessels, { updatedAt: 1 });
		const nameYs = [...svg.matchAll(/<text x="500" y="(\d+)" font-size="13"/g)].map((match) => Number(match[1]));
		expect(nameYs).toEqual([82, 120, 158]);
		expect(nameYs[0]).toBeLessThan(90);
		expect((nameYs[1] ?? 0) - (nameYs[0] ?? 0)).toBeGreaterThanOrEqual(36);
	});

	it("shows full AIS-length ship names instead of clipping at 16 characters", () => {
		const svg = renderRadarSvg(
			{ ...DEFAULT_SETTINGS },
			[
				{
					mmsi: 1,
					name: "HORIZON DISCOVERY",
					lat: 41.62,
					lng: -71.31,
					sog: 8.2,
					cog: 120,
					heading: 120,
					origin: "Cape Cod Canal East",
					destination: "Boston",
					navStatus: 0,
					updatedAt: 1,
				},
			],
			{ updatedAt: 1 },
		);
		expect(svg).toContain("HORIZON DISCOVERY");
		expect(svg).not.toContain("HORIZON DISCOVER…");
		expect(svg).toContain("FROM Cape Cod Canal East");
	});

	it("includes vessel name and origin", () => {
		const svg = renderRadarSvg(
			{ ...DEFAULT_SETTINGS },
			[
				{
					mmsi: 1,
					name: "OCEAN STAR",
					lat: 41.62,
					lng: -71.31,
					sog: 8.2,
					cog: 120,
					heading: 120,
					origin: "Halifax",
					destination: "Boston",
					navStatus: 0,
					updatedAt: 1,
				},
			],
			{ updatedAt: Date.UTC(2026, 7, 12, 15, 30, 0) },
		);
		expect(svg).toContain("OCEAN STAR");
		expect(svg).toContain("FROM Halifax");
		expect(svg).toContain("NARRAGANSETT BAY");
		expect(svg).toContain("SHIP RADAR");
		expect(svg).toContain('width="800"');
		expect(svg).toContain('height="480"');
		expect(svg).not.toContain("<circle");
		expect(svg).toContain('clipPath id="chart"');
		expect(svg).toContain('id="land-bayer"');
		expect(svg).toContain('fill="url(#land-bayer)"');
		expect(svg).toContain("<polygon");
		expect(svg).toContain('fill="#fff" stroke="#fff" stroke-width="7" stroke-linejoin="miter"');
		expect(svg).not.toContain("<polyline");
	});

	it("draws filled heading arrowheads instead of straight ticks", () => {
		const settings = { ...DEFAULT_SETTINGS };
		const vessel = {
			mmsi: 1,
			name: "OCEAN STAR",
			lat: 41.62,
			lng: -71.31,
			sog: 8.2,
			cog: 90,
			heading: 90,
			origin: "Halifax",
			destination: "Boston",
			navStatus: 0,
			updatedAt: 1,
		};
		const svg = renderRadarSvg(settings, [vessel], { updatedAt: 1 });
		const match = svg.match(/<polygon points="([^"]+)" fill="#fff" stroke="#fff"/);
		expect(match?.[1]).toBeTruthy();
		const points = (match?.[1] ?? "").split(" ").map((pair) => {
			const [x, y] = pair.split(",");
			return { x: Number(x), y: Number(y) };
		});
		const tip = points[0];
		const left = points[1];
		const notch = points[2];
		const right = points[3];
		expect(tip).toBeDefined();
		expect(left).toBeDefined();
		expect(notch).toBeDefined();
		expect(right).toBeDefined();
		expect(points).toHaveLength(4);
		if (!tip || !left || !notch || !right) return;
		const origin = projectToChart(vessel.lat, vessel.lng, settings.lat, settings.lng, settings.radiusNm);
		expect(tip.x).toBeGreaterThan(origin.x);
		expect(tip.y).toBeCloseTo(origin.y, 0);
		expect((left.x + right.x) / 2).toBeLessThan(origin.x);
		expect(notch.x).toBeGreaterThan(left.x);
		expect(notch.x).toBeLessThan(tip.x);
		expect(notch.y).toBeCloseTo(origin.y, 0);
	});

	it("draws a dotted wake behind ships that returned on a later sweep", () => {
		const settings = { ...DEFAULT_SETTINGS };
		const vessel = {
			mmsi: 1,
			name: "OCEAN STAR",
			lat: 41.62,
			lng: -71.31,
			sog: 8.2,
			cog: 90,
			heading: 90,
			origin: "Halifax",
			destination: "Boston",
			navStatus: 0,
			updatedAt: 3,
			trail: [
				{ lat: 41.6, lng: -71.33, at: 1 },
				{ lat: 41.61, lng: -71.32, at: 2 },
			],
		};
		const svg = renderRadarSvg(settings, [vessel], { updatedAt: 3 });
		expect(svg).toContain("<polyline");
		expect(svg).toContain('stroke-dasharray="1.3 4.2"');
		expect(svg).toContain('stroke-width="1.9"');
		const current = projectToChart(vessel.lat, vessel.lng, settings.lat, settings.lng, settings.radiusNm);
		const start = projectToChart(41.6, -71.33, settings.lat, settings.lng, settings.radiusNm);
		expect(svg).toContain(`${start.x.toFixed(1)},${start.y.toFixed(1)}`);
		expect(svg).toContain(`${current.x.toFixed(1)},${current.y.toFixed(1)}`);
	});

	it("dithers land with an 8×8 Bayer matrix instead of a checkerboard", () => {
		const svg = renderRadarSvg({ ...DEFAULT_SETTINGS, radiusNm: 25 }, [], { updatedAt: 1 });
		expect(svg).toContain('<pattern id="land-bayer" width="8" height="8"');
		expect(svg).toContain('patternUnits="userSpaceOnUse"');
		expect(svg).toContain('fill="url(#land-bayer)"');
		expect(svg).toContain('shape-rendering="crispEdges"');
		expect(svg).not.toContain("patternTransform");
		expect(svg).not.toContain('width="4" height="4"');
		const dots = [...svg.matchAll(/<rect x="(\d+)" y="(\d+)" width="1" height="1" fill="#000"\/>/g)].map((match) => ({
			x: Number(match[1]),
			y: Number(match[2]),
		}));
		expect(dots).toHaveLength(24);
		const occupied = new Set(dots.map((dot) => `${dot.x},${dot.y}`));
		expect(occupied.has("0,0")).toBe(true);
		expect(occupied.has("1,0")).toBe(false);
		expect(occupied.has("4,4")).toBe(true);
	});

	it("spans a 25 NM Narragansett chart instead of a bay-only strip", () => {
		const settings = { ...DEFAULT_SETTINGS, radiusNm: 25 };
		const svg = renderRadarSvg(settings, [], { updatedAt: 1 });
		expect(svg).toContain("<polygon");
		const xs: number[] = [];
		for (const ring of COAST_POLYGONS) {
			for (const [lng, lat] of ring) {
				const p = projectToChart(lat, lng, settings.lat, settings.lng, settings.radiusNm);
				if (p.x >= CHART.x && p.x <= CHART.x + CHART.size && p.y >= CHART.y && p.y <= CHART.y + CHART.size) {
					xs.push(p.x);
				}
			}
		}
		expect(Math.min(...xs)).toBeLessThan(CHART.x + 20);
		expect(Math.max(...xs)).toBeGreaterThan(CHART.x + CHART.size - 20);
	});
});
