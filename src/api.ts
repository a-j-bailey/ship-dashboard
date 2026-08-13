import type { DeviceStatus, RadarSettings, VesselSnapshot } from "../shared/types";

const TOKEN_KEY = "harbor-scope-token";

export type StatusPayload = {
	settings: RadarSettings;
	snapshot: VesselSnapshot | null;
	screen: { filename: string; hash: string; bytes: number; updatedAt: number } | null;
	device: DeviceStatus | null;
};

export function getDashboardToken(): string {
	const params = new URLSearchParams(window.location.search);
	return params.get("dashboard") ?? sessionStorage.getItem(TOKEN_KEY) ?? "";
}

export function setDashboardToken(token: string): void {
	sessionStorage.setItem(TOKEN_KEY, token);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
	const token = getDashboardToken();
	const headers = new Headers(init.headers);
	if (token) headers.set("Authorization", `Bearer ${token}`);
	if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
	const response = await fetch(path, { ...init, headers });
	if (response.status === 401) {
		throw new Error("unauthorized");
	}
	if (!response.ok) {
		throw new Error(`${response.status} ${response.statusText}`);
	}
	if (response.status === 204) return undefined as T;
	return (await response.json()) as T;
}

export function getStatus(): Promise<StatusPayload> {
	return request("/api/status");
}

export function saveSettings(settings: RadarSettings): Promise<RadarSettings> {
	return request("/api/settings", { method: "PUT", body: JSON.stringify(settings) });
}

export function refreshNow(): Promise<VesselSnapshot> {
	return request("/api/refresh", { method: "POST" });
}

export function screenPreviewUrl(): string {
	const params = new URLSearchParams({ ts: String(Date.now()) });
	const token = getDashboardToken();
	if (token) params.set("dashboard", token);
	return `/api/screen.png?${params}`;
}
