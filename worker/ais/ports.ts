import unlocode from "../../data/unlocode.json";

const LOCODE = unlocode as Record<string, string>;

export type VoyagePorts = {
	origin: string;
	destination: string;
	raw: string;
};

const PLACEHOLDER = new Set(["", "?", "??", "@@@", "XXXXXX", "XX XXX", "?? ???", "======"]);

export function parseDestination(raw: string | null | undefined): VoyagePorts {
	const cleaned = sanitizeAisText(raw);
	if (!cleaned) {
		return { origin: "—", destination: "—", raw: "" };
	}

	const separator = cleaned.includes(">") ? ">" : cleaned.includes(">>") ? ">>" : null;
	if (separator) {
		const [left, right] = cleaned.split(separator).map((part) => part.trim());
		return {
			origin: formatPort(left),
			destination: formatPort(right),
			raw: cleaned,
		};
	}

	return {
		origin: "—",
		destination: formatPort(cleaned),
		raw: cleaned,
	};
}

export function sanitizeAisText(raw: string | null | undefined): string {
	if (!raw) return "";
	return raw
		.replace(/@+/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.toUpperCase();
}

export function formatPort(value: string | null | undefined): string {
	const text = sanitizeAisText(value);
	if (!text || PLACEHOLDER.has(text) || /^[?X\s]+$/.test(text)) return "—";
	if (text.startsWith("===")) {
		const rest = text.replace(/^===/, "").trim();
		return rest ? titleCase(rest) : "—";
	}
	const code = normalizeLocode(text);
	if (code && LOCODE[code]) return LOCODE[code];
	if (/^[A-Z]{2}\s?[A-Z0-9]{3}$/.test(text)) return code ?? text;
	return titleCase(text);
}

export function normalizeLocode(value: string): string | null {
	const compact = value.replace(/[^A-Z0-9]/g, "");
	if (compact.length === 5) return `${compact.slice(0, 2)} ${compact.slice(2)}`;
	if (/^[A-Z]{2}\s[A-Z0-9]{3}$/.test(value)) return value;
	return null;
}

function titleCase(value: string): string {
	return value
		.toLowerCase()
		.split(/([\s-/])/)
		.map((part) => (part.length ? part[0].toUpperCase() + part.slice(1) : part))
		.join("");
}
