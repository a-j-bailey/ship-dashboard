import { initWasm, Resvg } from "@resvg/resvg-wasm";
import wasm from "@resvg/resvg-wasm/index_bg.wasm";
import type { RadarSettings, Vessel } from "../../shared/types";
import { DISPLAY_HEIGHT, DISPLAY_WIDTH, rgbaToEinkPngAsync, type EncodedPng } from "./png.ts";
import { renderRadarSvg } from "./radar.ts";

let wasmReady: Promise<void> | null = null;

function ensureWasm(): Promise<void> {
	if (!wasmReady) {
		wasmReady = initWasm(wasm as unknown as WebAssembly.Module);
	}
	return wasmReady;
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
	});
	const image = resvg.render();
	if (image.width !== DISPLAY_WIDTH || image.height !== DISPLAY_HEIGHT) {
		throw new Error(`Unexpected raster size ${image.width}x${image.height}`);
	}
	return rgbaToEinkPngAsync(image.pixels, DISPLAY_WIDTH, DISPLAY_HEIGHT);
}
