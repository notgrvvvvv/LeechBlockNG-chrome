/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
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
	const names = [];
	if (typeof message !== "string") {
		return names;
	}
	const regex = /\{([A-Za-z0-9_-]+)\}/g;
	let match;
	while ((match = regex.exec(message)) !== null) {
		names.push(match[1]);
	}
	return names;
}

function countItems(items) {
	const counts = new Map();
	for (const item of items) {
		counts.set(item, (counts.get(item) || 0) + 1);
	}
	return counts;
}

function parseHtmlAttrs(attrsText) {
	const attrs = new Map();
	let i = 0;
	const len = attrsText.length;
	while (i < len) {
		while (i < len && /\s/.test(attrsText[i])) i++;
		if (i >= len || attrsText[i] === "/") break;
		const nameStart = i;
		while (i < len && !/[\s=/>]/.test(attrsText[i])) i++;
		const name = attrsText.slice(nameStart, i).toLowerCase();
		if (!name) {
			i++;
			continue;
		}
		while (i < len && /\s/.test(attrsText[i])) i++;
		let value = "";
		if (i < len && attrsText[i] === "=") {
			i++;
			while (i < len && /\s/.test(attrsText[i])) i++;
			if (i < len && (attrsText[i] === '"' || attrsText[i] === "'")) {
				const quote = attrsText[i++];
				const valStart = i;
				while (i < len && attrsText[i] !== quote) i++;
				value = attrsText.slice(valStart, i);
				if (i < len && attrsText[i] === quote) i++;
			} else {
				const valStart = i;
				while (i < len && !/[\s>]/.test(attrsText[i])) i++;
				value = attrsText.slice(valStart, i);
			}
		}
		if (!attrs.has(name)) {
			attrs.set(name, value);
		}
	}
	return attrs;
}

function scanHtmlTags(html) {
	const tags = [];
	let i = 0;
	const len = html.length;
	while (i < len) {
		const lt = html.indexOf("<", i);
		if (lt === -1) break;
		if (html.startsWith("<!--", lt)) {
			const endComment = html.indexOf("-->", lt + 4);
			i = endComment === -1 ? len : endComment + 3;
			continue;
		}
		if (html.startsWith("<!", lt) || html.startsWith("<?", lt)) {
			const gt = html.indexOf(">", lt + 2);
			i = gt === -1 ? len : gt + 1;
			continue;
		}
		let pos = lt + 1;
		const isClosing = html[pos] === "/";
		if (isClosing) pos++;
		if (pos >= len || !/[A-Za-z]/.test(html[pos])) {
			i = lt + 1;
			continue;
		}
		const nameStart = pos;
		while (pos < len && /[A-Za-z0-9-]/.test(html[pos])) pos++;
		const tagName = html.slice(nameStart, pos).toLowerCase();

		const attrStart = pos;
		let quote = null;
		while (pos < len) {
			const ch = html[pos];
			if (quote) {
				if (ch === quote) quote = null;
			} else if (ch === '"' || ch === "'") {
				quote = ch;
			} else if (ch === ">") {
				break;
			}
			pos++;
		}
		if (pos >= len) break;

		let attrsSlice = html.slice(attrStart, pos);
		let isSelfClosing = false;
		if (!isClosing) {
			const trimmedEnd = attrsSlice.trimEnd();
			if (trimmedEnd.endsWith("/")) {
				isSelfClosing = true;
				attrsSlice = trimmedEnd.slice(0, -1);
			}
			if (VOID_HTML_TAGS.has(tagName)) {
				isSelfClosing = true;
			}
		}

		tags.push({
			isClosing,
			tagName,
			attrs: isClosing ? new Map() : parseHtmlAttrs(attrsSlice),
			isSelfClosing,
		});

		i = pos + 1;
		if (!isClosing && !isSelfClosing && (tagName === "script" || tagName === "style")) {
			const closeRe = new RegExp(`</${tagName}\\s*>`, "ig");
			closeRe.lastIndex = i;
			const closeMatch = closeRe.exec(html);
			if (closeMatch) {
				tags.push({ isClosing: true, tagName, attrs: new Map(), isSelfClosing: false });
				i = closeMatch.index + closeMatch[0].length;
			} else {
				i = len;
			}
		}
	}
	return tags;
}

