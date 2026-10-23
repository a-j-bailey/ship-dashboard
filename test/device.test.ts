import { describe, expect, it } from "vitest";
import { MAX_REGISTRY_ENTRIES, sanitizeDeviceField, sanitizeMac, upsertRegistry } from "../worker/device";
import type { DeviceRegistry } from "../worker/store";

describe("sanitizeMac", () => {
	it("keeps hex MAC characters and drops the rest", () => {
		expect(sanitizeMac(" aa:bb:cc:dd:ee:ff \n")).toBe("AA:BB:CC:DD:EE:FF");
		expect(sanitizeMac("id=<script>alert(1)</script>")).not.toMatch(/[<>]/);
		expect(sanitizeMac("")).toBe("");
	});
});

describe("sanitizeDeviceField", () => {
	it("strips CR/LF and caps length", () => {
		expect(sanitizeDeviceField(" 1.2\r\nSet-Cookie: x")).toBe("1.2Set-Cookie: x");
		expect(sanitizeDeviceField("x".repeat(80))?.length).toBe(64);
		expect(sanitizeDeviceField("   ")).toBeNull();
	});
});

describe("upsertRegistry", () => {
	it("reuses an existing MAC and caps new entries", () => {
		const registry: DeviceRegistry = {};
		const first = upsertRegistry(registry, "AA:BB:CC:DD:EE:FF");
		expect(first.stored).toBe(true);
		expect(registry["AA:BB:CC:DD:EE:FF"]?.friendlyId).toBe("DDEEFF");
		const again = upsertRegistry(registry, "AA:BB:CC:DD:EE:FF");
		expect(again.apiKey).toBe(first.apiKey);

		for (let i = 1; i < MAX_REGISTRY_ENTRIES; i += 1) {
			expect(upsertRegistry(registry, `AA:BB:CC:DD:EE:${i.toString(16).padStart(2, "0").toUpperCase()}`).stored).toBe(
				true,
			);
		}
		expect(Object.keys(registry)).toHaveLength(MAX_REGISTRY_ENTRIES);
		const overflow = upsertRegistry(registry, "00:11:22:33:44:55");
		expect(overflow.stored).toBe(false);
		expect(registry["00:11:22:33:44:55"]).toBeUndefined();
	});
});
