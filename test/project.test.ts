import { describe, expect, it } from "vitest";
import { bboxFromCenter, CHART, inChartNm, latLngFromChartPx, normalizeSettings, projectToChart } from "../worker/geo/project";
import { DEFAULT_SETTINGS } from "../shared/types";

describe("normalizeSettings", () => {
	it("returns Narragansett Bay defaults", () => {
		expect(normalizeSettings({})).toMatchObject({
			lat: DEFAULT_SETTINGS.lat,
			lng: DEFAULT_SETTINGS.lng,
			radiusNm: DEFAULT_SETTINGS.radiusNm,
			areaLabel: "Narragansett Bay",
		});
	});

	it("clamps refresh to a BYOS-safe floor", () => {
		expect(normalizeSettings({ refreshRate: 5 }).refreshRate).toBe(30);
	});
});

describe("bboxFromCenter", () => {
	it("builds a SW then NE [lat,lng] box AISStream accepts", () => {
		const [[south, west], [north, east]] = bboxFromCenter(42.35, -70.98, 8);
		expect(south).toBeLessThan(42.35);
		expect(north).toBeGreaterThan(42.35);
		expect(west).toBeLessThan(-70.98);
		expect(east).toBeGreaterThan(-70.98);
		expect(north - south).toBeCloseTo(8 / 30, 5);
	});

	it("matches the known-working Narragansett Bay corner order", () => {
		const [[south, west], [north, east]] = bboxFromCenter(41.6, -71.33, 15);
		expect(south).toBeLessThan(north);
		expect(west).toBeLessThan(east);
		expect(south).toBeCloseTo(41.35, 2);
		expect(north).toBeCloseTo(41.85, 2);
		expect(west).toBeCloseTo(-71.66, 1);
		expect(east).toBeCloseTo(-71.0, 1);
	});
});

describe("chart projection", () => {
	it("maps the center to the square midpoint", () => {
		const p = projectToChart(42.35, -70.98, 42.35, -70.98, 8);
		expect(p.x).toBeCloseTo(CHART.x + CHART.size / 2);
		expect(p.y).toBeCloseTo(CHART.y + CHART.size / 2);
	});

	it("keeps square-corner contacts that a circular scope would drop", () => {
		expect(inChartNm(42.35, -70.98, 42.35 + 8 / 60, -70.98, 8)).toBe(true);
		expect(inChartNm(42.35, -70.98, 41.0, -70.98, 8)).toBe(false);
	});

	it("inverts a click inside the square", () => {
		const p = projectToChart(42.4, -70.9, 42.35, -70.98, 8);
		const back = latLngFromChartPx(p.x, p.y, 42.35, -70.98, 8);
		expect(back).not.toBeNull();
		expect(back?.lat).toBeCloseTo(42.4, 3);
		expect(back?.lng).toBeCloseTo(-70.9, 3);
		expect(latLngFromChartPx(700, 40, 42.35, -70.98, 8)).toBeNull();
	});
});
