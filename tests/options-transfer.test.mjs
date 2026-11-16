/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadTransfer } from "./load-transfer.mjs";

// Objects from the vm context have a different realm prototype; compare structurally
const deepEq = (actual, expected, msg) =>
	assert.deepStrictEqual(JSON.parse(JSON.stringify(actual)), JSON.parse(JSON.stringify(expected)), msg);

const T = loadTransfer();
const {
	PER_SET_OPTIONS, GENERAL_OPTIONS, exportOptionsToText, exportOptionsToJSON,
	importOptionsFromText, importOptionsFromJSON,
} = T;

// Build a normalized options object with defaults (numSets sets)
function defaults(numSets = 6, extra = {}) {
	const r = importOptionsFromText(`numSets=${numSets}\n`);
	assert.ok(r.ok);
	return { ...r.options, ...extra };
}

function parseLines(text) {
	return text.split("\n").filter(Boolean).map(l => l.split(/=(.*)/s).slice(0, 2));
}

test("source file has license header and no DOM/browser API use", () => {
	const dir = path.dirname(fileURLToPath(import.meta.url));
	const src = fs.readFileSync(path.resolve(dir, "..", "options-transfer.js"), "utf8");
	assert.match(src, /^\/\* This Source Code Form is subject to the terms of the Mozilla Public/);
	assert.doesNotMatch(src, /\b(document|window|browser|chrome|localStorage)\./);
});

test("constants are frozen and correct", () => {
	deepEq([...T.SUPPORTED_THEMES], ["", "light", "dark"]);
	deepEq({ ...T.FIREFOX_KEY_MAP }, { prevAddons: "prevExts" });
	deepEq([...T.FIREFOX_UNSUPPORTED_PREFIXES], ["prevDebugging", "prevProfiles", "prevSupport"]);
	assert.ok(Object.isFrozen(T.SUPPORTED_THEMES));
	assert.ok(Object.isFrozen(T.FIREFOX_KEY_MAP));
	assert.ok(Object.isFrozen(T.FIREFOX_UNSUPPORTED_PREFIXES));
});

test("text export: key order, omissions, encoding", () => {
	const opts = defaults(2, { customMsg1: "Line 1\nLine 2", days1: [true, false, false, false, false, false, true] });
	const before = JSON.stringify(opts);
	const text = exportOptionsToText(opts, { includePasswords: false });
	assert.equal(JSON.stringify(opts), before, "input not mutated");
	const keys = parseLines(text).map(p => p[0]);
	const expected = [];
	for (let set = 1; set <= 2; set++) {
		for (const n in PER_SET_OPTIONS) if (n != "passwordSetSpec") expected.push(n + set);
	}
	for (const n in GENERAL_OPTIONS) {
		if (GENERAL_OPTIONS[n].id === null || n == "password" || n == "orp") continue;
		expected.push(n);
	}
	deepEq(keys, expected);
	assert.match(text, /^customMsg1=Line 1\\nLine 2$/m);
	assert.match(text, /^days1=65$/m);
	assert.match(text, /^sortSites1=true$/m);
	assert.doesNotMatch(text, /simplified|orlps|lockdownHours|password=|orp=|passwordSetSpec/);
});

test("text export: includePasswords default follows exportPasswords, explicit wins", () => {
	const opts = defaults(1, { exportPasswords: true, password: "pw", passwordSetSpec1: "x" });
	assert.match(exportOptionsToText(opts), /^password=pw$/m);
	assert.match(exportOptionsToText(opts), /^passwordSetSpec1=x$/m);
	assert.doesNotMatch(exportOptionsToText(opts, { includePasswords: false }), /^password=/m);
	const opts2 = defaults(1, { exportPasswords: false, password: "pw" });
	assert.match(exportOptionsToText(opts2, { includePasswords: true }), /^password=pw$/m);
	assert.doesNotMatch(exportOptionsToText(opts2), /^password=/m);
});

test("export accepts numeric numSets and cleans sites/times", () => {
	const opts = { numSets: 2, sites1: "  http://b.com   a.com ", times1: "1200-1300,1230-1400" };
	const text = exportOptionsToText(opts);
	assert.match(text, /^sites1=a\.com b\.com$/m);
	assert.match(text, /^times1=1200-1400$/m);
	assert.match(text, /^numSets=2$/m);
	assert.match(text, /^setName2=$/m);
	assert.doesNotMatch(text, /^setName3=/m);
});

