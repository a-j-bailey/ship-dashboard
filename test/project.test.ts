import { describe, expect, it } from "vitest";
import { bboxFromCenter, normalizeSettings } from "../worker/geo/project";
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
