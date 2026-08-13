import type { RadarSettings, StaticRecord, Vessel, VesselSnapshot } from "../../shared/types";
import { bboxFromCenter, distanceNm } from "../geo/project.ts";
import { applyAisMessage, movingVessels, type AisEnvelope } from "./filter.ts";

const AIS_URL = "wss://stream.aisstream.io/v0/stream";
const SAMPLE_MS = 12_000;
const OPEN_MS = 2_000;

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
		let rawCount = 0;
		let settled = false;
		let drain = Promise.resolve();
		const unreadKinds: string[] = [];

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
				unreadKinds.push("non-json");
			}
		};

		const onFrame = (data: unknown) => {
			if (settled) return;
			rawCount += 1;
			const payload = decodeWsPayloadSync(data);
			if (payload !== null) {
				ingestJson(payload);
				return;
			}
			if (isBlobLike(data)) {
				drain = drain.then(async () => {
					if (settled) return;
					ingestJson(new TextDecoder().decode(await data.arrayBuffer()));
				});
				return;
			}
			unreadKinds.push(payloadKind(data));
		};

		const timeout = setTimeout(() => {
			void drain.then(() => {
				if (messageCount === 0 && rawCount > 0) {
					finish(
						new Error(
							`AISStream sent ${rawCount} undecodable frames (${unreadKinds.slice(0, 4).join(", ") || "unknown"})`,
						),
					);
					return;
				}
				finish();
			});
		}, durationMs);

		ws.addEventListener("message", (event) => onFrame(event.data));
		ws.addEventListener("error", () => finish(new Error("AISStream websocket error")));
		ws.addEventListener("close", (event) => {
			void drain.then(() => {
				if (settled) return;
				const close = event as CloseEvent;
				if (messageCount === 0 && rawCount > 0) {
					finish(
						new Error(
							`AISStream sent ${rawCount} undecodable frames (${unreadKinds.slice(0, 4).join(", ") || "unknown"})`,
						),
					);
					return;
				}
				if (messageCount === 0) finish(new Error(closedWithNoMessages(close.code, close.reason)));
				else finish();
			});
		});

		// Official sample sends on open. After openAisSocket the socket is already OPEN.
		ws.send(JSON.stringify(buildAisSubscription(apiKey, bbox)));
	});
}

async function openAisSocket(): Promise<WebSocket> {
	try {
		return await openViaConstructor();
	} catch {
		return await openViaFetchUpgrade();
	}
}

function openViaConstructor(): Promise<WebSocket> {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(AIS_URL);
		try {
			ws.binaryType = "arraybuffer";
		} catch {
			// ignore
		}

		const onError = () => fail(new Error("AISStream websocket error"));
		const onClose = (event: Event) => {
			const close = event as CloseEvent;
			fail(new Error(`AISStream closed before open${closeDetail(close.code, close.reason)}`));
		};

		const detach = () => {
			clearTimeout(timer);
			ws.removeEventListener("error", onError);
			ws.removeEventListener("close", onClose);
		};

		const fail = (error: Error) => {
			detach();
			try {
				ws.close();
			} catch {
				// ignore
			}
			reject(error);
		};

		const timer = setTimeout(() => fail(new Error("AISStream open timed out")), OPEN_MS);

		ws.addEventListener(
			"open",
			() => {
				detach();
				resolve(ws);
			},
			{ once: true },
		);
		ws.addEventListener("error", onError);
		ws.addEventListener("close", onClose);
	});
}

async function openViaFetchUpgrade(): Promise<WebSocket> {
	// Workers fetch accepts wss:// for a backend upgrade. binaryType must be set
	// BEFORE accept(); after 2026-03-17 the default is Blob and instanceof checks fail.
	const response = await fetch(AIS_URL, {
		headers: {
			Upgrade: "websocket",
		},
	});
	const ws = response.webSocket;
	if (!ws) {
		const hint = (await response.text().catch(() => "")).trim().slice(0, 180);
		throw new Error(
			`AISStream refused websocket upgrade (${response.status})${hint ? `: ${hint}` : ""}`,
		);
	}
	try {
		ws.binaryType = "arraybuffer";
	} catch {
		// ignore
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
	if (isArrayBufferLike(data)) return new TextDecoder().decode(data);
	return null;
}

export async function decodeWsPayload(data: unknown): Promise<string | null> {
	const sync = decodeWsPayloadSync(data);
	if (sync !== null) return sync;
	if (isBlobLike(data)) return data.text();
	return null;
}

export function payloadKind(data: unknown): string {
	if (data == null) return String(data);
	if (typeof data !== "object") return typeof data;
	const name = (data as { constructor?: { name?: string } }).constructor?.name;
	return name || "object";
}

function isArrayBufferLike(data: unknown): data is ArrayBuffer {
	return (
		typeof data === "object" &&
		data !== null &&
		(data as { constructor?: { name?: string } }).constructor?.name === "ArrayBuffer" &&
		typeof (data as ArrayBuffer).byteLength === "number"
	);
}

function isBlobLike(data: unknown): data is Blob {
	if (typeof data !== "object" || data === null) return false;
	const blob = data as Blob;
	if (typeof blob.arrayBuffer !== "function") return false;
	if (typeof Blob !== "undefined" && data instanceof Blob) return true;
	return blob.constructor?.name === "Blob";
}

function closedWithNoMessages(code: number | undefined, reason: unknown): string {
	const detail = closeDetail(code, reason);
	if (code === 1006) {
		return `AISStream closed with no messages${detail}. This is what AISStream does for an invalid/revoked API key, or if the JSON subscription never arrived.`;
	}
	return `AISStream closed with no messages${detail}`;
}

function closeDetail(code: number | undefined, reason: unknown): string {
	const parts: string[] = [];
	if (typeof code === "number" && code > 0) parts.push(String(code));
	const text = String(reason ?? "").trim();
	if (text) parts.push(text);
	return parts.length ? ` (${parts.join(" ")})` : "";
}
