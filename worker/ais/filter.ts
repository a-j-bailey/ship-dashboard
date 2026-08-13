import type { StaticRecord, Vessel } from "../../shared/types";
import { inChartNm } from "../geo/project.ts";
import { parseDestination, sanitizeAisText } from "./ports";

const ANCHORED_MOORED_AGROUND = new Set([1, 5, 6]);
const DROPPED_TYPES = new Set([
	"BaseStationReport",
	"AidsToNavigationReport",
	"StandardSearchAndRescueAircraftReport",
	"GnssBroadcastBinaryMessage",
]);

export type AisEnvelope = {
	MessageType?: string;
	MetaData?: {
		MMSI?: number;
		ShipName?: string;
		latitude?: number;
		longitude?: number;
		Latitude?: number;
		Longitude?: number;
	};
	Message?: Record<string, Record<string, unknown>>;
};

type PositionFields = {
	UserID?: number;
	Latitude?: number;
	Longitude?: number;
	Sog?: number;
	Cog?: number;
	TrueHeading?: number;
	NavigationalStatus?: number;
	Name?: string;
};

type StaticFields = {
	UserID?: number;
	Name?: string;
	Destination?: string;
	Type?: number;
};

export function applyAisMessage(
	message: AisEnvelope,
	positions: Map<number, Vessel>,
	staticCache: Map<number, StaticRecord>,
	now: number,
): void {
	const type = message.MessageType ?? "";
	if (DROPPED_TYPES.has(type)) return;
	const body = message.Message?.[type] as PositionFields & StaticFields | undefined;
	if (!body) return;

	if (type === "ShipStaticData" || type === "StaticDataReport") {
		upsertStatic(body, message, staticCache, now);
		return;
	}

	if (
		type === "PositionReport" ||
		type === "StandardClassBPositionReport" ||
		type === "ExtendedClassBPositionReport"
	) {
		upsertPosition(type, body, message, positions, staticCache, now);
	}
}

export function movingVessels(
	positions: Map<number, Vessel>,
	minSog: number,
	centerLat: number,
	centerLng: number,
	radiusNm: number,
	distanceFn: (lat1: number, lng1: number, lat2: number, lng2: number) => number,
): Vessel[] {
	const out: Vessel[] = [];
	for (const vessel of positions.values()) {
		if (!isMoving(vessel, minSog)) continue;
		if (!inChartNm(centerLat, centerLng, vessel.lat, vessel.lng, radiusNm)) continue;
		out.push(vessel);
	}
	out.sort((a, b) => {
		const da = distanceFn(centerLat, centerLng, a.lat, a.lng);
		const db = distanceFn(centerLat, centerLng, b.lat, b.lng);
		return da - db;
	});
	return out;
}

export function isMoving(vessel: Pick<Vessel, "sog" | "navStatus">, minSog: number): boolean {
	if (vessel.sog < minSog) return false;
	if (vessel.navStatus != null && ANCHORED_MOORED_AGROUND.has(vessel.navStatus)) return false;
	return true;
}

function upsertStatic(
	body: StaticFields,
	message: AisEnvelope,
	staticCache: Map<number, StaticRecord>,
	now: number,
): void {
	const mmsi = Number(body.UserID ?? message.MetaData?.MMSI);
	if (!Number.isFinite(mmsi) || mmsi <= 0) return;
	const name = vesselName(body.Name, message.MetaData?.ShipName, staticCache.get(mmsi)?.name);
	const destination = sanitizeAisText(asString(body.Destination)) || staticCache.get(mmsi)?.destination || "";
	staticCache.set(mmsi, { name, destination, updatedAt: now });
}

function upsertPosition(
	type: string,
	body: PositionFields,
	message: AisEnvelope,
	positions: Map<number, Vessel>,
	staticCache: Map<number, StaticRecord>,
	now: number,
): void {
	const mmsi = Number(body.UserID ?? message.MetaData?.MMSI);
	if (!Number.isFinite(mmsi) || mmsi <= 0) return;

	const lat = Number(body.Latitude ?? message.MetaData?.Latitude ?? message.MetaData?.latitude);
	const lng = Number(body.Longitude ?? message.MetaData?.Longitude ?? message.MetaData?.longitude);
	if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
	if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return;

	const cached = staticCache.get(mmsi);
	const name = vesselName(cached?.name, body.Name, message.MetaData?.ShipName);
	const voyage = parseDestination(cached?.destination);
	const existing = positions.get(mmsi);
	const sog = Number.isFinite(Number(body.Sog)) ? Number(body.Sog) : (existing?.sog ?? 0);
	const cog = Number.isFinite(Number(body.Cog)) ? Number(body.Cog) : (existing?.cog ?? 0);
	const headingRaw = Number(body.TrueHeading);
	const heading = Number.isFinite(headingRaw) && headingRaw < 360 ? headingRaw : cog;
	const navStatus = type === "PositionReport" && body.NavigationalStatus != null ? Number(body.NavigationalStatus) : existing?.navStatus ?? null;

	positions.set(mmsi, {
		mmsi,
		name,
		lat,
		lng,
		sog,
		cog,
		heading,
		origin: voyage.origin,
		destination: voyage.destination,
		navStatus,
		updatedAt: now,
	});
}

function vesselName(...candidates: Array<string | null | undefined>): string {
	for (const candidate of candidates) {
		const name = sanitizeAisText(candidate);
		if (name && name !== "UNDEFINED" && !/^@+$/.test(name)) return name;
	}
	return "UNKNOWN";
}

function asString(value: unknown): string {
	return typeof value === "string" ? value : "";
}
