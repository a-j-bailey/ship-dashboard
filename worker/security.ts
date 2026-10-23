const CSP = [
	"default-src 'self'",
	"script-src 'self'",
	"style-src 'self' https://fonts.googleapis.com",
	"font-src https://fonts.gstatic.com",
	"img-src 'self' blob:",
	"connect-src 'self'",
	"frame-ancestors 'none'",
	"base-uri 'self'",
	"form-action 'self'",
	"object-src 'none'",
	"upgrade-insecure-requests",
].join("; ");

export const SECURITY_HEADERS: Record<string, string> = {
	"Content-Security-Policy": CSP,
	"X-Frame-Options": "DENY",
	"X-Content-Type-Options": "nosniff",
	"Referrer-Policy": "no-referrer",
	"Permissions-Policy": "camera=(), microphone=(), geolocation=()",
	"Cross-Origin-Opener-Policy": "same-origin",
	"Cross-Origin-Resource-Policy": "same-origin",
	"X-DNS-Prefetch-Control": "off",
	"Cache-Control": "no-store",
};

export const HSTS_HEADER = "max-age=31536000; includeSubDomains";

export function applySecurityHeaders(headers: Headers, requestUrl: string): void {
	for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
		if (name === "Cache-Control" && headers.has("Cache-Control")) continue;
		headers.set(name, value);
	}
	if (requestUrl.startsWith("https:")) {
		headers.set("Strict-Transport-Security", HSTS_HEADER);
	}
}
