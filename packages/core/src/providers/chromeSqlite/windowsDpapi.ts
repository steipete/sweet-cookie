import { execCapture } from '../../util/exec.js';

export async function dpapiUnprotect(
	data: Buffer,
	options: { timeoutMs?: number } = {}
): Promise<{ ok: true; value: Buffer } | { ok: false; error: string }> {
	const timeoutMs = options.timeoutMs ?? 5_000;

	const inputB64 = data.toString('base64');
	const prelude =
		'try { Add-Type -AssemblyName System.Security.Cryptography.ProtectedData -ErrorAction Stop } catch { try { Add-Type -AssemblyName System.Security -ErrorAction Stop } catch {} };';
	const script =
		prelude +
		`$in=[Convert]::FromBase64String('${inputB64}');` +
		`$out=[System.Security.Cryptography.ProtectedData]::Unprotect($in,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser);` +
		`[Convert]::ToBase64String($out)`;

	const res = await execCapture(
		'powershell',
		['-NoProfile', '-NonInteractive', '-Command', script],
		{
			timeoutMs,
		}
	);
	if (res.code !== 0) {
		return { ok: false, error: res.stderr.trim() || `powershell exit ${res.code}` };
	}

	try {
		const out = Buffer.from(res.stdout.trim(), 'base64');
		return { ok: true, value: out };
	} catch (error) {
		return { ok: false, error: error instanceof Error ? error.message : String(error) };
	}
}
