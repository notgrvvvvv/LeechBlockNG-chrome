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

const VOID_HTML_TAGS = new Set([
	"area",
	"base",
	"br",
	"col",
	"embed",
	"hr",
	"img",
	"input",
	"link",
	"meta",
	"param",
	"source",
	"track",
	"wbr",
]);

function extractPlaceholders(message) {
	const names = new Set();
	if (typeof message !== "string") {
		return names;
	}
	const regex = /\{([A-Za-z0-9_-]+)\}/g;
	let match;
	while ((match = regex.exec(message)) !== null) {
		names.add(match[1]);
	}
	return names;
}

function getHtmlAttr(attrsText, attrName) {
	if (!attrsText) return null;
	const regex = new RegExp(`\\b${attrName}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i");
	const match = regex.exec(attrsText);
	return match ? (match[1] ?? match[2] ?? "") : null;
}

function extractHtmlI18nElements(html) {
	const cleaned = html.replace(/<!--[\s\S]*?-->/g, "");
	const tagRegex = /<(\/?)([A-Za-z][A-Za-z0-9-]*)(\s[^>]*?)?(\/?)>/g;
	const stack = [];
	const elements = [];

	let match;
	while ((match = tagRegex.exec(cleaned)) !== null) {
		const isClosing = match[1] === "/";
		const tagName = match[2].toLowerCase();
		const attrsText = match[3] || "";
		const isSelfClosing = match[4] === "/" || VOID_HTML_TAGS.has(tagName);

		if (isClosing) {
			for (let i = stack.length - 1; i >= 0; i--) {
				if (stack[i].tagName === tagName) {
					while (stack.length > i) {
						const popped = stack.pop();
						if (popped.i18nKey) {
							elements.push({ key: popped.i18nKey, slots: popped.slots });
						}
					}
					break;
				}
			}
			continue;
		}

		const dataSlot = getHtmlAttr(attrsText, "data-slot");
		const id = getHtmlAttr(attrsText, "id");
		const slotName = dataSlot || id;
		if (slotName) {
			for (const ancestor of stack) {
				if (ancestor.i18nKey) {
					ancestor.slots.add(slotName);
				}
			}
		}

		const i18nKey = getHtmlAttr(attrsText, "data-i18n");
		if (isSelfClosing) {
			if (i18nKey) {
				elements.push({ key: i18nKey, slots: new Set() });
			}
		} else {
			stack.push({ tagName, i18nKey, slots: new Set() });
		}
	}

	while (stack.length > 0) {
		const popped = stack.pop();
		if (popped.i18nKey) {
			elements.push({ key: popped.i18nKey, slots: popped.slots });
		}
	}

	return elements;
}

function checkHtmlSlotParity(html, catalog) {
	const mismatches = [];
	const elements = extractHtmlI18nElements(html);

	for (const { key, slots } of elements) {
		const entry = catalog[key];
		if (!entry) continue;
		const placeholders = extractPlaceholders(entry.message);
		if (placeholders.size === 0 && slots.size === 0) continue;

		const missingInHtml = [...placeholders].filter((p) => !slots.has(p)).sort();
		const unusedInMsg = [...slots].filter((s) => !placeholders.has(s)).sort();
		if (missingInHtml.length > 0 || unusedInMsg.length > 0) {
			const parts = [];
			if (missingInHtml.length > 0) {
				parts.push(`missing slots in HTML: ${missingInHtml.join(", ")}`);
			}
			if (unusedInMsg.length > 0) {
				parts.push(`unreferenced slots in message: ${unusedInMsg.join(", ")}`);
			}
			mismatches.push(`${key}: ${parts.join("; ")}`);
		}
	}

	return { ok: mismatches.length === 0, mismatches };
}

function comparePlaceholderSets(enCatalog, itCatalog) {
	const mismatches = [];
	for (const key of Object.keys(enCatalog)) {
		if (!Object.hasOwn(itCatalog, key)) continue;
		const enSet = extractPlaceholders(enCatalog[key].message);
		const itSet = extractPlaceholders(itCatalog[key].message);
		const missingInIt = [...enSet].filter((p) => !itSet.has(p)).sort();
		const missingInEn = [...itSet].filter((p) => !enSet.has(p)).sort();
		if (missingInIt.length > 0 || missingInEn.length > 0) {
			const parts = [];
			if (missingInIt.length > 0) {
				parts.push(`missing in it: ${missingInIt.join(", ")}`);
			}
			if (missingInEn.length > 0) {
				parts.push(`missing in en: ${missingInEn.join(", ")}`);
			}
			mismatches.push(`${key}: ${parts.join("; ")}`);
		}
	}
	return { ok: mismatches.length === 0, mismatches };
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

test("negative control: checkHtmlSlotParity reports missing and unreferenced slots", () => {
	const sampleHtml = '<p data-i18n="countdown">In <span id="lbDelaySeconds">0</span> s</p>';

	const missingSlotCatalog = {
		countdown: { message: "In {lbDelaySeconds} and {extra} s" },
	};
	const missingResult = checkHtmlSlotParity(sampleHtml, missingSlotCatalog);
	assert.equal(missingResult.ok, false);
	assert.match(missingResult.mismatches.join("\n"), /missing slots in HTML: extra/);

	const unreferencedSlotCatalog = {
		countdown: { message: "Countdown without placeholder" },
	};
	const unreferencedResult = checkHtmlSlotParity(sampleHtml, unreferencedSlotCatalog);
	assert.equal(unreferencedResult.ok, false);
	assert.match(unreferencedResult.mismatches.join("\n"), /unreferenced slots in message: lbDelaySeconds/);
});

test("negative control: comparePlaceholderSets reports mismatched placeholders between en and it", () => {
	const enSample = { msg: { message: "Hello {link}" } };
	const itSample = { msg: { message: "Ciao {other}" } };
	const result = comparePlaceholderSets(enSample, itSample);
	assert.equal(result.ok, false);
	assert.match(result.mismatches.join("\n"), /missing in it: link/);
	assert.match(result.mismatches.join("\n"), /missing in en: other/);
});

test("HTML slot parity: every data-i18n element with placeholders matches its descendant slots in en and it", () => {
	const en = readJson("_locales/en/messages.json");
	const it = readJson("_locales/it/messages.json");

	for (const relPath of LOCALIZED_HTML_FILES) {
		const html = fs.readFileSync(path.join(ROOT, relPath), "utf8");
		const enCheck = checkHtmlSlotParity(html, en);
		assert.equal(enCheck.ok, true, `${relPath} (en) slot mismatch: ${enCheck.mismatches.join("; ")}`);

		const itCheck = checkHtmlSlotParity(html, it);
		assert.equal(itCheck.ok, true, `${relPath} (it) slot mismatch: ${itCheck.mismatches.join("; ")}`);
	}
});

test("placeholder sets are identical between en and it for every catalog key", () => {
	const en = readJson("_locales/en/messages.json");
	const it = readJson("_locales/it/messages.json");
	const result = comparePlaceholderSets(en, it);
	assert.equal(result.ok, true, `Placeholder mismatch between en and it: ${result.mismatches.join("; ")}`);
});
