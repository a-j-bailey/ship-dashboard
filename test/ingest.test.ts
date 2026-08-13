import { afterEach, describe, expect, it, vi } from "vitest";
import {
	aisErrorMessage,
	buildAisSubscription,
	decodeWsPayload,
	decodeWsPayloadSync,
	ingestAis,
	payloadKind,
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
		expect(decodeWsPayloadSync(bytes.buffer)).toBe(`{"error":"Subscription Object Is Malformed"}`);
	});

	it("decodes typed-array and Blob frames", async () => {
		const json = `{"MessageType":"ShipStaticData"}`;
		await expect(decodeWsPayload(new TextEncoder().encode(json))).resolves.toBe(json);
		await expect(decodeWsPayload(new Blob([json], { type: "application/json" }))).resolves.toBe(json);
	});

	it("ignores unknown payloads", async () => {
		await expect(decodeWsPayload(null)).resolves.toBeNull();
		await expect(decodeWsPayload(12)).resolves.toBeNull();
		expect(payloadKind({})).toBe("Object");
	});
});

describe("buildAisSubscription", () => {
	it("matches the documented schema and known-working Narragansett box shape", () => {
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
		vi.stubGlobal("WebSocket", FakeWebSocket);
		FakeWebSocket.latest = null;
	});

	it("opens wss:// like the official JS sample and subscribes on open", async () => {
		const pending = ingestAis("live-key", DEFAULT_SETTINGS, new Map());
		const socket = await vi.waitFor(() => {
			const instance = FakeWebSocket.latest;
			expect(instance).toBeTruthy();
			expect(instance?.sent.length).toBe(1);
			return instance as FakeWebSocket;
		});

		expect(socket.url).toBe("wss://stream.aisstream.io/v0/stream");
		expect(socket.binaryType).toBe("arraybuffer");
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

	it("counts binary JSON frames without waiting on Blob.text()", async () => {
		const pending = ingestAis("live-key", DEFAULT_SETTINGS, new Map());
		const socket = await vi.waitFor(() => {
			expect(FakeWebSocket.latest?.sent.length).toBe(1);
			return FakeWebSocket.latest as FakeWebSocket;
		});
		const body = JSON.stringify({
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
		});
		socket.emitMessage(new TextEncoder().encode(body).buffer);
		socket.close(1000, "");
		const snapshot = await pending;
		expect(snapshot.messageCount).toBe(1);
		expect(snapshot.vessels).toHaveLength(1);
	});

	it("surfaces AISStream error frames such as an invalid key", async () => {
		const pending = ingestAis("bad-key", DEFAULT_SETTINGS, new Map());
		const socket = await vi.waitFor(() => {
			expect(FakeWebSocket.latest?.sent.length).toBe(1);
			return FakeWebSocket.latest as FakeWebSocket;
		});
		socket.emitMessage(JSON.stringify({ error: "Api Key Is Not Valid" }));

		const snapshot = await pending;
		expect(snapshot.vessels).toEqual([]);
		expect(snapshot.error).toBe("Api Key Is Not Valid");
	});

	it("explains AISStream's 1006 drop of a bad key", async () => {
		const pending = ingestAis("bad-key", DEFAULT_SETTINGS, new Map());
		const socket = await vi.waitFor(() => {
			expect(FakeWebSocket.latest?.sent.length).toBe(1);
			return FakeWebSocket.latest as FakeWebSocket;
		});
		socket.close(1006, "");
		const snapshot = await pending;
		expect(snapshot.messageCount).toBe(0);
		expect(snapshot.error).toMatch(/1006/);
		expect(snapshot.error).toMatch(/invalid\/revoked API key/i);
	});
});

class FakeWebSocket extends EventTarget {
	static OPEN = 1;
	static CONNECTING = 0;
	static latest: FakeWebSocket | null = null;

	binaryType = "blob";
	readyState = 0;
	sent: string[] = [];
	url: string;

	constructor(url: string) {
		super();
		this.url = url;
		FakeWebSocket.latest = this;
		queueMicrotask(() => {
			this.readyState = FakeWebSocket.OPEN;
			this.dispatchEvent(new Event("open"));
		});
	}

	send(data: string): void {
		this.sent.push(data);
	}

	close(code = 1000, reason = ""): void {
		this.readyState = 3;
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

vi.stubGlobal("WebSocket", FakeWebSocket);
