/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import test from "node:test";
import assert from "node:assert/strict";
import { loadCommon } from "./load-common.mjs";

const common = loadCommon({
	browser: {
		i18n: {
			getMessage: (key) => (key === "localePath" ? "/" : ""),
		},
	},
});

test("normalizeLegacyBlockURL and getLocalizedURL normalize exact legacy internal block URLs", () => {
	const pages = ["blocked", "delayed", "password"];
	const prefixes = ["", "/", "it/", "/it/", "pt_BR/", "/pt_BR/"];

	for (const page of pages) {
		const expectedNormalized = `${page}.html?$S&$U`;
		const expectedLocalized = `/${expectedNormalized}`;
		for (const prefix of prefixes) {
			const input = `${prefix}${page}.html?$S&$U`;
			assert.equal(common.normalizeLegacyBlockURL(input), expectedNormalized, `helper(${input})`);
			assert.equal(common.getLocalizedURL(input), expectedLocalized, `getLocalizedURL(${input})`);
		}
	}
});

test("normalizeLegacyBlockURL and getLocalizedURL leave absolute URLs byte-identical", () => {
	const absoluteURLs = [
		"https://example.com/",
		"about:blank",
		"chrome-extension://abcdefghijklmnop/it/blocked.html?$S&$U",
	];

	for (const url of absoluteURLs) {
		assert.equal(common.normalizeLegacyBlockURL(url), url, `helper(${url})`);
		assert.equal(common.getLocalizedURL(url), url, `getLocalizedURL(${url})`);
	}
});

test("normalizeLegacyBlockURL leaves non-matching relative variants unchanged and getLocalizedURL prefixes them as before", () => {
	const nonMatching = [
		"it/blocked.html?$S&$U&x=1",
		"it/blocked.html?$S&$U#h",
		"IT/Blocked.html?$S&$U",
		"a/b/blocked.html?$S&$U",
		"it/other.html?$S&$U",
	];

	for (const url of nonMatching) {
		assert.equal(common.normalizeLegacyBlockURL(url), url, `helper(${url})`);
		assert.equal(common.getLocalizedURL(url), `/${url}`, `getLocalizedURL(${url})`);
	}
});
