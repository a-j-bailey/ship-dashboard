import { describe, expect, it } from "vitest";
import { consumeDashboardQuery } from "../src/api";

describe("consumeDashboardQuery", () => {
	it("leaves URLs without a dashboard param alone", () => {
		expect(consumeDashboardQuery("")).toEqual({ token: null, nextSearch: "" });
		expect(consumeDashboardQuery("?zoom=15")).toEqual({ token: null, nextSearch: "?zoom=15" });
	});

	it("pulls the token out so it is not left in the address bar", () => {
		expect(consumeDashboardQuery("?dashboard=secret&zoom=15")).toEqual({
			token: "secret",
			nextSearch: "?zoom=15",
		});
		expect(consumeDashboardQuery("?dashboard=secret")).toEqual({
			token: "secret",
			nextSearch: "",
		});
	});
});
