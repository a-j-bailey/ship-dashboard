import { describe, expect, it } from "vitest";
import { applyAisMessage, isMoving, movingVessels, type AisEnvelope } from "../worker/ais/filter";
import { distanceNm } from "../worker/geo/project";
import type { StaticRecord, Vessel } from "../shared/types";

function position(overrides: Partial<{ sog: number; status: number; lat: number; lng: number }>): AisEnvelope {
	return {
		MessageType: "PositionReport",
		MetaData: { MMSI: 367000001, ShipName: "TEST BOAT" },
		Message: {
			PositionReport: {
				UserID: 367000001,
				Latitude: overrides.lat ?? 42.35,
				Longitude: overrides.lng ?? -70.98,
				Sog: overrides.sog ?? 8,
				Cog: 90,
				TrueHeading: 90,
				NavigationalStatus: overrides.status ?? 0,
			},
		},
	};
}

describe("isMoving", () => {
	it("drops stopped vessels", () => {
		expect(isMoving({ sog: 0, navStatus: 0 }, 0.5)).toBe(false);
		expect(isMoving({ sog: 0.4, navStatus: 0 }, 0.5)).toBe(false);
	});

	it("keeps vessels above min SOG", () => {
		expect(isMoving({ sog: 1.2, navStatus: 0 }, 0.5)).toBe(true);
	});

	it("drops moored even if SOG is noisy", () => {
		expect(isMoving({ sog: 1.2, navStatus: 5 }, 0.5)).toBe(false);
		expect(isMoving({ sog: 2, navStatus: 1 }, 0.5)).toBe(false);
	});
});

describe("applyAisMessage", () => {
	it("merges static name and origin onto a later position", () => {
		const positions = new Map<number, Vessel>();
		const staticCache = new Map<number, StaticRecord>();
		applyAisMessage(
			{
				MessageType: "ShipStaticData",
				Message: {
					ShipStaticData: {
						UserID: 367000001,
						Name: "OCEAN STAR",
						Destination: "US BOS>NL RTM",
					},
				},
			},
			positions,
			staticCache,
			1,
		);
		applyAisMessage(position({ sog: 9 }), positions, staticCache, 2);
		const vessel = positions.get(367000001);
		expect(vessel?.name).toBe("OCEAN STAR");
		expect(vessel?.origin).toBe("Boston");
		expect(vessel?.destination).toBe("Rotterdam");
	});

	it("filters moving vessels inside the radius", () => {
		const positions = new Map<number, Vessel>();
		const staticCache = new Map<number, StaticRecord>();
		applyAisMessage(position({ sog: 0 }), positions, staticCache, 1);
		applyAisMessage(
			{
				MessageType: "PositionReport",
				Message: {
					PositionReport: {
						UserID: 2,
						Latitude: 42.35,
						Longitude: -70.98,
						Sog: 6,
						Cog: 10,
						TrueHeading: 10,
						NavigationalStatus: 0,
						Name: "MOVER",
					},
				},
			},
			positions,
			staticCache,
			1,
		);
		applyAisMessage(
			{
				MessageType: "PositionReport",
				Message: {
					PositionReport: {
						UserID: 3,
						Latitude: 41.0,
						Longitude: -70.98,
						Sog: 12,
						Cog: 10,
						TrueHeading: 10,
						NavigationalStatus: 0,
					},
				},
			},
			positions,
			staticCache,
			1,
		);
		const moving = movingVessels(positions, 0.5, 42.35, -70.98, 8, distanceNm);
		expect(moving.map((v) => v.mmsi)).toEqual([2]);
	});
});
