/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

// Loads common.js, options-transfer.js and options.js into one vm context with
// minimal DOM/jQuery/WebExtension mocks; returns handles for driving the wiring.
function loadOptions() {
	const elements = new Map();
	const dialogs = [];
	const downloads = [];
	const tabsCalls = [];
	const applied = [];

	function el(id) {
		if (!elements.has(id)) {
			elements.set(id, {
				id, value: "", checked: false, selectedIndex: 0, innerText: "", style: {}, disabled: false, files: [],
			});
		}
		return elements.get(id);
	}

	const jq = (sel) => {
		const chain = new Proxy(function () {}, {
			get(_t, prop) {
				if (prop === "dialog") return (arg) => { if (arg === "open") dialogs.push(sel); return chain; };
				if (prop === "tabs") return (...args) => { tabsCalls.push(args); return chain; };
				if (prop === "html" || prop === "val" || prop === "text") return () => "";
				return () => chain;
			},
		});
		return chain;
	};

	class MockBlob {
		constructor(parts, opts) { this.parts = parts; this.type = opts.type; this.endings = opts.endings; this.text = parts.join(""); }
	}
	class MockFileReader {
		readAsText(file) { this.result = file.content; queueMicrotask(() => this.onload({ target: this })); }
	}

	const context = {
		console,
		structuredClone,
		queueMicrotask,
		setTimeout,
		clearTimeout,
		warn: () => {},
		Blob: MockBlob,
		FileReader: MockFileReader,
		MouseEvent: class { constructor(type) { this.type = type; } },
		URL: { createObjectURL: (blob) => { return { blob }; }, revokeObjectURL: () => {} },
		$: jq,
		window: { addEventListener() {}, removeEventListener() {} },
		document: {
			getElementById: el,
			createElement: () => {
				const a = {
					setAttribute(k, v) { a[k] = v; },
					dispatchEvent() { downloads.push({ blob: a.href.blob, filename: a.download }); },
					click() { this.dispatchEvent(); },
				};
				return a;
			},
			createTextNode: () => ({}),
			body: { appendChild() {}, removeChild() {} },
		},
		chrome: {
			i18n: { getMessage: () => "" },
			storage: { local: { get: async () => ({}), set: async () => {} }, sync: { get: async () => ({}), set: async () => {} } },
			runtime: {
				getPlatformInfo: () => Promise.resolve({ os: "win" }),
				getManifest: () => ({ version: "1.8" }),
				getURL: (p) => p,
				sendMessage: async () => {},
			},
			tabs: { create() {} },
			permissions: { request: async () => true },
		},
	};
	vm.createContext(context);
	for (const f of ["common.js", "options-transfer.js", "options.js"]) {
		vm.runInContext(read(f), context, { filename: f });
	}
	// Stub heavy form routines; capture what would be applied to the form
	vm.runInContext(`
		var gNumSets = 2;
		applyImportOptions = function (o) { globalThis.__applied.push(o); gNumSets = Number(o.numSets); };
	`, context);
	context.__applied = applied;
	return { context, el, dialogs, downloads, tabsCalls, applied };
}

// Populate mock form elements for the given number of sets
function fillForm(h, numSets, overrides = {}) {
	const { context, el } = h;
	const run = (code) => vm.runInContext(code, context);
	run(`gNumSets = ${numSets};`);
	const PER = run("PER_SET_OPTIONS");
	const GEN = run("GENERAL_OPTIONS");
	for (let set = 1; set <= numSets; set++) {
		for (const name in PER) {
			const { type, id, def } = PER[name];
			if (type === "array") {
				def.forEach((v, i) => { el(`${id}${i}${set}`).checked = v; });
			} else if (type === "boolean") {
				el(`${id}${set}`).checked = def;
			} else {
				el(`${id}${set}`).value = def;
			}
		}
	}
	for (const name in GEN) {
		const { type, id, def } = GEN[name];
		if (!id) continue;
		if (type === "boolean") el(id).checked = def; else el(id).value = def;
	}
	el("numSets").value = String(numSets);
	for (const [id, props] of Object.entries(overrides)) Object.assign(el(id), props);
}

const tick = () => new Promise((r) => setTimeout(r, 0));

test("options.html loads options-transfer.js between common.js and options.js", () => {
	const html = read("options.html");
	const a = html.indexOf('<script src="/common.js"></script>');
	const b = html.indexOf('<script src="/options-transfer.js"></script>');
	const c = html.indexOf('<script src="/options.js"></script>');
	assert.ok(a >= 0 && a < b && b < c);
	assert.equal((html.match(/options-transfer\.js/g) || []).length, 1);
});

test("compileExportOptions keeps escaping and password omission", () => {
	const h = loadOptions();
	fillForm(h, 2, { customMsg1: { value: "a\nb" }, accessPassword: { value: "pw" } });
	const without = vm.runInContext("compileExportOptions(false)", h.context);
	assert.equal(without.customMsg1, "a\\nb");
	assert.ok(!("password" in without));
	assert.ok(!("passwordSetSpec1" in without));
	const withPw = vm.runInContext("compileExportOptions(true)", h.context);
	assert.equal(withPw.password, "pw");
	assert.ok("passwordSetSpec2" in withPw);
});

