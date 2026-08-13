export async function tokensMatch(provided: string | null | undefined, expected: string | null | undefined): Promise<boolean> {
	if (!expected || !provided) return false;
	const encoder = new TextEncoder();
	const a = encoder.encode(provided);
	const b = encoder.encode(expected);
	if (a.byteLength !== b.byteLength) {
		await crypto.subtle.digest("SHA-256", a);
		return false;
	}
	return crypto.subtle.timingSafeEqual(a, b);
}

export function deviceTokenFromRequest(request: Request, pathToken?: string): string | null {
	const url = new URL(request.url);
	return pathToken || url.searchParams.get("token") || request.headers.get("Access-Token");
}

export async function requireDeviceToken(request: Request, env: Env, pathToken?: string): Promise<boolean> {
	if (!env.DEVICE_TOKEN) return true;
	return tokensMatch(deviceTokenFromRequest(request, pathToken), env.DEVICE_TOKEN);
}

export async function requireDashboardToken(request: Request, env: Env): Promise<boolean> {
	if (!env.DASHBOARD_TOKEN) return true;
	const header = request.headers.get("Authorization");
	const bearer = header?.toLowerCase().startsWith("bearer ") ? header.slice(7) : null;
	const url = new URL(request.url);
	return tokensMatch(bearer || url.searchParams.get("dashboard"), env.DASHBOARD_TOKEN);
}
