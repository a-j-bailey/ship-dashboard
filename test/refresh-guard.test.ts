import { describe, expect, it } from "vitest";
import { allowExpensiveRefresh, REFRESH_LOCK_KEY } from "../worker/refresh-guard";

function memoryKv(seed: Record<string, string> = {}): KVNamespace {
	const data = new Map(Object.entries(seed));
	return {
		get: async (key: string) => data.get(key) ?? null,
		put: async (key: string, value: string) => {
			data.set(key, value);
		},
	} as unknown as KVNamespace;
}

describe("allowExpensiveRefresh", () => {
	it("allows the first sweep and cools down afterwards", async () => {
		const kv = memoryKv();
		await expect(allowExpensiveRefresh(kv, 45_000, 1_000)).resolves.toBe(true);
		await expect(allowExpensiveRefresh(kv, 45_000, 20_000)).resolves.toBe(false);
		await expect(allowExpensiveRefresh(kv, 45_000, 46_000)).resolves.toBe(true);
		expect(await kv.get(REFRESH_LOCK_KEY)).toBe("46000");
	});
});
