import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, type Vessel } from "../shared/types";
import { attachTrails, TRAIL_MAX_POINTS, TRAIL_TTL_MS } from "../worker/ais/trail";

describe("attachTrails", () => {
	it("starts empty until a ship is seen on a later sweep", () => {
		const current = [testVessel({ mmsi: 1, lat: 41.6, lng: -71.33 })];
		expect(attachTrails(current, undefined)[0]?.trail).toEqual([]);
		expect(attachTrails(current, [])[0]?.trail).toEqual([]);
	});

	it("does not grow a trail when the ship is coasted in place", () => {
		const prior = testVessel({
			mmsi: 1,
			lat: 41.6,
			lng: -71.33,
			updatedAt: 1_000,
			trail: [{ lat: 41.58, lng: -71.33, at: 500 }],
		});
		const current = testVessel({ mmsi: 1, lat: 41.6, lng: -71.33, updatedAt: 2_000 });
		expect(attachTrails([current], [prior], 2_000)[0]?.trail).toEqual(prior.trail);
	});

	it("appends the previous position when the same ship moves", () => {
		const prior = testVessel({ mmsi: 1, lat: 41.6, lng: -71.33, updatedAt: 1_000 });
		const current = testVessel({ mmsi: 1, lat: 41.62, lng: -71.33, updatedAt: 2_000 });
		expect(attachTrails([current], [prior], 2_000)[0]?.trail).toEqual([
			{ lat: 41.6, lng: -71.33, at: 1_000 },
		]);
	});

	it("caps trail length and drops stale points", () => {
		const trail = Array.from({ length: TRAIL_MAX_POINTS }, (_, index) => ({
			lat: 41.5 + index * 0.01,
			lng: -71.33,
			at: 10_000 + index,
		}));
		trail[0] = { lat: 41.4, lng: -71.33, at: 10_000 - TRAIL_TTL_MS };
		const prior = testVessel({
			mmsi: 1,
			lat: 41.62,
			lng: -71.33,
			updatedAt: 20_000,
			trail,
		});
		const current = testVessel({ mmsi: 1, lat: 41.64, lng: -71.33, updatedAt: 21_000 });
		const next = attachTrails([current], [prior], 21_000)[0]?.trail ?? [];
		expect(next).toHaveLength(TRAIL_MAX_POINTS);
		expect(next[0]?.lat).not.toBe(41.4);
		expect(next[next.length - 1]).toEqual({ lat: 41.62, lng: -71.33, at: 20_000 });
	});
});

function testVessel(overrides: Partial<Vessel> = {}): Vessel {
	return {
		mmsi: 1,
		name: "TEST",
		lat: DEFAULT_SETTINGS.lat,
		lng: DEFAULT_SETTINGS.lng,
		sog: 8,
		cog: 90,
		heading: 90,
		origin: "",
		destination: "",
		navStatus: 0,
		updatedAt: 1,
		...overrides,
	};
}
