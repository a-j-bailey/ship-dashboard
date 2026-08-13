export const DISPLAY_WIDTH = 800;
export const DISPLAY_HEIGHT = 480;
export const MAX_PNG_BYTES = 90 * 1024;

export type EncodedPng = {
	bytes: Uint8Array;
	hash: string;
	width: number;
	height: number;
	bitDepth: number;
};

export function parsePngHeader(bytes: Uint8Array): { width: number; height: number; bitDepth: number; colorType: number } {
	if (bytes.length < 29) throw new Error("PNG too small");
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	return {
		width: view.getUint32(16),
		height: view.getUint32(20),
		bitDepth: bytes[24] ?? 0,
		colorType: bytes[25] ?? 0,
	};
}

export async function rgbaToEinkPngAsync(
	rgba: Uint8Array,
	width = DISPLAY_WIDTH,
	height = DISPLAY_HEIGHT,
): Promise<EncodedPng> {
	if (rgba.length !== width * height * 4) {
		throw new Error(`RGBA length ${rgba.length} does not match ${width}x${height}`);
	}
	const gray = toGrayscale(rgba, width, height);
	floydSteinberg(gray, width, height);
	const packed = pack1Bit(gray, width, height);
	const ihdr = new Uint8Array(13);
	const view = new DataView(ihdr.buffer);
	view.setUint32(0, width);
	view.setUint32(4, height);
	ihdr[8] = 1;
	ihdr[9] = 0;
	ihdr[10] = 0;
	ihdr[11] = 0;
	ihdr[12] = 0;
	const zlib = await deflateAsync(packed);
	const chunks = [pngSignature(), chunk("IHDR", ihdr), chunk("IDAT", zlib), chunk("IEND", new Uint8Array(0))];
	const total = chunks.reduce((sum, part) => sum + part.length, 0);
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const part of chunks) {
		bytes.set(part, offset);
		offset += part.length;
	}
	if (bytes.length > MAX_PNG_BYTES) {
		throw new Error(`PNG ${bytes.length} bytes exceeds ${MAX_PNG_BYTES}`);
	}
	return { bytes, hash: fnv1a(bytes), width, height, bitDepth: 1 };
}

function toGrayscale(rgba: Uint8Array, width: number, height: number): Uint8ClampedArray {
	const gray = new Uint8ClampedArray(width * height);
	for (let i = 0; i < gray.length; i += 1) {
		const o = i * 4;
		gray[i] = Math.round(0.299 * (rgba[o] ?? 0) + 0.587 * (rgba[o + 1] ?? 0) + 0.114 * (rgba[o + 2] ?? 0));
	}
	return gray;
}

function floydSteinberg(gray: Uint8ClampedArray, width: number, height: number): void {
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const i = y * width + x;
			const old = gray[i] ?? 0;
			const next = old < 128 ? 0 : 255;
			gray[i] = next;
			const err = old - next;
			if (x + 1 < width) gray[i + 1] = clampByte((gray[i + 1] ?? 0) + (err * 7) / 16);
			if (y + 1 < height) {
				if (x > 0) gray[i + width - 1] = clampByte((gray[i + width - 1] ?? 0) + (err * 3) / 16);
				gray[i + width] = clampByte((gray[i + width] ?? 0) + (err * 5) / 16);
				if (x + 1 < width) gray[i + width + 1] = clampByte((gray[i + width + 1] ?? 0) + (err * 1) / 16);
			}
		}
	}
}

function pack1Bit(gray: Uint8ClampedArray, width: number, height: number): Uint8Array {
	const rowBytes = Math.ceil(width / 8);
	const out = new Uint8Array(height * (1 + rowBytes));
	for (let y = 0; y < height; y += 1) {
		const rowStart = y * (1 + rowBytes);
		out[rowStart] = 0;
		for (let x = 0; x < width; x += 1) {
			const bit = (gray[y * width + x] ?? 0) >= 128 ? 1 : 0;
			out[rowStart + 1 + (x >> 3)] |= bit << (7 - (x & 7));
		}
	}
	return out;
}

function pngSignature(): Uint8Array {
	return new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
}

function chunk(type: string, data: Uint8Array): Uint8Array {
	const out = new Uint8Array(12 + data.length);
	const view = new DataView(out.buffer);
	view.setUint32(0, data.length);
	out[4] = type.charCodeAt(0);
	out[5] = type.charCodeAt(1);
	out[6] = type.charCodeAt(2);
	out[7] = type.charCodeAt(3);
	out.set(data, 8);
	const crcSrc = out.subarray(4, 8 + data.length);
	view.setUint32(8 + data.length, crc32(crcSrc));
	return out;
}

async function deflateAsync(input: Uint8Array): Promise<Uint8Array> {
	const stream = new CompressionStream("deflate");
	const writer = stream.writable.getWriter();
	await writer.write(input);
	await writer.close();
	const reader = stream.readable.getReader();
	const parts: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		if (!value) continue;
		parts.push(value);
		total += value.length;
	}
	const out = new Uint8Array(total);
	let offset = 0;
	for (const part of parts) {
		out.set(part, offset);
		offset += part.length;
	}
	return out;
}

function clampByte(value: number): number {
	return Math.max(0, Math.min(255, Math.round(value)));
}

function fnv1a(bytes: Uint8Array): string {
	let hash = 2166136261;
	for (const b of bytes) {
		hash ^= b;
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0).toString(16).padStart(8, "0");
}

const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n += 1) {
		let c = n;
		for (let k = 0; k < 8; k += 1) {
			c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		}
		table[n] = c >>> 0;
	}
	return table;
})();

function crc32(bytes: Uint8Array): number {
	let crc = 0xffffffff;
	for (const b of bytes) {
		crc = CRC_TABLE[(crc ^ b) & 0xff]! ^ (crc >>> 8);
	}
	return (crc ^ 0xffffffff) >>> 0;
}