test("JSON export matches text export key order; days as boolean array", () => {
	const opts = defaults(3, { customMsg2: "a\nb" });
	const json = JSON.parse(exportOptionsToJSON(opts, { includePasswords: true }));
	const textKeys = parseLines(exportOptionsToText(opts, { includePasswords: true })).map(p => p[0]);
	deepEq(Object.keys(json), textKeys);
	deepEq(json.days1, [false, true, true, true, true, true, false]);
	assert.equal(json.customMsg2, "a\\nb");
	assert.equal(json.sortSites1, true);
	assert.equal(json.numSets, "3");
	assert.ok(!("simplified" in json));
});

test("round trip text and JSON are identical and stable", () => {
	const opts = defaults(4, {
		sites2: "b.com a.com", times2: "0900-1000", days3: [true, true, false, false, true, false, true],
		customMsg1: "x\ny", theme: "dark", exportPasswords: true, password: "p", orp: "o", passwordSetSpec2: "s",
	});
	const txt = exportOptionsToText(opts);
	const json = exportOptionsToJSON(opts);
	const a = importOptionsFromText(txt);
	const b = importOptionsFromJSON(json);
	assert.ok(a.ok && b.ok);
	deepEq(a.options, b.options);
	assert.equal(a.report.sourceFormat, "text");
	assert.equal(b.report.sourceFormat, "json");
	assert.equal(exportOptionsToText(a.options, { includePasswords: true }), txt);
	assert.equal(exportOptionsToJSON(a.options, { includePasswords: true }), json);
	assert.equal(a.options.customMsg1, "x\ny");
	assert.equal(a.options.password, "p");
	deepEq(a.report.unknownKeys, []);
	deepEq(a.report.notTransferred, ["timedata", "stats", "lockdown"]);
});

test("import result has all general and per-set options", () => {
	const r = importOptionsFromText("numSets=3\n");
	assert.ok(r.ok);
	assert.equal(r.error, null);
	for (const n in GENERAL_OPTIONS) assert.ok(n in r.options, n);
	for (const n in PER_SET_OPTIONS) for (let s = 1; s <= 3; s++) assert.ok(`${n}${s}` in r.options);
	assert.ok(!("setName4" in r.options));
});

test("text import failures", () => {
	for (const bad of [undefined, null, 5, "", "  \n \r\n"]) {
		const r = importOptionsFromText(bad);
		assert.equal(r.ok, false);
		assert.equal(r.options, null);
		assert.equal(r.report, null);
		assert.equal(r.error.code, "empty-input");
		assert.equal(typeof r.error.message, "string");
	}
	assert.equal(importOptionsFromText("hello\nworld").error.code, "no-options");
	assert.equal(importOptionsFromText("numSets=abc").error.code, "invalid-value");
	assert.equal(importOptionsFromText("numSets=3\ndays1=-1").error.code, "invalid-value");
	assert.equal(importOptionsFromText("numSets=3\ndays1=x").error.code, "invalid-value");
});

test("text import: numSets clamping", () => {
	assert.equal(importOptionsFromText("numSets=0").options.numSets, "1");
	assert.equal(importOptionsFromText("numSets=99").options.numSets, "30");
	assert.equal(importOptionsFromText("numSets=99").report.numSetsImported, 30);
	assert.equal(importOptionsFromText("numSets=-3").options.numSets, "1");
	assert.equal(importOptionsFromText("numSets=2.9").options.numSets, "2");
	assert.equal(importOptionsFromText("setName1=x").report.numSetsImported, 6);
});

test("text import: '=' in values, CRLF, blank lines, unrecognized lines, duplicates", () => {
	const r = importOptionsFromText("numSets=2\r\n\r\nblockURL1=http://x.com/?a=b\r\n  junk line  \r\nfoo=1\r\nfoo=2\r\nsetName1=a\r\nsetName1=b\r\njunk line\r\n");
	assert.ok(r.ok);
	assert.equal(r.options.blockURL1, "http://x.com/?a=b");
	assert.equal(r.options.setName1, "b");
	deepEq(r.report.unknownKeys, ["junk line", "foo"]);
});

