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
		expect(svg).toContain('fill="#000"');
		expect(svg).toContain("<polygon");
		expect(svg).toContain('fill="#fff" stroke="#fff" stroke-width="3.4" stroke-linejoin="round"');
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
		const right = points[2];
		expect(tip).toBeDefined();
		expect(left).toBeDefined();
		expect(right).toBeDefined();
		if (!tip || !left || !right) return;
		const origin = projectToChart(vessel.lat, vessel.lng, settings.lat, settings.lng, settings.radiusNm);
		expect(tip.x).toBeGreaterThan(origin.x);
		expect(tip.y).toBeCloseTo(origin.y, 0);
		expect((left.x + right.x) / 2).toBeLessThan(origin.x);
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
