import { Hono, type Context } from "hono";
import { normalizeSettings } from "./geo/project.ts";
import { displayResponse, setupResponse, absoluteUrl } from "./byos.ts";
import { requireDashboardToken, requireDeviceToken } from "./auth.ts";
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

type AppContext = Context<{ Bindings: Env }>;

const app = new Hono<{ Bindings: Env }>();

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
	const body = (await c.req.json()) as Record<string, unknown>;
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
	const snapshot = await refreshRadar(c.env);
	return c.json(snapshot);
});

async function handleSetup(c: AppContext, pathToken?: string): Promise<Response> {
	if (!(await requireDeviceToken(c.req.raw, c.env, pathToken))) {
		return c.json({ status: 404, api_key: null, friendly_id: null, image_url: null, filename: null }, 404);
	}
	const mac = (c.req.header("ID") ?? "").toUpperCase();
	if (!mac) return c.json({ status: 404, api_key: null, friendly_id: null, image_url: null, filename: null }, 404);

	const registry = await getRegistry(c.env.KV);
	const existing = registry[mac];
	const record = existing ?? {
		apiKey: crypto.randomUUID().replaceAll("-", "").slice(0, 22),
		friendlyId: mac.replaceAll(":", "").slice(-6) || "RADAR1",
	};
	if (!existing) {
		registry[mac] = record;
		await putRegistry(c.env.KV, registry);
	}
	await ensureScreen(c.env);
	const meta = await getScreenMeta(c.env.KV);
	const filename = meta?.filename ?? "empty_state";
	return c.json(setupResponse(record.apiKey, record.friendlyId, screenUrl(c.req.raw, pathToken), filename));
}

async function handleDisplay(c: AppContext, pathToken?: string): Promise<Response> {
	if (!(await requireDeviceToken(c.req.raw, c.env, pathToken))) {
		return c.json({ status: 500, error: "Device not found" }, 401);
	}
	const mac = (c.req.header("ID") ?? "").toUpperCase();
	await putDeviceStatus(c.env.KV, {
		mac,
		batteryVoltage: c.req.header("Battery-Voltage") ?? null,
		rssi: c.req.header("RSSI") ?? null,
		fwVersion: c.req.header("FW-Version") ?? null,
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
	if (!(await requireDeviceToken(c.req.raw, c.env, pathToken))) return c.json({ error: "unauthorized" }, 401);
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
	if (pathToken) return absoluteUrl(request, `/t/${pathToken}/api/screen.png`);
	const url = new URL(request.url);
	const token = url.searchParams.get("token");
	return absoluteUrl(request, token ? `/api/screen.png?token=${encodeURIComponent(token)}` : "/api/screen.png");
}

export default {
	fetch: app.fetch,
	scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
		ctx.waitUntil(refreshRadar(env));
	},
} satisfies ExportedHandler<Env>;
