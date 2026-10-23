import { describe, expect, it } from "vitest";
import { isForbiddenCrossOrigin, requireDashboardToken, requireDeviceToken, tokensMatch } from "../worker/auth";

function env(partial: Partial<Env> = {}): Env {
	return {
		KV: {} as KVNamespace,
		ASSETS: {} as Fetcher,
		AISSTREAM_API_KEY: "ais",
		DEVICE_TOKEN: "device-secret",
		DASHBOARD_TOKEN: "dash-secret",
		...partial,
	};
}

describe("tokensMatch", () => {
	it("rejects missing or empty values", async () => {
		await expect(tokensMatch(null, "abc")).resolves.toBe(false);
		await expect(tokensMatch("abc", "")).resolves.toBe(false);
		await expect(tokensMatch("abc", "abcd")).resolves.toBe(false);
	});

	it("accepts equal secrets", async () => {
		await expect(tokensMatch("abc", "abc")).resolves.toBe(true);
	});
});

describe("requireDeviceToken", () => {
	it("fails closed when the secret is unset", async () => {
		const request = new Request("https://example.com/api/display");
		await expect(requireDeviceToken(request, env({ DEVICE_TOKEN: "" }))).resolves.toBe(false);
		await expect(requireDeviceToken(request, env({ DEVICE_TOKEN: "   " }))).resolves.toBe(false);
	});

	it("accepts path, query, or Access-Token header", async () => {
		const bindings = env();
		await expect(
			requireDeviceToken(new Request("https://example.com/t/device-secret/api/display"), bindings, "device-secret"),
		).resolves.toBe(true);
		await expect(
			requireDeviceToken(new Request("https://example.com/api/display?token=device-secret"), bindings),
		).resolves.toBe(true);
		await expect(
			requireDeviceToken(
				new Request("https://example.com/api/display", { headers: { "Access-Token": "device-secret" } }),
				bindings,
			),
		).resolves.toBe(true);
	});

	it("rejects the wrong token", async () => {
		await expect(
			requireDeviceToken(new Request("https://example.com/api/display?token=nope"), env()),
		).resolves.toBe(false);
	});
});

describe("requireDashboardToken", () => {
	it("fails closed when the secret is unset", async () => {
		const request = new Request("https://example.com/api/status");
		await expect(requireDashboardToken(request, env({ DASHBOARD_TOKEN: "" }))).resolves.toBe(false);
	});

	it("accepts Authorization Bearer and ignores query tokens", async () => {
		const bindings = env();
		await expect(
			requireDashboardToken(
				new Request("https://example.com/api/status", { headers: { Authorization: "Bearer dash-secret" } }),
				bindings,
			),
		).resolves.toBe(true);
		await expect(
			requireDashboardToken(new Request("https://example.com/api/status?dashboard=dash-secret"), bindings),
		).resolves.toBe(false);
	});
});

describe("isForbiddenCrossOrigin", () => {
	it("allows missing Origin and same-origin browsers", () => {
		const same = new Request("https://radar.example/api/refresh", {
			method: "POST",
			headers: { Origin: "https://radar.example" },
		});
		const none = new Request("https://radar.example/api/refresh", { method: "POST" });
		expect(isForbiddenCrossOrigin(same)).toBe(false);
		expect(isForbiddenCrossOrigin(none)).toBe(false);
	});

	it("blocks a different Origin", () => {
		const request = new Request("https://radar.example/api/refresh", {
			method: "POST",
			headers: { Origin: "https://evil.example" },
		});
		expect(isForbiddenCrossOrigin(request)).toBe(true);
	});
});
