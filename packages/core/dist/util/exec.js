import { spawn } from 'node:child_process';
export async function execCapture(file, args, options = {}) {
    const timeoutMs = options.timeoutMs ?? 10_000;
    const runOnce = (executable) => new Promise((resolve) => {
        const child = spawn(executable, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', (chunk) => {
            stdout += chunk;
        });
        child.stderr.on('data', (chunk) => {
            stderr += chunk;
        });
        const timer = setTimeout(() => {
            try {
                child.kill('SIGKILL');
            }
            catch {
                // ignore
            }
            resolve({ code: 124, stdout, stderr: `${stderr}\nTimed out after ${timeoutMs}ms` });
        }, timeoutMs);
        timer.unref?.();
        child.on('error', (error) => {
            clearTimeout(timer);
            resolve({
                code: 127,
                stdout,
                stderr: `${stderr}\n${error instanceof Error ? error.message : String(error)}`,
            });
        });
        child.on('close', (code) => {
            clearTimeout(timer);
            resolve({ code: code ?? 0, stdout, stderr });
        });
    });
    const result = await runOnce(file);
    if (process.platform !== 'win32')
        return result;
    const stderr = result.stderr.toLowerCase();
    if (result.code === 127 && stderr.includes('enoent') && !file.toLowerCase().endsWith('.cmd')) {
        const cmdResult = await runOnce(`${file}.cmd`);
        if (!(cmdResult.code === 127 && cmdResult.stderr.toLowerCase().includes('enoent')))
            return cmdResult;
    }
    if (result.code === 127 && stderr.includes('enoent') && !file.toLowerCase().endsWith('.bat')) {
        const batResult = await runOnce(`${file}.bat`);
        if (!(batResult.code === 127 && batResult.stderr.toLowerCase().includes('enoent')))
            return batResult;
    }
    return result;
}
//# sourceMappingURL=exec.js.map