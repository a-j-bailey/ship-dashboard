import { describe, expect, it } from "vitest";
import { DISPLAY_HEIGHT, DISPLAY_WIDTH, MAX_PNG_BYTES, parsePngHeader, rgbaToEinkPngAsync } from "../worker/render/png";
import { renderRadarSvg } from "../worker/render/radar";
import { DEFAULT_SETTINGS } from "../shared/types";

describe("e-ink PNG", () => {
	it("encodes an 800x480 1-bit PNG under 90KB", async () => {
		const rgba = new Uint8Array(DISPLAY_WIDTH * DISPLAY_HEIGHT * 4);
		for (let i = 0; i < rgba.length; i += 4) {
			const on = ((i / 4) % 17) === 0;
			rgba[i] = on ? 0 : 255;
			rgba[i + 1] = on ? 0 : 255;
			rgba[i + 2] = on ? 0 : 255;
			rgba[i + 3] = 255;
		}
		const png = await rgbaToEinkPngAsync(rgba);
		expect(png.bytes.length).toBeLessThan(MAX_PNG_BYTES);
		expect(parsePngHeader(png.bytes)).toEqual({
			width: 800,
			height: 480,
			bitDepth: 1,
			colorType: 0,
		});
	});
});

describe("radar SVG", () => {
	it("includes vessel name and origin", () => {
		const svg = renderRadarSvg(
			{ ...DEFAULT_SETTINGS },
			[
				{
					mmsi: 1,
					name: "OCEAN STAR",
					lat: 42.36,
					lng: -70.97,
					sog: 8.2,
					cog: 120,
					heading: 120,
					origin: "Halifax",
					destination: "Boston",
					navStatus: 0,
					updatedAt: 1,
				},
			],
			{ updatedAt: Date.UTC(2026, 7, 12, 15, 30, 0) },
		);
		expect(svg).toContain("OCEAN STAR");
		expect(svg).toContain("FROM Halifax");
		expect(svg).toContain('width="800"');
		expect(svg).toContain('height="480"');
		expect(svg).not.toContain("<circle");
		expect(svg).toContain('clipPath id="chart"');
		expect(svg).toContain('stroke="#000" stroke-width="2.2"');
	});
});
