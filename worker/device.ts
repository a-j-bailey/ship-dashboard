import type { DeviceRegistry } from "./store.ts";

export const MAX_REGISTRY_ENTRIES = 16;
export const MAX_DEVICE_FIELD = 64;

export function sanitizeMac(raw: string): string {
	return raw.trim().toUpperCase().replace(/[^0-9A-F:]/g, "").slice(0, MAX_DEVICE_FIELD);
}

export function sanitizeDeviceField(raw: string | null | undefined): string | null {
	if (raw == null) return null;
	const trimmed = raw.trim().replace(/[\r\n\0]/g, "").slice(0, MAX_DEVICE_FIELD);
	return trimmed || null;
}

export function upsertRegistry(
	registry: DeviceRegistry,
	mac: string,
): { apiKey: string; friendlyId: string; stored: boolean } {
	const existing = registry[mac];
	if (existing) return { ...existing, stored: true };
	const record = {
		apiKey: crypto.randomUUID().replaceAll("-", "").slice(0, 22),
		friendlyId: mac.replaceAll(":", "").slice(-6) || "RADAR1",
	};
	if (Object.keys(registry).length >= MAX_REGISTRY_ENTRIES) {
		return { ...record, stored: false };
	}
	registry[mac] = record;
	return { ...record, stored: true };
}
