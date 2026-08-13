import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { DEFAULT_SETTINGS, ZOOM_PRESETS, type RadarSettings, type VesselSnapshot } from "../shared/types";
import { getDashboardToken, getStatus, refreshNow, saveSettings, screenPreviewUrl, setDashboardToken, type StatusPayload } from "./api";

export function App() {
	const [status, setStatus] = useState<StatusPayload | null>(null);
	const [form, setForm] = useState<RadarSettings>({ ...DEFAULT_SETTINGS });
	const [token, setToken] = useState(getDashboardToken());
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [preview, setPreview] = useState(screenPreviewUrl());
	const [clock, setClock] = useState(utcNow());

	useEffect(() => {
		const id = setInterval(() => setClock(utcNow()), 1000);
		return () => clearInterval(id);
	}, []);

	useEffect(() => {
		void load();
	}, []);

	const vessels = status?.snapshot?.vessels ?? [];
	const device = status?.device;
	const lastSweep = useMemo(() => {
		if (!status?.snapshot?.updatedAt) return "NO SWEEP";
		return new Date(status.snapshot.updatedAt).toISOString().slice(11, 19) + "Z";
	}, [status]);

	async function load() {
		setError(null);
		try {
			const next = await getStatus();
			setStatus(next);
			setForm(next.settings);
			setPreview(screenPreviewUrl());
		} catch (err) {
			setError(err instanceof Error ? err.message : "load failed");
		}
	}

	async function apply() {
		setBusy(true);
		setError(null);
		try {
			await saveSettings(form);
			const snapshot = await refreshNow();
			setStatus((current) => ({
				settings: form,
				snapshot,
				screen: current?.screen ?? null,
				device: current?.device ?? null,
			}));
			setPreview(screenPreviewUrl());
			await load();
		} catch (err) {
			setError(err instanceof Error ? err.message : "apply failed");
		} finally {
			setBusy(false);
		}
	}

	function rememberToken() {
		setDashboardToken(token);
		void load();
	}

	function setField<K extends keyof RadarSettings>(key: K, value: RadarSettings[K]) {
		setForm((current) => ({ ...current, [key]: value }));
	}

	function recenterFromClick(event: MouseEvent<HTMLImageElement>) {
		const rect = event.currentTarget.getBoundingClientRect();
		const x = ((event.clientX - rect.left) / rect.width) * 800;
		const y = ((event.clientY - rect.top) / rect.height) * 480;
		const dx = x - 248;
		const dy = 248 - y;
		if (Math.hypot(dx, dy) > 214) return;
		const dxNm = (dx / 214) * form.radiusNm;
		const dyNm = (dy / 214) * form.radiusNm;
		const lngPerNm = 60 * Math.max(0.2, Math.abs(Math.cos((form.lat * Math.PI) / 180)));
		setForm((current) => ({
			...current,
			lat: Number((current.lat + dyNm / 60).toFixed(4)),
			lng: Number((current.lng + dxNm / lngPerNm).toFixed(4)),
		}));
	}

	return (
		<div className="shell">
			<header className="mast">
				<div>
					<div className="kicker">TRMNL OG · Custom BYOS</div>
					<h1>Harbor Scope</h1>
					<p className="sub">Moving AIS contacts only. Origin parsed from voyage destination. Official firmware, our server.</p>
				</div>
				<div>
					<div className="clock">
						{clock}
						<small>UTC sweep {lastSweep}</small>
					</div>
					<div className="auth">
						<input
							placeholder="dashboard token"
							type="password"
							value={token}
							onChange={(e) => setToken(e.target.value)}
						/>
						<button type="button" onClick={rememberToken}>
							Arm
						</button>
					</div>
				</div>
			</header>

			<div className="layout">
				<section className="panel">
					<div className="panel-h">
						<span>Device raster 800×480</span>
						<span>{status?.screen?.filename ?? "awaiting first paint"}</span>
					</div>
					<div className="scope">
						{preview ? (
							<img src={preview} alt="TRMNL radar preview" onClick={recenterFromClick} title="Click the scope to set a new center" />
						) : (
							<div className="scope-empty">NO IMAGE</div>
						)}
					</div>
					<div className="stats">
						<div className="stat">
							<b>{vessels.length}</b>
							<span>Moving</span>
						</div>
						<div className="stat">
							<b>{form.radiusNm}NM</b>
							<span>Range</span>
						</div>
						<div className="stat">
							<b>{status?.snapshot?.messageCount ?? 0}</b>
							<span>AIS frames</span>
						</div>
						<div className="stat">
							<b>{device?.rssi ?? "—"}</b>
							<span>Device RSSI</span>
						</div>
					</div>
					{status?.snapshot?.error ? <div className="flash">{status.snapshot.error}</div> : null}
					{error ? <div className="error">{error === "unauthorized" ? "Dashboard token rejected. Set DASHBOARD_TOKEN and Arm." : error}</div> : null}
				</section>

				<aside className="panel">
					<div className="panel-h">
						<span>Scope control</span>
						<span>{form.areaLabel}</span>
					</div>
					<div className="form">
						<label>
							Area label
							<input value={form.areaLabel} onChange={(e) => setField("areaLabel", e.target.value)} />
						</label>
						<div className="row-2">
							<label>
								Latitude
								<input
									type="number"
									step="0.0001"
									value={form.lat}
									onChange={(e) => setField("lat", Number(e.target.value))}
								/>
							</label>
							<label>
								Longitude
								<input
									type="number"
									step="0.0001"
									value={form.lng}
									onChange={(e) => setField("lng", Number(e.target.value))}
								/>
							</label>
						</div>
						<label>
							Zoom (nautical miles)
							<div className="zooms">
								{ZOOM_PRESETS.map((nm) => (
									<button
										key={nm}
										type="button"
										className={form.radiusNm === nm ? "active" : ""}
										onClick={() => setField("radiusNm", nm)}
									>
										{nm}
									</button>
								))}
							</div>
						</label>
						<div className="row-2">
							<label>
								Min SOG (kn)
								<input
									type="number"
									step="0.1"
									value={form.minSog}
									onChange={(e) => setField("minSog", Number(e.target.value))}
								/>
							</label>
							<label>
								Device refresh (sec)
								<input
									type="number"
									min={30}
									max={3600}
									value={form.refreshRate}
									onChange={(e) => setField("refreshRate", Number(e.target.value))}
								/>
							</label>
						</div>
						<div className="actions">
							<button className="primary" type="button" disabled={busy} onClick={() => void apply()}>
								{busy ? "Sweeping…" : "Apply + sweep"}
							</button>
							<button type="button" onClick={() => void load()}>
								Reload
							</button>
						</div>
						<div className="flash">
							OG custom server: <code>/t/DEVICE_TOKEN</code>
							{device?.fwVersion ? ` · FW ${device.fwVersion}` : ""}
							{device?.batteryVoltage ? ` · ${device.batteryVoltage}V` : ""}
						</div>
					</div>
				</aside>
			</div>

			<section className="panel" style={{ marginTop: 18 }}>
				<div className="panel-h">
					<span>Moving contacts</span>
					<span>{vessels.length} tracks</span>
				</div>
				<VesselTable snapshot={status?.snapshot ?? null} />
			</section>
		</div>
	);
}

function VesselTable({ snapshot }: { snapshot: VesselSnapshot | null }) {
	const vessels = snapshot?.vessels ?? [];
	if (!vessels.length) {
		return <div className="scope-empty">No moving vessels in the current box.</div>;
	}
	return (
		<table>
			<thead>
				<tr>
					<th>Name</th>
					<th>From</th>
					<th>Dest</th>
					<th>SOG</th>
					<th>COG</th>
					<th>MMSI</th>
				</tr>
			</thead>
			<tbody>
				{vessels.map((vessel) => (
					<tr key={vessel.mmsi}>
						<td>{vessel.name}</td>
						<td>{vessel.origin}</td>
						<td>{vessel.destination}</td>
						<td>{vessel.sog.toFixed(1)}</td>
						<td>{Math.round(vessel.cog)}</td>
						<td>{vessel.mmsi}</td>
					</tr>
				))}
			</tbody>
		</table>
	);
}

function utcNow(): string {
	return new Date().toISOString().slice(11, 19) + "Z";
}