test("text import: booleans, strings that look like booleans, days", () => {
	const r = importOptionsFromText("numSets=1\nsortSites1=FALSE\nsetName1=true\ndays1=127\nconjMode1=maybe\n");
	assert.ok(r.ok);
	assert.equal(r.options.sortSites1, false);
	assert.equal(r.options.setName1, "true");
	deepEq(r.options.days1, [true, true, true, true, true, true, true]);
	assert.equal(r.options.conjMode1, false); // default
});

test("firefox keys, unknown keys, sets above numSets, internal keys", () => {
	const txt = [
		"numSets=2", "prevAddons1=true", "prevAddons2=true", "prevExts2=false", "prevAddons3=true", "prevAddons0=true",
		"prevDebugging1=true", "prevProfiles9=false", "prevSupport2=true", "setName3=z", "bogus=1",
		"simplified=false", "orlps=5", "timedata1=1,2", "blockRE1=x", "days5=1", "constructor=1", "__proto__=1",
	].join("\n");
	const r = importOptionsFromText(txt);
	assert.ok(r.ok);
	deepEq(r.report.mappedKeys, [{ from: "prevAddons1", to: "prevExts1" }, { from: "prevAddons2", to: "prevExts2" }]);
	deepEq(r.report.firefoxOnlyKeys, ["prevDebugging1", "prevProfiles9", "prevSupport2"]);
	deepEq(r.report.unknownKeys, ["prevAddons3", "prevAddons0", "setName3", "bogus", "simplified", "orlps", "timedata1", "blockRE1", "days5", "constructor", "__proto__"]);
	assert.equal(r.options.prevExts1, true);
	assert.equal(r.options.prevExts2, false, "explicit prevExts wins");
	assert.ok(!("prevAddons1" in r.options));
	assert.ok(!("prevDebugging1" in r.options));
	assert.equal(r.options.simplified, true);
	assert.ok(!("setName3" in r.options));
});

test("theme fallback", () => {
	let r = importOptionsFromText("theme=spruce");
	deepEq(r.report.unavailableTheme, { original: "spruce", fallback: "" });
	assert.equal(r.options.theme, "");
	r = importOptionsFromText("theme=dark");
	assert.equal(r.report.unavailableTheme, null);
	assert.equal(r.options.theme, "dark");
	r = importOptionsFromJSON(JSON.stringify({ theme: "weird" }));
	deepEq(r.report.unavailableTheme, { original: "weird", fallback: "" });
	assert.equal(importOptionsFromText("numSets=1").report.unavailableTheme, null);
});

test("missing passwords report and preservation", () => {
	const cur = { password: "pw", orp: "", passwordSetSpec2: "spec2", passwordSetSpec7: "spec7" };
	const curCopy = JSON.stringify(cur);
	const txt = "numSets=3\noa=1\nora=9\npasswordRequire1=0\nblockURL1=password.html?$S&$U\npasswordRequire2=0\nblockURL2=blocked.html?$S&$U\npasswordSetSpec3=in\n";
	const r = importOptionsFromText(txt, cur);
	assert.equal(JSON.stringify(cur), curCopy, "currentOptions not mutated");
	assert.ok(r.ok);
	const mp = r.report.missingPasswords;
	assert.equal(mp.generalAccess, true);
	assert.equal(mp.generalAccessActive, true);
	assert.equal(mp.override, true);
	assert.equal(mp.overrideActive, true);
	deepEq(mp.perSet, [
		{ set: 1, key: "passwordSetSpec1", active: true },
		{ set: 2, key: "passwordSetSpec2", active: false },
	]);
	deepEq(mp.preservedFromCurrent, ["password", "passwordSetSpec2"]);
	assert.equal(r.options.password, "pw");
	assert.equal(r.options.orp, "");
	assert.equal(r.options.passwordSetSpec2, "spec2");
	assert.equal(r.options.passwordSetSpec3, "in");
	assert.ok(!("passwordSetSpec7" in r.options));
});

test("present passwords are not reported missing nor preserved", () => {
	const r = importOptionsFromText("numSets=1\npassword=\norp=x\npasswordSetSpec1=\n", { password: "cur", orp: "cur", passwordSetSpec1: "cur" });
	assert.equal(r.report.missingPasswords.generalAccess, false);
	assert.equal(r.report.missingPasswords.override, false);
	deepEq(r.report.missingPasswords.perSet, []);
	deepEq(r.report.missingPasswords.preservedFromCurrent, []);
	assert.equal(r.options.password, "");
	assert.equal(r.options.orp, "x");
});

