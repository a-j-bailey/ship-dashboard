export type SetupResponse = {
	status: number;
	api_key: string;
	friendly_id: string;
	image_url: string;
	filename: string;
};

export type DisplayResponse = {
	status: number;
	image_url: string;
	filename: string;
	update_firmware: boolean;
	firmware_url: null;
	refresh_rate: string;
	reset_firmware: boolean;
};

export function setupResponse(apiKey: string, friendlyId: string, imageUrl: string, filename: string): SetupResponse {
	return {
		status: 200,
		api_key: apiKey,
		friendly_id: friendlyId,
		image_url: imageUrl,
		filename,
	};
}

export function displayResponse(imageUrl: string, filename: string, refreshRate: number): DisplayResponse {
	return {
		status: 0,
		image_url: imageUrl,
		filename,
		update_firmware: false,
		firmware_url: null,
		refresh_rate: String(refreshRate),
		reset_firmware: false,
	};
}

export function screenFilename(hash: string, updatedAt: number): string {
	return `radar-${hash}-${updatedAt}.png`;
}

export function absoluteUrl(request: Request, path: string): string {
	const url = new URL(request.url);
	return `${url.origin}${path}`;
}
