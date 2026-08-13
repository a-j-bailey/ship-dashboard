import { describe, expect, it } from "vitest";
import { displayResponse, screenFilename, setupResponse } from "../worker/byos";

describe("BYOS JSON", () => {
	it("uses a string refresh_rate", () => {
		const json = displayResponse("https://example.com/api/screen.png", "radar-aaa.png", 120);
		expect(json.status).toBe(0);
		expect(json.refresh_rate).toBe("120");
		expect(typeof json.refresh_rate).toBe("string");
		expect(json.update_firmware).toBe(false);
	});

	it("changes filename when the hash changes", () => {
		const a = screenFilename("aaaa", 1);
		const b = screenFilename("bbbb", 1);
		expect(a).not.toBe(b);
	});

	it("returns setup payload the firmware expects", () => {
		const json = setupResponse("key", "ABC123", "https://example.com/api/screen.png", "empty_state");
		expect(json.status).toBe(200);
		expect(json.api_key).toBe("key");
		expect(json.friendly_id).toBe("ABC123");
	});
});
