import type { RadarSettings, StaticRecord, Vessel, VesselSnapshot } from "../../shared/types";
import { bboxFromCenter, distanceNm } from "../geo/project.ts";
import { applyAisMessage, movingVessels, type AisEnvelope } from "./filter.ts";

const AIS_URL = "https://stream.aisstream.io/v0/stream";
const SAMPLE_MS = 12_000;

const MESSAGE_TYPES = [
	"PositionReport",
	"StandardClassBPositionReport",
	"ExtendedClassBPositionReport",
	"ShipStaticData",
	"StaticDataReport",
] as const;

export type AisBbox = [[number, number], [number, number]];

export type AisSubscription = {
	APIKey: string;
	BoundingBoxes: AisBbox[];
	FilterMessageTypes: typeof MESSAGE_TYPES;
};

type AisErrorFrame = {
	error?: unknown;
	Error?: unknown;
};

export async function ingestAis(
	apiKey: string,
	settings: RadarSettings,
	staticCache: Map<number, StaticRecord>,
): Promise<VesselSnapshot> {
	const started = Date.now();
	const bbox = bboxFromCenter(settings.lat, settings.lng, settings.radiusNm);
	const positions = new Map<number, Vessel>();
	let messageCount = 0;
	const key = apiKey.trim();

	if (!key) {
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
		messageCount = await collectAis(key, bbox, positions, staticCache, SAMPLE_MS);
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
		error: messageCount === 0 ? "AISStream connected but sent 0 frames" : undefined,
	};
}

export function buildAisSubscription(apiKey: string, bbox: AisBbox): AisSubscription {
	return {
		APIKey: apiKey,
		BoundingBoxes: [bbox],
		FilterMessageTypes: MESSAGE_TYPES,
	};
}

async function collectAis(
	apiKey: string,
	bbox: AisBbox,
	positions: Map<number, Vessel>,
	staticCache: Map<number, StaticRecord>,
	durationMs: number,
): Promise<number> {
	const ws = await openAisSocket();
	return new Promise((resolve, reject) => {
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

		const ingestJson = (payload: string) => {
			if (settled) return;
			try {
				const parsed = JSON.parse(payload) as AisEnvelope & AisErrorFrame;
				const streamError = aisErrorMessage(parsed);
				if (streamError) {
					finish(new Error(streamError));
					return;
				}
				messageCount += 1;
				applyAisMessage(parsed, positions, staticCache, Date.now());
			} catch {
				// skip malformed frames
			}
		};

		const timeout = setTimeout(() => finish(), durationMs);

		ws.addEventListener("message", (event) => {
			if (settled) return;
			const payload = decodeWsPayloadSync(event.data);
			if (payload !== null) {
				ingestJson(payload);
				return;
			}
			if (typeof Blob !== "undefined" && event.data instanceof Blob) {
				void event.data.text().then((text) => ingestJson(text));
			}
		});
		ws.addEventListener("error", () => finish(new Error("AISStream websocket error")));
		ws.addEventListener("close", (event) => {
			if (settled) return;
			const close = event as CloseEvent;
			const detail = closeDetail(close.code, close.reason);
			if (messageCount === 0) finish(new Error(`AISStream closed with no messages${detail}`));
			else finish();
		});

		try {
			ws.binaryType = "arraybuffer";
		} catch {
			// ignore environments that freeze binaryType
		}

		// Subscribe immediately — AISStream closes sockets that wait >3s after connect.
		ws.send(JSON.stringify(buildAisSubscription(apiKey, bbox)));
	});
}

async function openAisSocket(): Promise<WebSocket> {
	// fetch()+Upgrade is a backend handshake. `new WebSocket()` is the browser API and
	// sends Origin; AISStream drops those connections at the gateway (CORS / key exposure).
	const response = await fetch(AIS_URL, {
		headers: {
			Upgrade: "websocket",
			Connection: "Upgrade",
		},
	});
	const ws = response.webSocket;
	if (!ws) {
		const hint = (await response.text().catch(() => "")).trim().slice(0, 180);
		throw new Error(
			`AISStream refused websocket upgrade (${response.status})${hint ? `: ${hint}` : ""}`,
		);
	}
	ws.accept();
	return ws;
}

export function aisErrorMessage(parsed: AisErrorFrame): string | undefined {
	const value = parsed.error ?? parsed.Error;
	if (typeof value !== "string") return undefined;
	const message = value.trim();
	return message || undefined;
}

export function decodeWsPayloadSync(data: unknown): string | null {
	if (typeof data === "string") return data;
	if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
	if (ArrayBuffer.isView(data)) return new TextDecoder().decode(data);
	return null;
}

export async function decodeWsPayload(data: unknown): Promise<string | null> {
	const sync = decodeWsPayloadSync(data);
	if (sync !== null) return sync;
	if (typeof Blob !== "undefined" && data instanceof Blob) return data.text();
	return null;
}

function closeDetail(code: number | undefined, reason: unknown): string {
	const parts: string[] = [];
	if (typeof code === "number" && code > 0) parts.push(String(code));
	const text = String(reason ?? "").trim();
	if (text) parts.push(text);
	return parts.length ? ` (${parts.join(" ")})` : "";
}
