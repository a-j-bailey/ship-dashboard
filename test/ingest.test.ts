import { afterEach, describe, expect, it, vi } from "vitest";
import {
	aisErrorMessage,
	buildAisSubscription,
	decodeWsPayload,
	ingestAis,
} from "../worker/ais/ingest";
import { DEFAULT_SETTINGS } from "../shared/types";

describe("decodeWsPayload", () => {
	it("keeps text frames", async () => {
		await expect(decodeWsPayload(`{"MessageType":"PositionReport"}`)).resolves.toBe(
			`{"MessageType":"PositionReport"}`,
		);
	});

	it("decodes ArrayBuffer frames AISStream may send on Workers", async () => {
		const bytes = new TextEncoder().encode(`{"error":"Subscription Object Is Malformed"}`);
		await expect(decodeWsPayload(bytes.buffer)).resolves.toBe(`{"error":"Subscription Object Is Malformed"}`);
	});

	it("decodes typed-array and Blob frames", async () => {
		const json = `{"MessageType":"ShipStaticData"}`;
		await expect(decodeWsPayload(new TextEncoder().encode(json))).resolves.toBe(json);
		await expect(decodeWsPayload(new Blob([json], { type: "application/json" }))).resolves.toBe(json);
	});

	it("ignores unknown payloads", async () => {
		await expect(decodeWsPayload(null)).resolves.toBeNull();
		await expect(decodeWsPayload(12)).resolves.toBeNull();
	});
});

describe("buildAisSubscription", () => {
	it("uses the schema field names and SW-NE nested boxes", () => {
		const bbox: [[number, number], [number, number]] = [
			[41.5, -71.6],
			[41.9, -71.0],
		];
		const payload = buildAisSubscription("test-key", bbox);
		expect(payload).toEqual({
			APIKey: "test-key",
			BoundingBoxes: [[[41.5, -71.6], [41.9, -71.0]]],
			FilterMessageTypes: [
				"PositionReport",
				"StandardClassBPositionReport",
				"ExtendedClassBPositionReport",
				"ShipStaticData",
				"StaticDataReport",
			],
		});
		const json = JSON.stringify(payload);
		expect(json).toContain('"APIKey"');
		expect(json).not.toContain('"Apikey"');
		expect(json).not.toContain('"APIkey"');
	});
});

describe("aisErrorMessage", () => {
	it("reads the documented error field", () => {
		expect(aisErrorMessage({ error: "Api Key Is Not Valid" })).toBe("Api Key Is Not Valid");
		expect(aisErrorMessage({ Error: "Subscription Object Is Malformed" })).toBe(
			"Subscription Object Is Malformed",
		);
		expect(aisErrorMessage({})).toBeUndefined();
	});
});

describe("ingestAis websocket client", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("upgrades without Origin and subscribes immediately", async () => {
		const socket = new FakeAisSocket();
		vi.stubGlobal(
			"fetch",
			async (_url: string, init?: RequestInit) => {
				const headers = new Headers(init?.headers);
				expect(headers.get("Upgrade")).toBe("websocket");
				expect(headers.get("Origin")).toBeNull();
				return {
					status: 101,
					webSocket: socket,
					text: async () => "",
				};
			},
		);

		const pending = ingestAis("live-key", DEFAULT_SETTINGS, new Map());
		await vi.waitFor(() => {
			expect(socket.accepted).toBe(true);
			expect(socket.sent).toHaveLength(1);
		});
		const subscription = JSON.parse(socket.sent[0]) as {
			APIKey: string;
			BoundingBoxes: [[number, number], [number, number]][];
		};
		expect(subscription.APIKey).toBe("live-key");
		const [[south, west], [north, east]] = subscription.BoundingBoxes[0];
		expect(south).toBeLessThan(north);
		expect(west).toBeLessThan(east);

		socket.emitMessage(
			JSON.stringify({
				MessageType: "PositionReport",
				MetaData: { MMSI: 338123456, ShipName: "TEST BOAT" },
				Message: {
					PositionReport: {
						UserID: 338123456,
						Latitude: DEFAULT_SETTINGS.lat,
						Longitude: DEFAULT_SETTINGS.lng,
						Sog: 8,
						Cog: 90,
						TrueHeading: 90,
						NavigationalStatus: 0,
					},
				},
			}),
		);
		socket.close(1000, "");

		const snapshot = await pending;
		expect(snapshot.messageCount).toBe(1);
		expect(snapshot.vessels.map((vessel) => vessel.mmsi)).toEqual([338123456]);
		expect(snapshot.error).toBeUndefined();
	});

	it("surfaces AISStream error frames such as an invalid key", async () => {
		const socket = new FakeAisSocket();
		vi.stubGlobal(
			"fetch",
			async () => ({
				status: 101,
				webSocket: socket,
				text: async () => "",
			}),
		);

		const pending = ingestAis("bad-key", DEFAULT_SETTINGS, new Map());
		await vi.waitFor(() => {
			expect(socket.sent).toHaveLength(1);
		});
		socket.emitMessage(JSON.stringify({ error: "Api Key Is Not Valid" }));

		const snapshot = await pending;
		expect(snapshot.vessels).toEqual([]);
		expect(snapshot.error).toBe("Api Key Is Not Valid");
	});
});

class FakeAisSocket extends EventTarget {
	accepted = false;
	sent: string[] = [];
	binaryType = "blob";

	accept(): void {
		this.accepted = true;
	}

	send(data: string): void {
		this.sent.push(data);
	}

	close(code = 1000, reason = ""): void {
		this.dispatchEvent(new FakeCloseEvent(code, reason));
	}

	emitMessage(data: string | ArrayBuffer): void {
		this.dispatchEvent(new FakeMessageEvent(data));
	}
}

class FakeMessageEvent extends Event {
	data: string | ArrayBuffer;
	constructor(data: string | ArrayBuffer) {
		super("message");
		this.data = data;
	}
}

class FakeCloseEvent extends Event {
	code: number;
	reason: string;
	constructor(code: number, reason: string) {
		super("close");
		this.code = code;
		this.reason = reason;
	}
}
