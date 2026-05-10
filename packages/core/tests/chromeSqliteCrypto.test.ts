import { createCipheriv } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
	decryptChromiumAes128CbcCookieValue,
	decryptChromiumAes256GcmCookieValue,
	deriveAes128CbcKeyFromPassword,
	getChromiumEncryptedValuePrefix,
} from "../src/providers/chromeSqlite/crypto.js";

describe("chromium cookie crypto", () => {
	it("detects Chromium encrypted value prefixes", () => {
		expect(getChromiumEncryptedValuePrefix(Buffer.from("v10payload"))).toBe("v10");
		expect(getChromiumEncryptedValuePrefix(Buffer.from("v20payload"))).toBe("v20");
		expect(getChromiumEncryptedValuePrefix(Buffer.from("v2"))).toBeNull();
		expect(getChromiumEncryptedValuePrefix(Buffer.from("abc"))).toBeNull();
	});

	it("decrypts AES-128-CBC v10 and strips hash prefix when requested", () => {
		const key = deriveAes128CbcKeyFromPassword("pw", { iterations: 1003 });
		const iv = Buffer.alloc(16, 0x20);

		const plaintext = Buffer.concat([Buffer.alloc(32, 0xff), Buffer.from("hello", "utf8")]);

		const cipher = createCipheriv("aes-128-cbc", key, iv);
		const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);

		const encryptedValue = Buffer.concat([Buffer.from("v10", "utf8"), ciphertext]);

		expect(
			decryptChromiumAes128CbcCookieValue(encryptedValue, [key], {
				stripHashPrefix: true,
				treatUnknownPrefixAsPlaintext: false,
			}),
		).toBe("hello");

		expect(
			decryptChromiumAes128CbcCookieValue(encryptedValue, [key], {
				stripHashPrefix: false,
				treatUnknownPrefixAsPlaintext: false,
			}),
		).toBeNull();
	});

	it("tries multiple AES-128-CBC keys (strict UTF-8 decode)", () => {
		const correctKey = deriveAes128CbcKeyFromPassword("pw", { iterations: 1 });
		const wrongKey = deriveAes128CbcKeyFromPassword("wrong", { iterations: 1 });
		const iv = Buffer.alloc(16, 0x20);

		const plaintext = Buffer.concat([Buffer.alloc(32, 0xff), Buffer.from("ok", "utf8")]);
		const cipher = createCipheriv("aes-128-cbc", correctKey, iv);
		const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
		const encryptedValue = Buffer.concat([Buffer.from("v10", "utf8"), ciphertext]);

		expect(
			decryptChromiumAes128CbcCookieValue(encryptedValue, [wrongKey, correctKey], {
				stripHashPrefix: true,
				treatUnknownPrefixAsPlaintext: false,
			}),
		).toBe("ok");
	});

	it("decrypts AES-256-GCM v10 and strips hash prefix when requested", () => {
		const key = Buffer.alloc(32, 7);
		const nonce = Buffer.alloc(12, 9);

		const plaintext = Buffer.concat([Buffer.alloc(32, 0xff), Buffer.from("cookie", "utf8")]);

		const cipher = createCipheriv("aes-256-gcm", key, nonce);
		const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
		const tag = cipher.getAuthTag();

		const encryptedValue = Buffer.concat([Buffer.from("v10", "utf8"), nonce, ciphertext, tag]);

		expect(
			decryptChromiumAes256GcmCookieValue(encryptedValue, key, { stripHashPrefix: true }),
		).toBe("cookie");

		expect(
			decryptChromiumAes256GcmCookieValue(encryptedValue, key, { stripHashPrefix: false }),
		).toBeNull();
	});
});
