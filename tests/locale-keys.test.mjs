/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const LOCALIZED_HTML_FILES = [
	"popup.html",
	"blocked.html",
	"delayed.html",
	"password.html",
];

const REMOVED_LOCALE_FOLDERS = [
	"it",
	"de",
	"es",
	"az",
	"he",
	"pt_BR",
	"sv",
	"vi",
	"zh",
];

function readJson(relPath) {
	return JSON.parse(fs.readFileSync(path.join(ROOT, relPath), "utf8"));
}

function compareCatalogKeys(enCatalog, itCatalog) {
	const enKeys = new Set(Object.keys(enCatalog));
	const itKeys = new Set(Object.keys(itCatalog));
	const missingInIt = [...enKeys].filter((k) => !itKeys.has(k)).sort();
	const missingInEn = [...itKeys].filter((k) => !enKeys.has(k)).sort();

	if (missingInIt.length > 0 || missingInEn.length > 0) {
		const parts = [];
		if (missingInIt.length > 0) {
			parts.push(`missing in it: ${missingInIt.join(", ")}`);
		}
		if (missingInEn.length > 0) {
			parts.push(`missing in en: ${missingInEn.join(", ")}`);
		}
		return { equal: false, missingInIt, missingInEn, message: parts.join("; ") };
	}

	return { equal: true, missingInIt: [], missingInEn: [], message: "" };
}

function extractHtmlI18nKeys(html) {
	const keys = [];
	const regex = /\bdata-i18n(?:-[a-z-]+)?="([^"]+)"/g;
	let match;
	while ((match = regex.exec(html)) !== null) {
		keys.push(match[1]);
	}
	return keys;
}

function extractManifestMsgKeys(manifestText) {
	const keys = [];
	const regex = /__MSG_([A-Za-z0-9_@]+)__/g;
	let match;
	while ((match = regex.exec(manifestText)) !== null) {
		keys.push(match[1]);
	}
	return keys;
}

test("negative control: compareCatalogKeys reports a missing key when catalogs differ", () => {
	const base = {
		a: { message: "A" },
		b: { message: "B" },
	};
	const missingOne = {
		a: { message: "A" },
	};

	const diffIt = compareCatalogKeys(base, missingOne);
	assert.equal(diffIt.equal, false);
	assert.deepEqual(diffIt.missingInIt, ["b"]);
	assert.deepEqual(diffIt.missingInEn, []);
	assert.match(diffIt.message, /\bb\b/);

	const diffEn = compareCatalogKeys(missingOne, base);
	assert.equal(diffEn.equal, false);
	assert.deepEqual(diffEn.missingInEn, ["b"]);
	assert.deepEqual(diffEn.missingInIt, []);
	assert.match(diffEn.message, /\bb\b/);
});

test("_locales/en/messages.json and _locales/it/messages.json have identical key sets", () => {
	const en = readJson("_locales/en/messages.json");
	const it = readJson("_locales/it/messages.json");
	const result = compareCatalogKeys(en, it);
	assert.equal(result.equal, true, `Locale catalogs out of sync: ${result.message}`);
});

test("every data-i18n* key in the four HTML pages exists in both en and it catalogs", () => {
	const en = readJson("_locales/en/messages.json");
	const it = readJson("_locales/it/messages.json");

	for (const relPath of LOCALIZED_HTML_FILES) {
		const html = fs.readFileSync(path.join(ROOT, relPath), "utf8");
		const keys = extractHtmlI18nKeys(html);
		assert.ok(keys.length > 0, `Expected at least one data-i18n* key in ${relPath}`);

		for (const key of keys) {
			assert.ok(Object.hasOwn(en, key), `${relPath}: key "${key}" missing in _locales/en/messages.json`);
			assert.ok(Object.hasOwn(it, key), `${relPath}: key "${key}" missing in _locales/it/messages.json`);
		}
	}
});

test("every __MSG_x__ key in manifest.json exists in both en and it catalogs and all commands are localized", () => {
	const en = readJson("_locales/en/messages.json");
	const it = readJson("_locales/it/messages.json");
	const manifestText = fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8");
	const manifest = JSON.parse(manifestText);

	const keys = extractManifestMsgKeys(manifestText);
	assert.ok(keys.length > 0, "Expected __MSG_x__ keys in manifest.json");

	for (const key of keys) {
		assert.ok(Object.hasOwn(en, key), `manifest.json: key "${key}" missing in _locales/en/messages.json`);
		assert.ok(Object.hasOwn(it, key), `manifest.json: key "${key}" missing in _locales/it/messages.json`);
	}

	for (const [cmdName, cmdSpec] of Object.entries(manifest.commands || {})) {
		assert.match(
			cmdSpec.description,
			/^__MSG_[A-Za-z0-9_@]+__$/,
			`manifest.json command "${cmdName}" description must use __MSG_x__`
		);
	}
});

test("_locales contains only en and it, no per-language HTML folders remain, and localePath is '/' in both", () => {
	const localeDirs = fs
		.readdirSync(path.join(ROOT, "_locales"), { withFileTypes: true })
		.filter((d) => d.isDirectory())
		.map((d) => d.name)
		.sort();
	assert.deepEqual(localeDirs, ["en", "it"]);

	for (const folder of REMOVED_LOCALE_FOLDERS) {
		assert.equal(
			fs.existsSync(path.join(ROOT, folder)),
			false,
			`Legacy per-language folder "${folder}/" should have been removed`
		);
	}

	const en = readJson("_locales/en/messages.json");
	const it = readJson("_locales/it/messages.json");
	assert.equal(en.localePath?.message, "/");
	assert.equal(it.localePath?.message, "/");
});