test("JSON import failures", () => {
	assert.equal(importOptionsFromJSON("").error.code, "empty-input");
	assert.equal(importOptionsFromJSON(null).error.code, "empty-input");
	assert.equal(importOptionsFromJSON("{bad").error.code, "invalid-json");
	for (const s of ["null", "[]", "[1]", "5", "\"x\""]) assert.equal(importOptionsFromJSON(s).error.code, "invalid-shape", s);
	assert.equal(importOptionsFromJSON("{}").error.code, "no-options");
	for (const v of ["abc", true, null, {}, [], ""]) {
		assert.equal(importOptionsFromJSON(JSON.stringify({ numSets: v })).error.code, "invalid-value", String(v));
	}
	const bad = (o) => importOptionsFromJSON(JSON.stringify({ numSets: "2", ...o })).error?.code;
	assert.equal(bad({ days1: "bad" }), "invalid-value");
	assert.equal(bad({ days1: [true, false] }), "invalid-value");
	assert.equal(bad({ days1: 65 }), "invalid-value");
	assert.equal(bad({ days1: [1, 0, 0, 0, 0, 0, 0] }), "invalid-value");
	assert.equal(bad({ setName1: null }), "invalid-value");
	assert.equal(bad({ setName1: 5 }), "invalid-value");
	assert.equal(bad({ setName1: ["a"] }), "invalid-value");
	assert.equal(bad({ sortSites1: "true" }), "invalid-value");
	assert.equal(bad({ theme: false }), "invalid-value");
	assert.equal(bad({ prevAddons1: "yes" }), "invalid-value");
	assert.equal(bad({ prevAddons1: true }), undefined);
});

test("JSON import: values outside import scope are not type-checked", () => {
	const r = importOptionsFromJSON(JSON.stringify({
		numSets: "2", simplified: "oops", orlps: null, setName5: { a: 1 }, days9: "bad",
		prevAddons9: 7, prevDebugging1: null, timedata1: [1], mystery: [],
	}));
	assert.ok(r.ok, JSON.stringify(r.error));
	deepEq(r.report.unknownKeys, ["simplified", "orlps", "setName5", "days9", "prevAddons9", "timedata1", "mystery"]);
	deepEq(r.report.firefoxOnlyKeys, ["prevDebugging1"]);
});

test("JSON numSets variants", () => {
	assert.equal(importOptionsFromJSON('{"numSets":99}').options.numSets, "30");
	assert.equal(importOptionsFromJSON('{"numSets":"99"}').options.numSets, "30");
	assert.equal(importOptionsFromJSON('{"numSets":0}').options.numSets, "1");
	assert.equal(importOptionsFromJSON('{"numSets":4}').report.numSetsImported, 4);
	assert.equal(importOptionsFromJSON('{"numSets":4}').options.numSets, "4");
});

test("JSON import: ordered/deduplicated report arrays and string unescape", () => {
	const r = importOptionsFromJSON('{"zzz":1,"aaa":2,"prevAddons2":true,"prevAddons1":false,"customMsg1":"a\\\\nb","numSets":"2"}');
	assert.ok(r.ok);
	deepEq(r.report.unknownKeys, ["zzz", "aaa"]);
	deepEq(r.report.mappedKeys.map(m => m.from), ["prevAddons2", "prevAddons1"]);
	assert.equal(r.options.customMsg1, "a\nb");
});

test("JSON preserves passwords from current options", () => {
	const r = importOptionsFromJSON('{"numSets":"1"}', { orp: "o", password: "" });
	deepEq(r.report.missingPasswords.preservedFromCurrent, ["orp"]);
	assert.equal(r.options.orp, "o");
});

test("base 1.8 style export imports key-by-key", () => {
	const base = [
		"setName1=Work", "sites1=a.com b.com", "sortSites1=true", "times1=0900-1700", "days1=62", "blockURL1=blocked.html?$S&$U",
		"customMsg1=Hi\\nthere", "numSets=1", "theme=spruce", "oa=0", "timerSize=1",
	].join("\n") + "\n";
	const r = importOptionsFromText(base);
	assert.ok(r.ok);
	const out = exportOptionsToText(r.options, { includePasswords: false });
	for (const line of base.split("\n").filter(l => l && !l.startsWith("theme"))) {
		assert.ok(out.split("\n").includes(line), line);
	}
	assert.ok(out.split("\n").includes("theme="));
});
