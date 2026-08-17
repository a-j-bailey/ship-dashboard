import type { TrackPoint, Vessel } from "../../shared/types";
import { distanceNm } from "../geo/project.ts";

/** One sample per sweep; about 12 minutes of minute cron. */
export const TRAIL_MAX_POINTS = 12;
/** Ignore GPS jitter and coasted duplicates. */
export const TRAIL_MIN_NM = 0.05;
export const TRAIL_TTL_MS = 12 * 60 * 1000;

export function attachTrails(vessels: Vessel[], previous: Vessel[] | undefined, now = Date.now()): Vessel[] {
	const priorByMmsi = new Map<number, Vessel>();
	for (const vessel of previous ?? []) priorByMmsi.set(vessel.mmsi, vessel);
	return vessels.map((vessel) => ({
		...vessel,
		trail: extendTrail(priorByMmsi.get(vessel.mmsi), vessel, now),
	}));
}

export function extendTrail(prior: Vessel | undefined, current: Vessel, now = Date.now()): TrackPoint[] {
	if (!prior) return [];
	const trail = trimTrail(prior.trail ?? [], now);
	const moved = distanceNm(prior.lat, prior.lng, current.lat, current.lng) >= TRAIL_MIN_NM;
	if (!moved) return trail;
	const last = trail[trail.length - 1];
	const lastFar = !last || distanceNm(last.lat, last.lng, prior.lat, prior.lng) >= TRAIL_MIN_NM;
	if (lastFar) trail.push({ lat: prior.lat, lng: prior.lng, at: prior.updatedAt });
	return trail.slice(-TRAIL_MAX_POINTS);
}

function trimTrail(trail: TrackPoint[], now: number): TrackPoint[] {
	const cutoff = now - TRAIL_TTL_MS;
	return trail.filter((point) => point.at >= cutoff);
}
