import { Hono, type Context } from "hono";
import { AIS_SAMPLE_MS } from "./ais/ingest.ts";
import { normalizeSettings } from "./geo/project.ts";
import { displayResponse, setupResponse, absoluteUrl } from "./byos.ts";
import { isForbiddenCrossOrigin, requireDashboardToken, requireDeviceToken } from "./auth.ts";
import { sanitizeDeviceField, sanitizeMac, upsertRegistry } from "./device.ts";
import { allowExpensiveRefresh } from "./refresh-guard.ts";
import { applySecurityHeaders } from "./security.ts";
import { ensureScreen, refreshRadar } from "./pipeline.ts";
import {
	getDeviceStatus,
	getRegistry,
	getScreen,
	getScreenMeta,
	getSettings,
	getSnapshot,
	putDeviceStatus,
	putRegistry,
	putSettings,
} from "./store.ts";

type AppEnv = { Bindings: Env };
type AppContext = Context<AppEnv>;

const MAX_JSON_BYTES = 4_096;

const app = new Hono<AppEnv>();

app.use("*", async (c, next) => {
	await next();
	applySecurityHeaders(c.res.headers, c.req.url);
});

app.onError((_err, c) => c.json({ error: "internal_error" }, 500));

app.notFound((c) => c.json({ error: "not_found" }, 404));

app.get("/api/setup", (c) => handleSetup(c));
app.get("/t/:token/api/setup", (c) => handleSetup(c, c.req.param("token")));
app.get("/api/display", (c) => handleDisplay(c));
app.get("/t/:token/api/display", (c) => handleDisplay(c, c.req.param("token")));
app.post("/api/log", (c) => handleLog(c));
app.post("/t/:token/api/log", (c) => handleLog(c, c.req.param("token")));
app.get("/api/screen.png", (c) => handleScreen(c));
app.get("/t/:token/api/screen.png", (c) => handleScreen(c, c.req.param("token")));

app.get("/api/settings", async (c) => {
	if (!(await requireDashboardToken(c.req.raw, c.env))) return c.json({ error: "unauthorized" }, 401);
	return c.json(await getSettings(c.env.KV));
});

app.put("/api/settings", async (c) => {
	if (!(await requireDashboardToken(c.req.raw, c.env))) return c.json({ error: "unauthorized" }, 401);
	if (isForbiddenCrossOrigin(c.req.raw)) return c.json({ error: "forbidden" }, 403);
	const body = await readJsonObject(c);
	if (!body) return c.json({ error: "invalid_json" }, 400);
	const settings = normalizeSettings(body);
	await putSettings(c.env.KV, settings);
	return c.json(settings);
});

app.get("/api/vessels", async (c) => {
	if (!(await requireDashboardToken(c.req.raw, c.env))) return c.json({ error: "unauthorized" }, 401);
	const snapshot = await getSnapshot(c.env.KV);
	return c.json(
		snapshot ?? { updatedAt: 0, bbox: [[0, 0], [0, 0]], vessels: [], ingestMs: 0, messageCount: 0 },
	);
});

app.get("/api/status", async (c) => {
	if (!(await requireDashboardToken(c.req.raw, c.env))) return c.json({ error: "unauthorized" }, 401);
	const [settings, snapshot, screen, device] = await Promise.all([
		getSettings(c.env.KV),
		getSnapshot(c.env.KV),
		getScreenMeta(c.env.KV),
		getDeviceStatus(c.env.KV),
	]);
	return c.json({ settings, snapshot, screen, device });
});

app.post("/api/refresh", async (c) => {
	if (!(await requireDashboardToken(c.req.raw, c.env))) return c.json({ error: "unauthorized" }, 401);
	if (isForbiddenCrossOrigin(c.req.raw)) return c.json({ error: "forbidden" }, 403);
	if (!(await allowExpensiveRefresh(c.env.KV, AIS_SAMPLE_MS))) {
		return c.json({ error: "rate_limited" }, 429);
	}
	const snapshot = await refreshRadar(c.env);
	return c.json(snapshot);
});

