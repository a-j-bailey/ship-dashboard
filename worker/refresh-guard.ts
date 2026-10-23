export const REFRESH_LOCK_KEY = "refresh-cooldown";

export async function allowExpensiveRefresh(
	kv: KVNamespace,
	cooldownMs: number,
	now = Date.now(),
): Promise<boolean> {
	const raw = await kv.get(REFRESH_LOCK_KEY);
	const last = raw ? Number(raw) : 0;
	if (Number.isFinite(last) && last > 0 && now - last < cooldownMs) return false;
	const ttl = Math.max(60, Math.ceil(cooldownMs / 1000) + 30);
	await kv.put(REFRESH_LOCK_KEY, String(now), { expirationTtl: ttl });
	return true;
}