function extractHtmlI18nElements(html) {
	const stack = [];
	const elements = [];

	for (const tag of scanHtmlTags(html)) {
		if (tag.isClosing) {
			for (let i = stack.length - 1; i >= 0; i--) {
				if (stack[i].tagName === tag.tagName) {
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

		const dataSlot = tag.attrs.get("data-slot") || "";
		const id = tag.attrs.get("id") || "";
		const slotName = dataSlot || id;
		const isSlot = Boolean(slotName);
		if (isSlot) {
			for (let i = stack.length - 1; i >= 0; i--) {
				if (stack[i].i18nKey) {
					stack[i].slots.push(slotName);
				}
				if (stack[i].isSlot) {
					break;
				}
			}
		}

		const i18nKey = tag.attrs.get("data-i18n") || null;
		if (tag.isSelfClosing) {
			if (i18nKey) {
				elements.push({ key: i18nKey, slots: [] });
			}
		} else {
			stack.push({ tagName: tag.tagName, i18nKey, isSlot, slots: [] });
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
		const placeholderList = extractPlaceholders(entry.message);
		if (placeholderList.length === 0 && slots.length === 0) continue;

		const placeholderCounts = countItems(placeholderList);
		const slotCounts = countItems(slots);

		const missingInHtml = [...placeholderCounts.keys()].filter((p) => !slotCounts.has(p)).sort();
		const unusedInMsg = [...slotCounts.keys()].filter((s) => !placeholderCounts.has(s)).sort();
		const duplicatePlaceholders = [...placeholderCounts.entries()]
			.filter(([, count]) => count > 1)
			.map(([name, count]) => `${name} (${count}x)`)
			.sort();
		const duplicateSlots = [...slotCounts.entries()]
			.filter(([, count]) => count > 1)
			.map(([name, count]) => `${name} (${count}x)`)
			.sort();

		if (
			missingInHtml.length > 0 ||
			unusedInMsg.length > 0 ||
			duplicatePlaceholders.length > 0 ||
			duplicateSlots.length > 0
		) {
			const parts = [];
			if (missingInHtml.length > 0) {
				parts.push(`missing slots in HTML: ${missingInHtml.join(", ")}`);
			}
			if (unusedInMsg.length > 0) {
				parts.push(`unreferenced slots in message: ${unusedInMsg.join(", ")}`);
			}
			if (duplicatePlaceholders.length > 0) {
				parts.push(`duplicate placeholders in message: ${duplicatePlaceholders.join(", ")}`);
			}
			if (duplicateSlots.length > 0) {
				parts.push(`duplicate slots in HTML: ${duplicateSlots.join(", ")}`);
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
		const enCounts = countItems(extractPlaceholders(enCatalog[key].message));
		const itCounts = countItems(extractPlaceholders(itCatalog[key].message));

		const missingInIt = [...enCounts.keys()].filter((p) => !itCounts.has(p)).sort();
		const missingInEn = [...itCounts.keys()].filter((p) => !enCounts.has(p)).sort();
		const duplicateInEn = [...enCounts.entries()]
			.filter(([, count]) => count > 1)
			.map(([name, count]) => `${name} (${count}x)`)
			.sort();
		const duplicateInIt = [...itCounts.entries()]
			.filter(([, count]) => count > 1)
			.map(([name, count]) => `${name} (${count}x)`)
			.sort();

		if (
			missingInIt.length > 0 ||
			missingInEn.length > 0 ||
			duplicateInEn.length > 0 ||
			duplicateInIt.length > 0
		) {
			const parts = [];
			if (missingInIt.length > 0) {
				parts.push(`missing in it: ${missingInIt.join(", ")}`);
			}
			if (missingInEn.length > 0) {
				parts.push(`missing in en: ${missingInEn.join(", ")}`);
			}
			if (duplicateInEn.length > 0) {
				parts.push(`duplicate in en: ${duplicateInEn.join(", ")}`);
			}
			if (duplicateInIt.length > 0) {
				parts.push(`duplicate in it: ${duplicateInIt.join(", ")}`);
			}
			mismatches.push(`${key}: ${parts.join("; ")}`);
		}
	}
	return { ok: mismatches.length === 0, mismatches };
}

function runI18nInMockDom(rootEl, messages) {
	class MockText {
		constructor(text) {
			this.nodeType = 3;
			this.textContent = text;
			this.parentElement = null;
		}
	}

	class MockFragment {
		constructor() {
			this.nodeType = 11;
			this.childNodes = [];
		}
		appendChild(node) {
			if (node.parentElement) {
				const siblings = node.parentElement.childNodes;
				const idx = siblings.indexOf(node);
				if (idx !== -1) siblings.splice(idx, 1);
				node.parentElement = null;
			}
			this.childNodes.push(node);
			return node;
		}
	}

	class MockElement {
		constructor(tagName, attrs = {}, children = []) {
			this.nodeType = 1;
			this.tagName = tagName.toUpperCase();
			this.attrs = new Map(Object.entries(attrs));
			this.childNodes = [];
			this.parentElement = null;
			for (const child of children) {
				this.appendChild(child);
			}
		}
		get id() {
			return this.attrs.get("id") || "";
		}
		getAttribute(name) {
			return this.attrs.has(name) ? this.attrs.get(name) : null;
		}
		setAttribute(name, value) {
			this.attrs.set(name, String(value));
		}
		appendChild(node) {
			if (node instanceof MockFragment) {
				for (const child of [...node.childNodes]) {
					this.appendChild(child);
				}
				node.childNodes = [];
				return node;
			}
			if (node.parentElement) {
				const siblings = node.parentElement.childNodes;
				const idx = siblings.indexOf(node);
				if (idx !== -1) siblings.splice(idx, 1);
			}
			node.parentElement = this;
			this.childNodes.push(node);
			return node;
		}
		replaceChildren(...nodes) {
			for (const child of this.childNodes) {
				child.parentElement = null;
			}
			this.childNodes = [];
			for (const node of nodes) {
				this.appendChild(node);
			}
		}
		get textContent() {
			return this.childNodes.map((c) => c.textContent).join("");
		}
		set textContent(value) {
			this.replaceChildren(new MockText(String(value)));
		}
		querySelectorAll(selector) {
			const result = [];
			const matchAttr = (el, sel) => {
				if (sel === "[id], [data-slot]") {
					return Boolean(el.getAttribute("id") !== null || el.getAttribute("data-slot") !== null);
				}
				const attrMatch = /^\[([a-z0-9-]+)\]$/i.exec(sel);
				if (attrMatch) {
					return el.getAttribute(attrMatch[1]) !== null;
				}
				return false;
			};
			const walk = (node) => {
				for (const child of node.childNodes) {
					if (child.nodeType === 1) {
						if (matchAttr(child, selector)) {
							result.push(child);
						}
						walk(child);
					}
				}
			};
			walk(this);
			return result;
		}
	}

	function build(spec) {
		if (typeof spec === "string") return new MockText(spec);
		return new MockElement(spec.tag, spec.attrs || {}, (spec.children || []).map(build));
	}

	const root = build(rootEl);
	const documentMock = {
		documentElement: { lang: "en" },
		title: "",
		querySelectorAll: (sel) => root.querySelectorAll(sel),
		createDocumentFragment: () => new MockFragment(),
		createElement: (tag) => new MockElement(tag),
		createTextNode: (text) => new MockText(text),
	};
	const i18nSource = fs.readFileSync(path.join(ROOT, "i18n.js"), "utf8");
	vm.runInNewContext(i18nSource, {
		document: documentMock,
		chrome: {
			i18n: {
				getMessage: (key) => messages[key] || "",
			},
		},
	});
	return { root, document: documentMock };
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

test("negative control: checkHtmlSlotParity reports missing, unreferenced, and duplicate placeholders, and handles quoted '>' attributes", () => {
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

	const duplicatePlaceholderCatalog = {
		countdown: { message: "In {lbDelaySeconds} or {lbDelaySeconds} s" },
	};
	const duplicateResult = checkHtmlSlotParity(sampleHtml, duplicatePlaceholderCatalog);
	assert.equal(duplicateResult.ok, false);
	assert.match(duplicateResult.mismatches.join("\n"), /duplicate placeholders in message: lbDelaySeconds \(2x\)/);

	const quotedGtHtml = '<p title="a > b" data-i18n="kw">Matched: <span id="lbKeywordMatch"></span></p>';
	const quotedGtOk = checkHtmlSlotParity(quotedGtHtml, {
		kw: { message: "Parola: {lbKeywordMatch}" },
	});
	assert.equal(quotedGtOk.ok, true);

	const quotedGtBad = checkHtmlSlotParity(quotedGtHtml, {
		kw: { message: "Parola: {lbKeywordMatch} {lbKeywordMatch}" },
	});
	assert.equal(quotedGtBad.ok, false);
	assert.match(quotedGtBad.mismatches.join("\n"), /duplicate placeholders in message: lbKeywordMatch \(2x\)/);

	const quotedGtMissing = checkHtmlSlotParity(quotedGtHtml, {
		kw: { message: "Parola senza slot" },
	});
	assert.equal(quotedGtMissing.ok, false);
	assert.match(quotedGtMissing.mismatches.join("\n"), /unreferenced slots in message: lbKeywordMatch/);
});

test("negative control: comparePlaceholderSets reports mismatched and duplicate placeholders between en and it", () => {
	const enSample = { msg: { message: "Hello {link}" } };
	const itSample = { msg: { message: "Ciao {other}" } };
	const result = comparePlaceholderSets(enSample, itSample);
	assert.equal(result.ok, false);
	assert.match(result.mismatches.join("\n"), /missing in it: link/);
	assert.match(result.mismatches.join("\n"), /missing in en: other/);

	const enKw = { blockedKeywordMatched: { message: "Keyword matched: {lbKeywordMatch}" } };
	const itDupKw = { blockedKeywordMatched: { message: "Parola: {lbKeywordMatch} {lbKeywordMatch}" } };
	const dupResult = comparePlaceholderSets(enKw, itDupKw);
	assert.equal(dupResult.ok, false);
	assert.match(dupResult.mismatches.join("\n"), /duplicate in it: lbKeywordMatch \(2x\)/);
});

test("outermost slots only: nested ID'd descendants inside a slot are not separate slots and move intact", () => {
	const nestedHtml =
		'<p data-i18n="notice">Visit <a href="#" data-slot="outer"><span id="innerId">LeechBlock</span></a> now.</p>';
	const elements = extractHtmlI18nElements(nestedHtml);
	assert.equal(elements.length, 1);
	assert.deepEqual(elements[0], { key: "notice", slots: ["outer"] });

	assert.equal(
		checkHtmlSlotParity(nestedHtml, { notice: { message: "Visita {outer} ora." } }).ok,
		true
	);
	assert.equal(
		checkHtmlSlotParity(nestedHtml, { notice: { message: "Visita {outer} ({innerId}) ora." } }).ok,
		false
	);

	// Verify i18n.js runtime behavior in an in-memory DOM:
	// 1) Moving an outermost slot keeps its ID'd descendant intact inside it.
	const { root: movedRoot } = runI18nInMockDom(
		{
			tag: "div",
			children: [
				{
					tag: "p",
					attrs: { "data-i18n": "notice" },
					children: [
						"Visit ",
						{
							tag: "a",
							attrs: { "data-slot": "outer" },
							children: [{ tag: "span", attrs: { id: "innerId" }, children: ["LeechBlock"] }],
						},
						" now.",
					],
				},
			],
		},
		{ notice: "Ora visita {outer}!" }
	);
	const pMoved = movedRoot.childNodes[0];
	assert.equal(pMoved.textContent, "Ora visita LeechBlock!");
	assert.equal(pMoved.childNodes.length, 3);
	const outerSlot = pMoved.childNodes[1];
	assert.equal(outerSlot.getAttribute("data-slot"), "outer");
	assert.equal(outerSlot.childNodes.length, 1);
	assert.equal(outerSlot.childNodes[0].id, "innerId");
	assert.equal(outerSlot.childNodes[0].parentElement, outerSlot);

	// 2) Omitting an actual outermost slot leaves the DOM untouched.
	const { root: untouchedRoot } = runI18nInMockDom(
		{
			tag: "div",
			children: [
				{
					tag: "p",
					attrs: { "data-i18n": "twoSlots" },
					children: [
						"First ",
						{ tag: "span", attrs: { id: "slotA" }, children: ["A"] },
						" and ",
						{ tag: "span", attrs: { id: "slotB" }, children: ["B"] },
					],
				},
			],
		},
		{ twoSlots: "Solo {slotA}" }
	);
	assert.equal(untouchedRoot.childNodes[0].textContent, "First A and B");

	// 3) Duplicate placeholder in message leaves the DOM untouched.
	const { root: dupRoot } = runI18nInMockDom(
		{
			tag: "div",
			children: [
				{
					tag: "p",
					attrs: { "data-i18n": "kw" },
					children: ["Keyword: ", { tag: "span", attrs: { id: "lbKeywordMatch" }, children: ["foo"] }],
				},
			],
		},
		{ kw: "Parola: {lbKeywordMatch} {lbKeywordMatch}" }
	);
	assert.equal(dupRoot.childNodes[0].textContent, "Keyword: foo");
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
