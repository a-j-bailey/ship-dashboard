import { DEFAULT_SETTINGS, type RadarSettings } from "../../shared/types";

const NM_PER_DEGREE_LAT = 60;
const METERS_PER_NM = 1852;

export function normalizeSettings(input: Partial<RadarSettings> | null | undefined): RadarSettings {
	const lat = clampNumber(input?.lat, -90, 90, DEFAULT_SETTINGS.lat);
	const lng = clampNumber(input?.lng, -180, 180, DEFAULT_SETTINGS.lng);
	const radiusNm = clampNumber(input?.radiusNm, 0.5, 50, DEFAULT_SETTINGS.radiusNm);
	const minSog = clampNumber(input?.minSog, 0, 40, DEFAULT_SETTINGS.minSog);
	const refreshRate = Math.round(clampNumber(input?.refreshRate, 30, 3600, DEFAULT_SETTINGS.refreshRate));
	const areaLabel = (input?.areaLabel ?? DEFAULT_SETTINGS.areaLabel).trim().slice(0, 40) || DEFAULT_SETTINGS.areaLabel;
	return { lat, lng, radiusNm, minSog, refreshRate, areaLabel };
}

export function bboxFromCenter(lat: number, lng: number, radiusNm: number): [[number, number], [number, number]] {
	const dLat = radiusNm / NM_PER_DEGREE_LAT;
	const cosLat = Math.cos((lat * Math.PI) / 180);
	const dLng = radiusNm / (NM_PER_DEGREE_LAT * Math.max(0.2, Math.abs(cosLat)));
	return [
		[lat + dLat, lng - dLng],
		[lat - dLat, lng + dLng],
	];
}

export function nmPerDegreeLng(lat: number): number {
	return NM_PER_DEGREE_LAT * Math.max(0.2, Math.abs(Math.cos((lat * Math.PI) / 180)));
}

export function projectToRadar(
	lat: number,
	lng: number,
	centerLat: number,
	centerLng: number,
	radiusNm: number,
	cx: number,
	cy: number,
	radiusPx: number,
): { x: number; y: number; rangeNm: number } {
	const dxNm = (lng - centerLng) * nmPerDegreeLng(centerLat);
	const dyNm = (lat - centerLat) * NM_PER_DEGREE_LAT;
	const rangeNm = Math.hypot(dxNm, dyNm);
	const scale = radiusPx / radiusNm;
	return {
		x: cx + dxNm * scale,
		y: cy - dyNm * scale,
		rangeNm,
	};
}

export function distanceNm(lat1: number, lng1: number, lat2: number, lng2: number): number {
	const dLat = (lat2 - lat1) * (Math.PI / 180);
	const dLng = (lng2 - lng1) * (Math.PI / 180);
	const a =
		Math.sin(dLat / 2) ** 2 +
		Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
	const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
	return (6371000 * c) / METERS_PER_NM;
}

export function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
	const n = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(n)) return fallback;
	return Math.min(max, Math.max(min, n));
}
