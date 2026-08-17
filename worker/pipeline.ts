import type { RadarSettings, VesselSnapshot } from "../shared/types";
import { ingestAis } from "./ais/ingest.ts";
import { renderRadarPng } from "./render/screen.ts";
import { screenFilename } from "./byos.ts";
import {
	getSettings,
	getSnapshot,
	getStaticCache,
	putScreen,
	putSnapshot,
	putStaticCache,
} from "./store.ts";

export async function refreshRadar(env: Env): Promise<VesselSnapshot> {
	const settings = await getSettings(env.KV);
	return refreshRadarWithSettings(env, settings);
}

export async function refreshRadarWithSettings(env: Env, settings: RadarSettings): Promise<VesselSnapshot> {
	const [staticCache, previous] = await Promise.all([getStaticCache(env.KV), getSnapshot(env.KV)]);
	const snapshot = await ingestAis(env.AISSTREAM_API_KEY ?? "", settings, staticCache, {
		previous: previous?.vessels,
	});
	await putSnapshot(env.KV, snapshot);
	await putStaticCache(env.KV, staticCache);
	await renderAndStore(env.KV, settings, snapshot);
	return snapshot;
}

export async function renderAndStore(kv: KVNamespace, settings: RadarSettings, snapshot: VesselSnapshot): Promise<void> {
	const png = await renderRadarPng(settings, snapshot.vessels, {
		updatedAt: snapshot.updatedAt,
		error: snapshot.error,
	});
	await putScreen(kv, png.bytes, {
		filename: screenFilename(png.hash, snapshot.updatedAt),
		hash: png.hash,
		bytes: png.bytes.length,
		updatedAt: snapshot.updatedAt,
	});
}

export async function ensureScreen(env: Env): Promise<void> {
	const snapshot = await getSnapshot(env.KV);
	if (snapshot) return;
	await refreshRadar(env);
}