test("exportOptions downloads text produced by exportOptionsToText", () => {
	const h = loadOptions();
	fillForm(h, 2, { customMsg1: { value: "Line 1\nLine 2" }, sites1: { value: "b.com\na.com" }, exportPasswords: { checked: false }, accessPassword: { value: "secret" } });
	vm.runInContext("exportOptions()", h.context);
	assert.equal(h.downloads.length, 1);
	const { blob, filename } = h.downloads[0];
	assert.equal(blob.type, "text/plain");
	assert.equal(blob.endings, "native");
	assert.match(filename, /^LeechBlockOptions-.*\.txt$/);
	assert.match(blob.text, /^customMsg1=Line 1\\nLine 2$/m);
	assert.match(blob.text, /^sites1=a\.com b\.com$/m);
	assert.match(blob.text, /^days1=62$/m);
	assert.doesNotMatch(blob.text, /secret|^password=/m);
	assert.deepEqual(h.dialogs, ["#alertExportSuccess"]);
});

test("exportOptions/exportOptionsJSON include passwords when requested", () => {
	const h = loadOptions();
	fillForm(h, 1, { exportPasswords: { checked: true }, accessPassword: { value: "secret" }, passwordSetSpec1: { value: "spec" }, customMsg1: { value: "x\ny" } });
	vm.runInContext("exportOptions(); exportOptionsJSON();", h.context);
	assert.equal(h.downloads.length, 2);
	assert.match(h.downloads[0].blob.text, /^password=secret$/m);
	const json = JSON.parse(h.downloads[1].blob.text);
	assert.equal(h.downloads[1].blob.type, "application/json");
	assert.match(h.downloads[1].filename, /\.json$/);
	assert.equal(json.password, "secret");
	assert.equal(json.passwordSetSpec1, "spec");
	assert.equal(json.customMsg1, "x\\ny");
	assert.deepEqual(json.days1, [false, true, true, true, true, true, false]);
});

test("importOptions: no file opens alertNoImportFile", () => {
	const h = loadOptions();
	fillForm(h, 2);
	vm.runInContext("importOptions()", h.context);
	assert.deepEqual(h.dialogs, ["#alertNoImportFile"]);
});

test("importOptions: empty file or failed parse opens alertImportError and applies nothing", async () => {
	for (const [name, content] of [["a.txt", ""], ["a.txt", "garbage only"], ["a.json", "{bad"], ["a.json", "[]"], ["a.txt", "numSets=zzz"]]) {
		const h = loadOptions();
		fillForm(h, 2);
		h.el("importFile").files = [{ name, content }];
		vm.runInContext("importOptions()", h.context);
		await tick();
		assert.deepEqual(h.dialogs, ["#alertImportError"], `${name}: ${content}`);
		assert.equal(h.applied.length, 0);
		assert.equal(h.tabsCalls.length, 0);
	}
});

test("importOptions: text import applies options, preserves passwords, selects last tab", async () => {
	const h = loadOptions();
	fillForm(h, 2, { accessPassword: { value: "pw" }, overridePassword: { value: "opw" }, passwordSetSpec2: { value: "s2" } });
	h.el("importFile").files = [{ name: "x.txt", content: "numSets=2\nsetName1=Imported\nprevAddons1=true\n" }];
	vm.runInContext("importOptions()", h.context);
	await tick();
	assert.deepEqual(h.dialogs, ["#alertImportSuccess"]);
	assert.equal(h.applied.length, 1);
	const o = h.applied[0];
	assert.equal(o.setName1, "Imported");
	assert.equal(o.prevExts1, true);
	assert.equal(o.password, "pw");
	assert.equal(o.orp, "opw");
	assert.equal(o.passwordSetSpec1, "");
	assert.equal(o.passwordSetSpec2, "s2");
	assert.deepEqual(h.tabsCalls, [["option", "active", 2]]);
});

test("importOptions: JSON detected by extension (case-insensitive) or leading brace", async () => {
	const json = JSON.stringify({ numSets: "1", setName1: "J" });
	for (const [name, content] of [["BACKUP.JSON", json], ["export.txt", "  \n" + json], ["export.txt", "[" + json + "]"]]) {
		const h = loadOptions();
		fillForm(h, 2);
		h.el("importFile").files = [{ name, content }];
		vm.runInContext("importOptions()", h.context);
		await tick();
		if (content.trim().startsWith("[")) {
			// JSON array is an invalid shape, which also proves JSON parsing was selected
			assert.deepEqual(h.dialogs, ["#alertImportError"]);
		} else {
			assert.deepEqual(h.dialogs, ["#alertImportSuccess"], name);
			assert.equal(h.applied[0].setName1, "J");
			assert.equal(h.applied[0].numSets, "1");
		}
	}
});
