import { initWasm, Resvg } from "@resvg/resvg-wasm";
import wasm from "@resvg/resvg-wasm/index_bg.wasm";
import plexBold from "./fonts/IBMPlexMono-Bold.ttf?inline";
import plexRegular from "./fonts/IBMPlexMono-Regular.ttf?inline";
import type { RadarSettings, Vessel } from "../../shared/types";
import { DISPLAY_HEIGHT, DISPLAY_WIDTH, rgbaToEinkPngAsync, type EncodedPng } from "./png.ts";
import { renderRadarSvg } from "./radar.ts";

let wasmReady: Promise<void> | null = null;
let fontBuffers: Uint8Array[] | null = null;

function ensureWasm(): Promise<void> {
	if (!wasmReady) {
		wasmReady = initWasm(wasm as unknown as WebAssembly.Module);
	}
	return wasmReady;
}

function fontBuffer(dataUrl: string): Uint8Array {
	const comma = dataUrl.indexOf(",");
	const binary = atob(comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

function loadedFonts(): Uint8Array[] {
	if (!fontBuffers) fontBuffers = [fontBuffer(plexRegular), fontBuffer(plexBold)];
	return fontBuffers;
}

export async function renderRadarPng(
	settings: RadarSettings,
	vessels: Vessel[],
	options: { updatedAt: number; error?: string },
): Promise<EncodedPng> {
	await ensureWasm();
	const svg = renderRadarSvg(settings, vessels, options);
	const resvg = new Resvg(svg, {
		fitTo: { mode: "width", value: DISPLAY_WIDTH },
		dpi: 72,
		font: {
			fontBuffers: loadedFonts(),
			defaultFontFamily: "IBM Plex Mono",
			sansSerifFamily: "IBM Plex Mono",
			monospaceFamily: "IBM Plex Mono",
		},
	});
	const image = resvg.render();
	if (image.width !== DISPLAY_WIDTH || image.height !== DISPLAY_HEIGHT) {
		throw new Error(`Unexpected raster size ${image.width}x${image.height}`);
	}
	return rgbaToEinkPngAsync(image.pixels, DISPLAY_WIDTH, DISPLAY_HEIGHT);
}
