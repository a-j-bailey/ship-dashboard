import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../shared/types";

vi.mock("../worker/pipeline.ts", () => ({
	ensureScreen: vi.fn(async () => undefined),
	refreshRadar: vi.fn(async () => ({
		updatedAt: 1,
		bbox: [
			[0, 0],
			[0, 0],
		],
		vessels: [],
		ingestMs: 0,
		messageCount: 0,
	})),
}));

import { app } from "../worker/index";
import { refreshRadar } from "../worker/pipeline";

type Store = Map<string, string | ArrayBuffer>;

function memoryKv(store: Store = new Map()): KVNamespace {
	return {
		get: async (key: string, type?: string) => {
			const value = store.get(key);
			if (value == null) return null;
			if (type === "arrayBuffer") {
				if (value instanceof ArrayBuffer) return value;
				return new TextEncoder().encode(String(value)).buffer;
			}
			const text = typeof value === "string" ? value : new TextDecoder().decode(value);
			if (type === "json") return JSON.parse(text);
			return text;
		},
		put: async (key: string, value: string | ArrayBuffer | ArrayBufferView) => {
			if (typeof value === "string") store.set(key, value);
			else if (value instanceof ArrayBuffer) store.set(key, value);
			else store.set(key, value.buffer);
		},
		delete: async (key: string) => {
			store.delete(key);
		},
	} as unknown as KVNamespace;
}

function testEnv(store?: Store): Env {
	return {
		KV: memoryKv(store),
		ASSETS: { fetch: async () => new Response("ok") } as Fetcher,
		AISSTREAM_API_KEY: "ais",
		DEVICE_TOKEN: "device-secret",
		DASHBOARD_TOKEN: "dash-secret",
	};
}

function authHeaders(extra: HeadersInit = {}): HeadersInit {
	return { Authorization: "Bearer dash-secret", ...extra };
}

describe("API authorization", () => {
	beforeEach(() => {
		vi.mocked(refreshRadar).mockClear();
	});

	it("rejects unauthenticated dashboard reads and writes", async () => {
		const env = testEnv();
		for (const path of ["/api/status", "/api/settings", "/api/vessels"]) {
			const res = await app.request(path, {}, env);
			expect(res.status, path).toBe(401);
			expect(await res.json()).toEqual({ error: "unauthorized" });
		}
		const put = await app.request("/api/settings", { method: "PUT", body: "{}" }, env);
		expect(put.status).toBe(401);
		const refresh = await app.request("/api/refresh", { method: "POST" }, env);
		expect(refresh.status).toBe(401);
		expect(refreshRadar).not.toHaveBeenCalled();
	});

	it("does not treat ?dashboard= as authentication", async () => {
		const env = testEnv();
		const res = await app.request("/api/status?dashboard=dash-secret", {}, env);
		expect(res.status).toBe(401);
		const screen = await app.request("/api/screen.png?dashboard=dash-secret", {}, env);
		expect(screen.status).toBe(401);
	});

	it("fails closed when dashboard or device secrets are empty", async () => {
		const open = testEnv();
		open.DASHBOARD_TOKEN = "";
		open.DEVICE_TOKEN = "";
		expect((await app.request("/api/status", { headers: authHeaders() }, open)).status).toBe(401);
		expect((await app.request("/api/setup", { headers: { ID: "AA:BB:CC:DD:EE:FF" } }, open)).status).toBe(404);
	});

	it("serves dashboard JSON with a Bearer token", async () => {
		const env = testEnv();
		const res = await app.request("/api/status", { headers: authHeaders() }, env);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { settings: { lat: number } };
		expect(body.settings.lat).toBe(DEFAULT_SETTINGS.lat);
		expect(res.headers.get("access-control-allow-origin")).toBeNull();
	});

	it("authenticates the OG with path, query, or Access-Token", async () => {
		const env = testEnv();
		const path = await app.request("/t/device-secret/api/log", { method: "POST" }, env);
		expect(path.status).toBe(204);
		const query = await app.request("/api/log?token=device-secret", { method: "POST" }, env);
		expect(query.status).toBe(204);
		const header = await app.request(
			"/api/log",
			{ method: "POST", headers: { "Access-Token": "device-secret" } },
			env,
		);
		expect(header.status).toBe(204);
		const wrong = await app.request("/t/nope/api/log", { method: "POST" }, env);
		expect(wrong.status).toBe(401);
	});
});

