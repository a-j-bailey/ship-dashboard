declare module "*.wasm" {
	const value: WebAssembly.Module;
	export default value;
}

declare module "*.json" {
	const value: Record<string, string>;
	export default value;
}