async function handleSetup(c: AppContext, pathToken?: string): Promise<Response> {
	if (!(await requireDeviceToken(c.req.raw, c.env, pathToken))) {
		return c.json({ status: 404, api_key: null, friendly_id: null, image_url: null, filename: null }, 404);
	}
	const mac = sanitizeMac(c.req.header("ID") ?? "");
	if (!mac) return c.json({ status: 404, api_key: null, friendly_id: null, image_url: null, filename: null }, 404);

	const registry = await getRegistry(c.env.KV);
	const record = upsertRegistry(registry, mac);
	if (record.stored) await putRegistry(c.env.KV, registry);
	await ensureScreen(c.env);
	const meta = await getScreenMeta(c.env.KV);
	const filename = meta?.filename ?? "empty_state";
	return c.json(setupResponse(record.apiKey, record.friendlyId, screenUrl(c.req.raw, pathToken), filename));
}

async function handleDisplay(c: AppContext, pathToken?: string): Promise<Response> {
	if (!(await requireDeviceToken(c.req.raw, c.env, pathToken))) {
		return c.json({ status: 500, error: "Device not found" }, 401);
	}
	const mac = sanitizeMac(c.req.header("ID") ?? "");
	await putDeviceStatus(c.env.KV, {
		mac,
		batteryVoltage: sanitizeDeviceField(c.req.header("Battery-Voltage")),
		rssi: sanitizeDeviceField(c.req.header("RSSI")),
		fwVersion: sanitizeDeviceField(c.req.header("FW-Version")),
		lastSeenAt: Date.now(),
	});
	await ensureScreen(c.env);
	const [settings, meta] = await Promise.all([getSettings(c.env.KV), getScreenMeta(c.env.KV)]);
	return c.json(
		displayResponse(screenUrl(c.req.raw, pathToken), meta?.filename ?? `radar-${Date.now()}.png`, settings.refreshRate),
	);
}

async function handleLog(c: AppContext, pathToken?: string): Promise<Response> {
	if (!(await requireDeviceToken(c.req.raw, c.env, pathToken))) return c.json({ status: 500 }, 401);
	return new Response(null, { status: 204 });
}

async function handleScreen(c: AppContext, pathToken?: string): Promise<Response> {
	const deviceOk = await requireDeviceToken(c.req.raw, c.env, pathToken);
	const dashboardOk = await requireDashboardToken(c.req.raw, c.env);
	if (!deviceOk && !dashboardOk) return c.json({ error: "unauthorized" }, 401);
	const bytes = await getScreen(c.env.KV);
	if (!bytes) return c.json({ error: "no screen" }, 404);
	return new Response(bytes, {
		headers: {
			"Content-Type": "image/png",
			"Cache-Control": "no-store",
		},
	});
}

function screenUrl(request: Request, pathToken?: string): string {
	if (pathToken) return absoluteUrl(request, `/t/${encodeURIComponent(pathToken)}/api/screen.png`);
	const url = new URL(request.url);
	const token = url.searchParams.get("token");
	return absoluteUrl(request, token ? `/api/screen.png?token=${encodeURIComponent(token)}` : "/api/screen.png");
}

async function readJsonObject(c: AppContext): Promise<Record<string, unknown> | null> {
	const declared = Number(c.req.header("content-length") ?? "0");
	if (Number.isFinite(declared) && declared > MAX_JSON_BYTES) return null;
	let text: string;
	try {
		text = await c.req.text();
	} catch {
		return null;
	}
	if (text.length > MAX_JSON_BYTES) return null;
	try {
		const parsed: unknown = JSON.parse(text);
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
		return parsed as Record<string, unknown>;
	} catch {
		return null;
	}
}

export { app };

export default {
	fetch: app.fetch,
	scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
		ctx.waitUntil(refreshRadar(env));
	},
} satisfies ExportedHandler<Env>;
