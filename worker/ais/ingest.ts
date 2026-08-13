import type { RadarSettings, StaticRecord, Vessel, VesselSnapshot } from "../../shared/types";
import { bboxFromCenter, distanceNm } from "../geo/project.ts";
import { applyAisMessage, movingVessels, type AisEnvelope } from "./filter.ts";

const AIS_URL = "wss://stream.aisstream.io/v0/stream";
const SAMPLE_MS = 12_000;

const MESSAGE_TYPES = [
	"PositionReport",
	"StandardClassBPositionReport",
	"ExtendedClassBPositionReport",
	"ShipStaticData",
	"StaticDataReport",
];

export async function ingestAis(
	apiKey: string,
	settings: RadarSettings,
	staticCache: Map<number, StaticRecord>,
): Promise<VesselSnapshot> {
	const started = Date.now();
	const bbox = bboxFromCenter(settings.lat, settings.lng, settings.radiusNm);
	const positions = new Map<number, Vessel>();
	let messageCount = 0;

	if (!apiKey) {
		return {
			updatedAt: started,
			bbox,
			vessels: [],
			ingestMs: 0,
			messageCount: 0,
			error: "Missing AISSTREAM_API_KEY",
		};
	}

	try {
		messageCount = await collectAis(apiKey, bbox, positions, staticCache, SAMPLE_MS);
	} catch (error) {
		return {
			updatedAt: Date.now(),
			bbox,
			vessels: [],
			ingestMs: Date.now() - started,
			messageCount,
			error: error instanceof Error ? error.message : "AIS ingest failed",
		};
	}

	const vessels = movingVessels(
		positions,
		settings.minSog,
		settings.lat,
		settings.lng,
		settings.radiusNm,
		distanceNm,
	);

	return {
		updatedAt: Date.now(),
		bbox,
		vessels,
		ingestMs: Date.now() - started,
		messageCount,
	};
}

function collectAis(
	apiKey: string,
	bbox: [[number, number], [number, number]],
	positions: Map<number, Vessel>,
	staticCache: Map<number, StaticRecord>,
	durationMs: number,
): Promise<number> {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(AIS_URL);
		ws.binaryType = "arraybuffer";
		let messageCount = 0;
		let settled = false;

		const finish = (error?: unknown) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			try {
				ws.close();
			} catch {
				// ignore
			}
			if (error) reject(error);
			else resolve(messageCount);
		};

		const timeout = setTimeout(() => finish(), durationMs);

		ws.addEventListener("open", () => {
			ws.send(
				JSON.stringify({
					APIKey: apiKey,
					BoundingBoxes: [bbox],
					FilterMessageTypes: MESSAGE_TYPES,
				}),
			);
		});

		ws.addEventListener("message", (event) => {
			void (async () => {
				if (settled) return;
				const payload = await decodeWsPayload(event.data);
				if (!payload || settled) return;
				try {
					const parsed = JSON.parse(payload) as AisEnvelope & { error?: string };
					if (parsed.error) {
						finish(new Error(parsed.error));
						return;
					}
					messageCount += 1;
					applyAisMessage(parsed, positions, staticCache, Date.now());
				} catch {
					// skip malformed frames
				}
			})();
		});

		ws.addEventListener("error", () => finish(new Error("AISStream websocket error")));
		ws.addEventListener("close", () => {
			if (settled) return;
			if (messageCount === 0) finish(new Error("AISStream closed with no messages"));
			else finish();
		});
	});
}

export async function decodeWsPayload(data: unknown): Promise<string | null> {
	if (typeof data === "string") return data;
	if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
	if (ArrayBuffer.isView(data)) return new TextDecoder().decode(data);
	if (typeof Blob !== "undefined" && data instanceof Blob) return data.text();
	return null;
}
