import type { DeviceStatus, RadarSettings, VesselSnapshot } from "../shared/types";

const TOKEN_KEY = "harbor-scope-token";

export type StatusPayload = {
	settings: RadarSettings;
	snapshot: VesselSnapshot | null;
	screen: { filename: string; hash: string; bytes: number; updatedAt: number } | null;
	device: DeviceStatus | null;
};

export function consumeDashboardQuery(search: string): { token: string | null; nextSearch: string } {
	const raw = search.startsWith("?") ? search.slice(1) : search;
	const params = new URLSearchParams(raw);
	const token = params.get("dashboard")?.trim() || null;
	if (!token) return { token: null, nextSearch: search };
	params.delete("dashboard");
	const qs = params.toString();
	return { token, nextSearch: qs ? `?${qs}` : "" };
}

export function getDashboardToken(): string {
	const { token: fromQuery, nextSearch } = consumeDashboardQuery(window.location.search);
	if (fromQuery) {
		sessionStorage.setItem(TOKEN_KEY, fromQuery);
		window.history.replaceState(null, "", `${window.location.pathname}${nextSearch}${window.location.hash}`);
		return fromQuery;
	}
	return sessionStorage.getItem(TOKEN_KEY) ?? "";
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

export async function fetchScreenPreview(): Promise<string> {
	const token = getDashboardToken();
	if (!token) return "";
	const response = await fetch(`/api/screen.png?ts=${Date.now()}`, {
		headers: { Authorization: `Bearer ${token}` },
	});
	if (!response.ok) return "";
	const blob = await response.blob();
	return URL.createObjectURL(blob);
}