describe("dashboard mutations", () => {
	beforeEach(() => {
		vi.mocked(refreshRadar).mockClear();
	});

	it("rejects cross-origin browser POSTs and invalid JSON", async () => {
		const env = testEnv();
		const csrf = await app.request(
			"https://radar.example/api/refresh",
			{ method: "POST", headers: authHeaders({ Origin: "https://evil.example" }) },
			env,
		);
		expect(csrf.status).toBe(403);
		expect(refreshRadar).not.toHaveBeenCalled();

		const bad = await app.request(
			"/api/settings",
			{ method: "PUT", headers: authHeaders({ "Content-Type": "application/json" }), body: "not-json" },
			env,
		);
		expect(bad.status).toBe(400);

		const huge = await app.request(
			"/api/settings",
			{
				method: "PUT",
				headers: authHeaders({ "Content-Type": "application/json" }),
				body: JSON.stringify({ areaLabel: "x".repeat(5000) }),
			},
			env,
		);
		expect(huge.status).toBe(400);
	});

	it("saves settings and rate-limits overlapping AIS sweeps", async () => {
		const env = testEnv();
		const save = await app.request(
			"/api/settings",
			{
				method: "PUT",
				headers: authHeaders({ "Content-Type": "application/json", Origin: "http://localhost" }),
				body: JSON.stringify({ lat: 41.6, lng: -71.33, radiusNm: 8, areaLabel: "Test" }),
			},
			env,
		);
		expect(save.status).toBe(200);
		const settings = (await save.json()) as { radiusNm: number; areaLabel: string };
		expect(settings.radiusNm).toBe(8);
		expect(settings.areaLabel).toBe("Test");

		const first = await app.request("/api/refresh", { method: "POST", headers: authHeaders() }, env);
		expect(first.status).toBe(200);
		const second = await app.request("/api/refresh", { method: "POST", headers: authHeaders() }, env);
		expect(second.status).toBe(429);
		expect(refreshRadar).toHaveBeenCalledTimes(1);
	});
});

describe("device and screen routes", () => {
	it("requires a MAC on setup and serves a PNG only to device or dashboard auth", async () => {
		const png = new Uint8Array([137, 80, 78, 71]).buffer;
		const store = new Map<string, string | ArrayBuffer>([["screen.png", png]]);
		const env = testEnv(store);

		const noMac = await app.request("/t/device-secret/api/setup", {}, env);
		expect(noMac.status).toBe(404);

		const setup = await app.request(
			"/t/device-secret/api/setup",
			{ headers: { ID: "aa:bb:cc:dd:ee:ff" } },
			env,
		);
		expect(setup.status).toBe(200);
		const payload = (await setup.json()) as { image_url: string; api_key: string };
		expect(payload.image_url).toContain("/t/device-secret/api/screen.png");
		expect(payload.api_key).toMatch(/^[a-z0-9]+$/i);

		const anon = await app.request("/api/screen.png", {}, env);
		expect(anon.status).toBe(401);
		const dash = await app.request("/api/screen.png", { headers: authHeaders() }, env);
		expect(dash.status).toBe(200);
		expect(dash.headers.get("content-type")).toBe("image/png");
		expect(dash.headers.get("cache-control")).toBe("no-store");
		const device = await app.request("/t/device-secret/api/screen.png", {}, env);
		expect(device.status).toBe(200);
	});
});

describe("security headers and errors", () => {
	it("sets CSP, clickjacking, and nosniff headers and HSTS on HTTPS", async () => {
		const env = testEnv();
		const http = await app.request("/api/status", { headers: authHeaders() }, env);
		expect(http.headers.get("X-Frame-Options")).toBe("DENY");
		expect(http.headers.get("X-Content-Type-Options")).toBe("nosniff");
		expect(http.headers.get("Referrer-Policy")).toBe("no-referrer");
		expect(http.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
		expect(http.headers.get("Cross-Origin-Resource-Policy")).toBe("same-origin");
		expect(http.headers.get("Strict-Transport-Security")).toBeNull();

		const https = await app.request("https://radar.example/api/status", { headers: authHeaders() }, env);
		expect(https.headers.get("Strict-Transport-Security")).toContain("max-age=31536000");
	});

	it("returns generic JSON for unknown API routes", async () => {
		const env = testEnv();
		const res = await app.request("/api/does-not-exist", {}, env);
		expect(res.status).toBe(404);
		expect(await res.json()).toEqual({ error: "not_found" });
		expect(res.headers.get("X-Frame-Options")).toBe("DENY");
	});
});
