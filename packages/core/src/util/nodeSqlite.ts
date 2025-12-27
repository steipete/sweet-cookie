type NodeSqliteModule = typeof import('node:sqlite');

let cached: NodeSqliteModule | null = null;

function shouldSuppressSqliteExperimentalWarning(warning: unknown, args: unknown[]): boolean {
	const message =
		typeof warning === 'string'
			? warning
			: warning instanceof Error
				? warning.message
				: typeof (warning as { message?: unknown } | null)?.message === 'string'
					? (warning as { message: string }).message
					: null;

	if (!message || !message.includes('SQLite is an experimental feature')) return false;

	// Best-effort: only swallow the one noisy warning that Node emits when loading `node:sqlite`.
	// We do *not* suppress arbitrary warnings, and we restore the original handler immediately.
	const firstArg = args[0];
	if (firstArg === 'ExperimentalWarning') return true;
	if (typeof firstArg === 'object' && firstArg) {
		const type = (firstArg as { type?: unknown }).type;
		if (type === 'ExperimentalWarning') return true;
	}
	if (warning instanceof Error && (warning as { name?: unknown }).name === 'ExperimentalWarning')
		return true;

	return false;
}

export async function importNodeSqlite(): Promise<NodeSqliteModule> {
	if (cached) return cached;

	// Node currently emits an ExperimentalWarning when importing `node:sqlite`.
	// This is harmless noise for consumers of this library, so we silence only that specific warning.
	const originalEmitWarning = process.emitWarning.bind(process);

	process.emitWarning = ((warning: unknown, ...args: unknown[]) => {
		if (shouldSuppressSqliteExperimentalWarning(warning, args)) return;
		// @ts-expect-error - Node's overloads are awkward; preserve runtime behavior.
		return originalEmitWarning(warning, ...args);
	}) as typeof process.emitWarning;

	try {
		cached = await import('node:sqlite');
		return cached;
	} finally {
		process.emitWarning = originalEmitWarning;
	}
}
