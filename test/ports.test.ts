import { describe, expect, it } from "vitest";
import { formatPort, parseDestination } from "../worker/ais/ports";

describe("parseDestination", () => {
	it("splits IMO origin>destination locodes", () => {
		expect(parseDestination("AE DXB>NL RTM")).toEqual({
			origin: "Dubai",
			destination: "Rotterdam",
			raw: "AE DXB>NL RTM",
		});
	});

	it("handles unstructured destination text", () => {
		const parsed = parseDestination("BOSTON");
		expect(parsed.origin).toBe("—");
		expect(parsed.destination).toBe("Boston");
	});

	it("treats missing and placeholder fields as em dash", () => {
		expect(parseDestination("")).toEqual({ origin: "—", destination: "—", raw: "" });
		expect(parseDestination("@@@@@@@@")).toEqual({ origin: "—", destination: "—", raw: "" });
		expect(parseDestination("?? ???")).toMatchObject({ origin: "—", destination: "—" });
	});

	it("strips AIS @ padding", () => {
		expect(parseDestination("US BOS>CA HAL@@@@@@")).toMatchObject({
			origin: "Boston",
			destination: "Halifax",
		});
	});
});

describe("formatPort", () => {
	it("expands US BOS", () => {
		expect(formatPort("US BOS")).toBe("Boston");
		expect(formatPort("USBOS")).toBe("Boston");
	});
});
