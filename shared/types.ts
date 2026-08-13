export const DEFAULT_SETTINGS = {
	lat: 41.6,
	lng: -71.33,
	radiusNm: 15,
	minSog: 0.5,
	refreshRate: 120,
	areaLabel: "Narragansett Bay",
} as const;

export type RadarSettings = {
	lat: number;
	lng: number;
	radiusNm: number;
	minSog: number;
	refreshRate: number;
	areaLabel: string;
};

export type Vessel = {
	mmsi: number;
	name: string;
	lat: number;
	lng: number;
	sog: number;
	cog: number;
	heading: number;
	origin: string;
	destination: string;
	navStatus: number | null;
	updatedAt: number;
};

export type VesselSnapshot = {
	updatedAt: number;
	bbox: [[number, number], [number, number]];
	vessels: Vessel[];
	ingestMs: number;
	messageCount: number;
	error?: string;
};

export type DeviceStatus = {
	mac: string;
	batteryVoltage: string | null;
	rssi: string | null;
	fwVersion: string | null;
	lastSeenAt: number;
};

export type StaticRecord = {
	name: string;
	destination: string;
	updatedAt: number;
};

export const ZOOM_PRESETS = [1, 2, 5, 8, 15, 25] as const;
