import { defineConfig } from "vitest/config";

const coverageExclude = [
	"**/*.d.ts",
	"**/dist/**",
	"**/node_modules/**",
	"**/tests/**",
	// Public re-export/type entrypoints; behavior exercised through imported modules.
	"packages/core/src/index.ts",
	"packages/core/src/types.ts",
	// Thin platform dispatch wrappers; covered indirectly in OS-specific provider tests.
	"packages/core/src/providers/chrome.ts",
	"packages/core/src/providers/edge.ts",
	// Depends on external keyring tooling; keep coverage stable across CI environments.
	"packages/core/src/providers/chromeSqlite/linuxKeyring.ts",
];

if (process.platform !== "darwin") {
	coverageExclude.push("packages/core/src/providers/safariBinaryCookies.ts");
	coverageExclude.push("packages/core/src/providers/edgeSqliteMac.ts");
}

if (process.platform !== "linux") {
	coverageExclude.push("packages/core/src/providers/chromeSqliteLinux.ts");
	coverageExclude.push("packages/core/src/providers/chromeSqlite/linuxKeyring.ts");
	coverageExclude.push("packages/core/src/providers/edgeSqliteLinux.ts");
}

if (process.platform !== "win32") {
	coverageExclude.push("packages/core/src/providers/chromeSqliteWindows.ts");
	coverageExclude.push("packages/core/src/providers/chromeSqlite/windowsDpapi.ts");
	coverageExclude.push("packages/core/src/providers/edgeSqliteWindows.ts");
}

export default defineConfig({
	test: {
		environment: "node",
		maxWorkers: 1,
		include: ["packages/**/tests/**/*.test.ts", "apps/**/tests/**/*.test.ts"],
		exclude: ["**/dist/**", "**/node_modules/**", "**/coverage/**"],
		coverage: {
			provider: "v8",
			all: true,
			include: ["packages/core/src/**/*.ts"],
			exclude: coverageExclude,
			excludeAfterRemap: true,
			thresholds: {
				branches: 70,
				functions: 90,
				lines: 84,
				statements: 84,
			},
		},
	},
});
