export async function tokensMatch(provided: string | null | undefined, expected: string | null | undefined): Promise<boolean> {
	if (!expected || !provided) return false;
	const encoder = new TextEncoder();
	const a = encoder.encode(provided);
	const b = encoder.encode(expected);
	if (a.byteLength !== b.byteLength) {
		await crypto.subtle.digest("SHA-256", a);
		return false;
	}
	return timingSafeEqualBytes(a, b);
}

function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
	const subtle = crypto.subtle as SubtleCrypto & {
		timingSafeEqual?: (left: BufferSource, right: BufferSource) => boolean;
	};
	if (typeof subtle.timingSafeEqual === "function") {
		return subtle.timingSafeEqual(a, b);
	}
	let mismatch = 0;
	for (let i = 0; i < a.byteLength; i += 1) mismatch |= a[i]! ^ b[i]!;
	return mismatch === 0;
}

export function deviceTokenFromRequest(request: Request, pathToken?: string): string | null {
	const url = new URL(request.url);
	return pathToken || url.searchParams.get("token") || request.headers.get("Access-Token");
}

function bearerToken(request: Request): string | null {
	const header = request.headers.get("Authorization");
	if (!header) return null;
	return header.toLowerCase().startsWith("bearer ") ? header.slice(7) : null;
}

function configuredSecret(value: string | undefined): string | null {
	const trimmed = value?.trim() ?? "";
	return trimmed || null;
}

export async function requireDeviceToken(request: Request, env: Env, pathToken?: string): Promise<boolean> {
	const expected = configuredSecret(env.DEVICE_TOKEN);
	if (!expected) return false;
	return tokensMatch(deviceTokenFromRequest(request, pathToken), expected);
}

export async function requireDashboardToken(request: Request, env: Env): Promise<boolean> {
	const expected = configuredSecret(env.DASHBOARD_TOKEN);
	if (!expected) return false;
	return tokensMatch(bearerToken(request), expected);
}

/** Browser cross-site POSTs send Origin. Non-browser clients (curl, the OG) omit it. */
export function isForbiddenCrossOrigin(request: Request): boolean {
	const origin = request.headers.get("Origin");
	if (!origin) return false;
	try {
		return new URL(origin).origin !== new URL(request.url).origin;
	} catch {
		return true;
	}
}
