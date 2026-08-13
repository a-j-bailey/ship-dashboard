import { describe, expect, it } from "vitest";
import { decodeWsPayload } from "../worker/ais/ingest";

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
