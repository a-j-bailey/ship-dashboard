import { describe, expect, it } from "vitest";
import { bboxFromCenter, CHART, inChartNm, latLngFromChartPx, normalizeSettings, projectToChart } from "../worker/geo/project";
import { DEFAULT_SETTINGS } from "../shared/types";

describe("normalizeSettings", () => {
	it("returns Boston defaults", () => {
		expect(normalizeSettings({})).toMatchObject({
			lat: DEFAULT_SETTINGS.lat,
			lng: DEFAULT_SETTINGS.lng,
			radiusNm: DEFAULT_SETTINGS.radiusNm,
		});
	});

	it("clamps refresh to a BYOS-safe floor", () => {
		expect(normalizeSettings({ refreshRate: 5 }).refreshRate).toBe(30);
	});
});

describe("bboxFromCenter", () => {
	it("builds a box around Boston 8NM", () => {
		const [[n, w], [s, e]] = bboxFromCenter(42.35, -70.98, 8);
		expect(n).toBeGreaterThan(42.35);
		expect(s).toBeLessThan(42.35);
		expect(e).toBeGreaterThan(-70.98);
		expect(w).toBeLessThan(-70.98);
		expect(n - s).toBeCloseTo(8 / 30, 5);
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
