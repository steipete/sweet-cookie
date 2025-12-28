import { defineConfig } from 'vitest/config';

const coverageExclude = ['**/*.d.ts', '**/dist/**', '**/node_modules/**', '**/tests/**'];

if (process.platform !== 'darwin') {
	coverageExclude.push('packages/core/src/providers/safariBinaryCookies.ts');
	coverageExclude.push('packages/core/src/providers/edgeSqliteMac.ts');
}

if (process.platform !== 'linux') {
	coverageExclude.push('packages/core/src/providers/chromeSqliteLinux.ts');
	coverageExclude.push('packages/core/src/providers/chromeSqlite/linuxKeyring.ts');
	coverageExclude.push('packages/core/src/providers/edgeSqliteLinux.ts');
}

if (process.platform !== 'win32') {
	coverageExclude.push('packages/core/src/providers/chromeSqliteWindows.ts');
	coverageExclude.push('packages/core/src/providers/chromeSqlite/windowsDpapi.ts');
	coverageExclude.push('packages/core/src/providers/edgeSqliteWindows.ts');
}

export default defineConfig({
	test: {
		environment: 'node',
		poolOptions: {
			threads: {
				minThreads: 1,
				maxThreads: 1,
			},
		},
		include: ['packages/**/tests/**/*.test.ts'],
		exclude: ['**/dist/**', '**/node_modules/**', '**/coverage/**'],
		coverage: {
			provider: 'v8',
			all: true,
			include: ['packages/core/src/**/*.ts'],
			exclude: coverageExclude,
			thresholds: {
				branches: 70,
				functions: 70,
				lines: 70,
				statements: 70,
			},
		},
	},
});
