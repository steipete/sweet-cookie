export function isBunRuntime(): boolean {
	// Bun: https://bun.sh/docs/runtime/environment-variables#bun-specific
	if (typeof process === "undefined") {
		return false;
	}
	const bunVersion = (process.versions as unknown as { bun?: unknown }).bun;
	return typeof process.versions === "object" && typeof bunVersion === "string";
}
