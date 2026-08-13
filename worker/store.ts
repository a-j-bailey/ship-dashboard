import type { DeviceStatus, RadarSettings, StaticRecord, VesselSnapshot } from "../shared/types";
import { normalizeSettings } from "./geo/project.ts";

const KEYS = {
	settings: "settings",
	snapshot: "snapshot",
	staticCache: "static-cache",
	screen: "screen.png",
	screenMeta: "screen-meta",
	deviceStatus: "device-status",
	deviceRegistry: "device-registry",
} as const;

export type ScreenMeta = {
	filename: string;
	hash: string;
	bytes: number;
	updatedAt: number;
};

export type DeviceRegistry = Record<string, { apiKey: string; friendlyId: string }>;

export async function getSettings(kv: KVNamespace): Promise<RadarSettings> {
	const raw = await kv.get(KEYS.settings, "json");
	return normalizeSettings((raw ?? {}) as Partial<RadarSettings>);
}

export async function putSettings(kv: KVNamespace, settings: RadarSettings): Promise<void> {
	await kv.put(KEYS.settings, JSON.stringify(settings));
}

export async function getSnapshot(kv: KVNamespace): Promise<VesselSnapshot | null> {
	return (await kv.get(KEYS.snapshot, "json")) as VesselSnapshot | null;
}

export async function putSnapshot(kv: KVNamespace, snapshot: VesselSnapshot): Promise<void> {
	await kv.put(KEYS.snapshot, JSON.stringify(snapshot));
}

export async function getStaticCache(kv: KVNamespace): Promise<Map<number, StaticRecord>> {
	const raw = (await kv.get(KEYS.staticCache, "json")) as Record<string, StaticRecord> | null;
	const map = new Map<number, StaticRecord>();
	if (!raw) return map;
	for (const [key, value] of Object.entries(raw)) {
		map.set(Number(key), value);
	}
	return map;
}

export async function putStaticCache(kv: KVNamespace, cache: Map<number, StaticRecord>): Promise<void> {
	const obj: Record<string, StaticRecord> = {};
	for (const [mmsi, record] of cache) obj[String(mmsi)] = record;
	await kv.put(KEYS.staticCache, JSON.stringify(obj));
}

export async function getScreen(kv: KVNamespace): Promise<ArrayBuffer | null> {
	return kv.get(KEYS.screen, "arrayBuffer");
}

export async function putScreen(kv: KVNamespace, bytes: Uint8Array, meta: ScreenMeta): Promise<void> {
	await kv.put(KEYS.screen, bytes);
	await kv.put(KEYS.screenMeta, JSON.stringify(meta));
}

export async function getScreenMeta(kv: KVNamespace): Promise<ScreenMeta | null> {
	return (await kv.get(KEYS.screenMeta, "json")) as ScreenMeta | null;
}

export async function getDeviceStatus(kv: KVNamespace): Promise<DeviceStatus | null> {
	return (await kv.get(KEYS.deviceStatus, "json")) as DeviceStatus | null;
}

export async function putDeviceStatus(kv: KVNamespace, status: DeviceStatus): Promise<void> {
	await kv.put(KEYS.deviceStatus, JSON.stringify(status));
}

export async function getRegistry(kv: KVNamespace): Promise<DeviceRegistry> {
	return ((await kv.get(KEYS.deviceRegistry, "json")) as DeviceRegistry | null) ?? {};
}

export async function putRegistry(kv: KVNamespace, registry: DeviceRegistry): Promise<void> {
	await kv.put(KEYS.deviceRegistry, JSON.stringify(registry));
}
