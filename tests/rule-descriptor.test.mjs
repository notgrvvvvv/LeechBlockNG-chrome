/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDescriptor, plain } from "./load-descriptor.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const D = loadDescriptor();
const inventory = JSON.parse(fs.readFileSync(path.join(__dirname, "inventory.json"), "utf8"));

function rule(set = {}, general = {}) {
	return plain(D.describeRule(set, general));
}

const SET_WITH_SITE = { sites: "example.com", times: "0900-1700" };

// ---------- roles ----------

test("PER_SET_SUMMARY_ROLES covers all 53 keys with the specified split and is frozen", () => {
	const roles = D.PER_SET_SUMMARY_ROLES;
	assert.ok(Object.isFrozen(roles));
	assert.deepEqual(Object.keys(roles).sort(), Object.keys(D.PER_SET_OPTIONS).sort());
	const by = (r) => Object.keys(roles).filter((k) => roles[k] === r);
	assert.equal(by("sentence").length, 27);
	assert.equal(by("advanced").length, 23);
	assert.deepEqual(by("cosmetic").sort(), ["showKeyword", "showTimer", "sortSites"]);
	assert.deepEqual(by("advanced").sort(), [
		"limitOffset", "rollover", "incogMode", "activeTabMode", "activeBlock", "minBlock",
		"countFocus", "countAllowed", "countAudio", "titleOnly", "delayFirst", "delayFirstMode",
		"delayAutoLoad", "delayCancel", "reloadSecs", "addHistory", "prevOverride", "allowRefers",
		"allowKeywords", "waitSecs", "regexpAllow", "regexpKeyword", "ignoreHash",
	].sort());
});

test("GENERAL_SUMMARY_ROLES covers all 45 keys and agrees with inventory.json", () => {
	const roles = D.GENERAL_SUMMARY_ROLES;
	assert.ok(Object.isFrozen(roles));
	assert.deepEqual(Object.keys(roles).sort(), Object.keys(D.GENERAL_OPTIONS).sort());
	const by = (r) => Object.keys(roles).filter((k) => roles[k] === r);
	assert.equal(by("affects-rule").length, 11);
	assert.equal(by("internal").length, 6);
	assert.equal(by("cosmetic").length, 28);
	for (const key of Object.keys(roles)) {
		assert.equal(
			inventory.generalOptions[key].affectsRuleSummary,
			roles[key] === "affects-rule",
			`inventory affectsRuleSummary mismatch for ${key}`
		);
		assert.equal(D.GENERAL_OPTIONS[key].id === null, roles[key] === "internal", key);
	}
});

// ---------- extractSetOptions ----------

test("extractSetOptions rejects invalid set numbers with RangeError", () => {
	for (const bad of [0, 31, -1, 1.5, "1", NaN, Infinity, null, undefined, {}]) {
		assert.throws(() => D.extractSetOptions({}, bad), (e) => e.name === "RangeError", String(bad));
	}
	assert.doesNotThrow(() => D.extractSetOptions({}, 1));
	assert.doesNotThrow(() => D.extractSetOptions({}, 30));
});

test("extractSetOptions returns exactly the option keys and defaults beyond numSets", () => {
	const r = D.extractSetOptions(undefined, 12);
	assert.deepEqual(Object.keys(r.setOptions).sort(), Object.keys(D.PER_SET_OPTIONS).sort());
	assert.deepEqual(Object.keys(r.generalOptions).sort(), Object.keys(D.GENERAL_OPTIONS).sort());
	assert.equal(r.generalOptions.numSets, "6");
	assert.deepEqual(plain(r.setOptions.days), [false, true, true, true, true, true, false]);
	assert.equal(r.setOptions.blockURL, "blocked.html?$S&$U");
});

test("extractSetOptions picks the right set, keeps caller's numSets, and does not mutate input", () => {
	const days = [true, false, true, false, true, false, true];
	const full = { numSets: "3", sites2: "a.com", days2: days, sites3: "c.com", sites5: "e.com" };
	const snapshot = JSON.stringify(full);
	const r2 = D.extractSetOptions(full, 2);
	assert.equal(r2.setOptions.sites, "a.com");
	assert.deepEqual(plain(r2.setOptions.days), days);
	assert.notEqual(r2.setOptions.days, days);
	assert.equal(r2.generalOptions.numSets, "3");
	const r5 = D.extractSetOptions(full, 5);
	assert.equal(r5.setOptions.sites, "e.com");
	assert.equal(r5.generalOptions.numSets, "3");
	assert.equal(JSON.stringify(full), snapshot);
	// frozen input must also work
	const frozen = Object.freeze({ numSets: "2", days1: Object.freeze([true, true, true, true, true, true, true]) });
	assert.doesNotThrow(() => D.extractSetOptions(frozen, 4));
});

test("extractSetOptions normalizes wrong-typed values and short days arrays", () => {
	const r = D.extractSetOptions({ numSets: "abc", sites1: 5, days1: [true] }, 1);
	assert.equal(r.generalOptions.numSets, "6");
	assert.equal(r.setOptions.sites, "");
	assert.deepEqual(plain(r.setOptions.days), [true, false, false, false, false, false, false]);
	const clamped = D.extractSetOptions({ numSets: "99" }, 1);
	assert.equal(clamped.generalOptions.numSets, "30");
});

// ---------- describeRule: target ----------

test("target counts tokens by prefix and cleans sites", () => {
	const r = rule({ sites: "http://b.com a.com +c.com ~word >ref.com #note FILE +FILE" });
	assert.deepEqual(r.target.counts, {
		sites: 3, exceptions: 2, keywords: 1, referrers: 1, comments: 1, totalEntries: 8,
	});
	assert.ok(!r.target.cleanedSites.includes("http:"));
	assert.equal(rule({ sites: "" }).target.counts.totalEntries, 0);
});

test("hasMatchableTarget and mode follow engine parity", () => {
	assert.equal(rule({ sites: "" }).target.mode, "none");
	assert.equal(rule({ sites: "+a.com ~kw #c" }).target.hasMatchableTarget, false);
	assert.equal(rule({ sites: ">r.com" }).target.hasMatchableTarget, true);
	assert.equal(rule({ sites: ">r.com", allowRefers: true }).target.hasMatchableTarget, false);
	assert.equal(rule({ sites: "a.com" }).target.mode, "sites");
	assert.equal(rule({ regexpBlock: "x" }).target.mode, "regexp");
	assert.equal(rule({ sitesURL: "https://e.com/l.txt" }).target.mode, "external-url");
	assert.equal(rule({ sitesURL: "u", sites: "a.com" }).target.mode, "external-url-and-sites");
	assert.equal(rule({ sitesURL: "u", regexpBlock: "x" }).target.mode, "external-url-and-sites");
	assert.equal(rule({ sites: "FILE" }).target.hasMatchableTarget, true);
	assert.equal(rule({ sites: "a.com" }, { matchSubdomains: true }).target.matchSubdomains, true);
});

// ---------- status / schedule ----------

test("status: disabled, never-blocks, active-schedule, lockdown-only", () => {
	let r = rule({ ...SET_WITH_SITE, disable: true });
	assert.equal(r.status, "disabled");
	assert.deepEqual(r.neverBlocksReasons, ["disabled"]);
	assert.equal(r.neverBlocks, true);
	assert.equal(r.schedule.canTriggerOrdinarily, false);
	assert.equal(r.schedule.lockdownPossible, false);

	r = rule({ times: "0900-1700" });
	assert.equal(r.status, "never-blocks");
	assert.deepEqual(r.neverBlocksReasons, ["no-sites"]);

	r = rule({ sites: "+a.com", times: "0900-1700" });
	assert.equal(r.status, "never-blocks");
	assert.deepEqual(r.neverBlocksReasons, ["no-matchable-target"]);

	r = rule(SET_WITH_SITE);
	assert.equal(r.status, "active-schedule");
	assert.equal(r.neverBlocks, false);
	assert.deepEqual(r.neverBlocksReasons, []);
	assert.equal(r.schedule.canTriggerOrdinarily, true);
	assert.equal(r.schedule.lockdownPossible, true);

	r = rule({ sites: "a.com" });
	assert.equal(r.status, "lockdown-only");
	assert.equal(r.neverBlocks, false);
	assert.deepEqual(r.schedule.incompleteReasons, ["no-times-or-limit"]);

	r = rule({ ...SET_WITH_SITE, days: new Array(7).fill(false) });
	assert.equal(r.status, "lockdown-only");
	assert.deepEqual(r.schedule.incompleteReasons, ["no-days"]);

	r = rule({ regexpBlock: "x" });
	assert.equal(r.target.hasMatchableTarget, true);
	assert.equal(r.neverBlocks, false);
});

test("AND mode incomplete reasons and trigger conditions", () => {
	let r = rule({ sites: "a.com", conjMode: true, times: "0900-1700" });
	assert.deepEqual(r.schedule.incompleteReasons, ["and-missing-limit"]);
	assert.equal(r.status, "lockdown-only");
	r = rule({ sites: "a.com", conjMode: true, limitMins: "10", limitPeriod: "3600" });
	assert.deepEqual(r.schedule.incompleteReasons, ["and-missing-times"]);
	r = rule({ sites: "a.com", conjMode: true });
	assert.deepEqual(r.schedule.incompleteReasons, ["and-missing-times", "and-missing-limit"]);
	r = rule({ sites: "a.com", conjMode: true, times: "0900-1700", limitMins: "10", limitPeriod: "3600" });
	assert.deepEqual(r.schedule.incompleteReasons, []);
	assert.equal(r.status, "active-schedule");
	assert.equal(r.schedule.limit.configured, true);
	// OR with only a limit
	r = rule({ sites: "a.com", limitMins: "10", limitPeriod: "3600" });
	assert.equal(r.status, "active-schedule");
	// half-configured limit does not count
	r = rule({ sites: "a.com", limitMins: "10" });
	assert.equal(r.schedule.limit.configured, false);
});

test("prevExts/prevSettings keep a rule effective only through the line-558 gate", () => {
	let r = rule({ sites: ">r.com", allowRefers: true, prevExts: true });
	assert.equal(r.target.hasMatchableTarget, false);
	assert.equal(r.neverBlocks, false);
	assert.equal(r.schedule.lockdownPossible, true);
	assert.ok(!r.imprecise.some((i) => i.code === "prev-internal-needs-target"));

	r = rule({ sites: "+a.com", prevSettings: true });
	assert.equal(r.neverBlocks, true);
	assert.equal(r.status, "never-blocks");
	const flag = r.imprecise.find((i) => i.code === "prev-internal-needs-target");
	assert.deepEqual(flag.keys, ["prevSettings"]);

	r = rule({ prevExts: true, prevSettings: true });
	assert.deepEqual(r.imprecise.find((i) => i.code === "prev-internal-needs-target").keys, ["prevExts", "prevSettings"]);
});

test("time periods are cleaned and converted", () => {
	let r = rule({ times: "1300-1400, 0900-1230, 1200-1300" });
	assert.equal(r.schedule.cleanedTimes, "0900-1400");
	assert.deepEqual(r.schedule.timePeriods, [{ start: "0900", end: "1400", startMins: 540, endMins: 840 }]);
	assert.equal(r.schedule.hasTimes, true);
	assert.equal(r.schedule.allDay, false);
	r = rule({ times: "0900-1230,1500-1600" });
	assert.deepEqual(r.schedule.timePeriods[0], { start: "0900", end: "1230", startMins: 540, endMins: 750 });
	assert.equal(r.schedule.timePeriods.length, 2);
	r = rule({ times: "0000-2400" });
	assert.equal(r.schedule.allDay, true);
	assert.equal(r.schedule.timePeriods[0].end, "2400");
	r = rule({ times: "2200-0200" });
	assert.equal(r.schedule.hasTimes, false);
	assert.deepEqual(r.schedule.timePeriods, []);
});

// ---------- action ----------

test("action kind precedence and sub-objects", () => {
	assert.equal(rule({}).action.kind, "default-page");
	assert.equal(rule({ blockURL: "about:blank" }).action.kind, "blank-page");
	assert.equal(rule({ blockURL: "https://x.org/" }).action.kind, "custom-url");
	assert.equal(rule({ blockURL: "" }).action.kind, "custom-url");
	assert.equal(rule({ blockURL: "ab/blocked.html?$S&$U" }).action.kind, "default-page");

	let r = rule({ blockURL: "delayed.html?$S&$U" });
	assert.equal(r.action.kind, "delayed-page");
	assert.deepEqual(r.action.delay, {
		delaySecs: "60", delayFirst: true, delayFirstMode: "0",
		delayAllowMins: "", delayAutoLoad: true, delayCancel: true,
	});
	assert.equal(r.action.password, null);
	assert.equal(r.action.filter, null);

	r = rule({ blockURL: "delayed.html?$S&$U", applyFilter: true, filterMute: true, filterCustom: "blur(2px)" });
	assert.equal(r.action.kind, "filter");
	assert.deepEqual(r.action.filter, { name: "grayscale", mute: true, custom: "blur(2px)" });
	assert.equal(r.action.delay, null);

	r = rule({ blockURL: "delayed.html?$S&$U", applyFilter: true, closeTab: true });
	assert.equal(r.action.kind, "close-tab");
	assert.equal(r.action.filter, null);
});

test("password action: configured depends on requireMode and no password leaks", () => {
	const set = { blockURL: "password.html?$S&$U", passwordSetSpec: "SECRET-SET" };
	let r = rule(set, { password: "SECRET-ACC", orp: "SECRET-ORP" });
	assert.equal(r.action.kind, "password-page");
	assert.equal(r.action.password.requireMode, "0");
	assert.equal(r.action.password.configured, true);
	assert.equal(rule({ ...set, passwordSetSpec: "" }, { password: "x", orp: "y" }).action.password.configured, false);
	assert.equal(rule({ ...set, passwordRequire: "1" }, { orp: "y" }).action.password.configured, true);
	assert.equal(rule({ ...set, passwordRequire: "1" }, { password: "x" }).action.password.configured, false);
	assert.equal(rule({ ...set, passwordRequire: "2" }, { password: "x" }).action.password.configured, true);
	assert.equal(rule({ ...set, passwordRequire: "2" }, { orp: "y" }).action.password.configured, false);
	assert.deepEqual(Object.keys(r.action.password).sort(),
		["configured", "delayAllowMins", "delayFirst", "delayFirstMode", "requireMode"]);
	const json = JSON.stringify(rule({ ...set, passwordRequire: "2" }, { password: "SECRET-ACC", orp: "SECRET-ORP" }));
	assert.ok(!json.includes("SECRET"), "plaintext password leaked");
	assert.ok(!JSON.stringify(r).includes("SECRET"));
});

test("alreadyOpenTabsNote and customMsgPresent", () => {
	assert.equal(rule({}).action.alreadyOpenTabsNote, true);
	assert.equal(rule({ activeBlock: true }).action.alreadyOpenTabsNote, false);
	assert.equal(rule({ disable: true }).action.alreadyOpenTabsNote, false);
	assert.equal(rule({ customMsg: "hi" }).action.customMsgPresent, true);
	assert.equal(rule({}).action.customMsgPresent, false);
});

// ---------- exit / protections / cosmetic ----------

test("exit, protections and cosmetic sections", () => {
	const r = rule(
		{ allowOverride: true, allowOverLock: false, prevOpts: true, prevOverride: true, showTimer: false },
		{ orm: "5", orln: "2", orlp: "3600", ora: "1" }
	);
	assert.deepEqual(r.exit, {
		allowOverride: true, allowOverLock: false, overrideDurationMins: "5",
		overrideLimitNum: "2", overrideLimitPeriod: "3600", overrideAccess: "1",
	});
	assert.equal(r.protections.prevOpts, true);
	assert.equal(r.protections.prevOverride, true);
	assert.equal(r.protections.prevGenOpts, false);
	assert.deepEqual(r.cosmetic, { sortSites: true, showKeyword: true, showTimer: false });
});

// ---------- imprecise ----------

test("imprecise flags", () => {
	const codes = (r) => r.imprecise.map((i) => i.code);
	assert.deepEqual(rule({ sites: "a.com" }).imprecise, []);

	let r = rule({ sites: "a.com +b.com ~k", regexpBlock: "a", regexpAllow: "b", regexpKeyword: "k" });
	let f = r.imprecise.find((i) => i.code === "regexp-overrides-sites");
	assert.deepEqual(f.keys, ["regexpBlock", "regexpAllow", "regexpKeyword", "sites"]);
	assert.ok(codes(r).includes("keywords-depend-on-content"));

	r = rule({ regexpBlock: "a" });
	assert.ok(!codes(r).includes("regexp-overrides-sites"));

	r = rule({ sitesURL: "u" });
	assert.deepEqual(r.imprecise.find((i) => i.code === "external-sites-url").keys, ["sitesURL"]);

	r = rule({ sites: "~word" });
	f = r.imprecise.find((i) => i.code === "keywords-depend-on-content");
	assert.deepEqual(f.keys, ["sites", "allowKeywords", "titleOnly"]);

	r = rule({ sites: ">ref.com" });
	assert.deepEqual(r.imprecise.find((i) => i.code === "referrers-depend-on-navigation").keys, ["sites", "allowRefers"]);

	r = rule({ incogMode: "1", activeTabMode: "2", waitSecs: "5" }, { clockOffset: "30" });
	assert.deepEqual(r.imprecise.find((i) => i.code === "incognito-scope"), { code: "incognito-scope", keys: ["incogMode"], value: "1" });
	assert.deepEqual(r.imprecise.find((i) => i.code === "active-tab-scope"), { code: "active-tab-scope", keys: ["activeTabMode"], value: "2" });
	assert.deepEqual(r.imprecise.find((i) => i.code === "wait-before-check"), { code: "wait-before-check", keys: ["waitSecs"], value: "5" });
	assert.deepEqual(r.imprecise.find((i) => i.code === "clock-offset-active"), { code: "clock-offset-active", keys: ["clockOffset"], value: "30" });
});

// ---------- activeAdvanced ----------

test("activeAdvanced lists only non-default advanced settings", () => {
	assert.deepEqual(rule({ sites: "a.com" }).activeAdvanced, []);

	const r = rule(
		{ limitOffset: "5", rollover: true, ignoreHash: false, countFocus: false, showTimer: false, sortSites: false },
		{ matchSubdomains: true, allowLBWebsite: false, password: "pw", orp: "pw2" }
	);
	const keys = r.activeAdvanced.map((a) => `${a.scope}:${a.key}`);
	assert.deepEqual(keys, [
		"set:limitOffset", "set:rollover", "set:countFocus", "set:ignoreHash",
		"general:matchSubdomains", "general:allowLBWebsite",
	]);
	assert.equal(r.activeAdvanced[0].value, "5");
	assert.ok(!JSON.stringify(r).includes("pw"));
	for (const a of r.activeAdvanced) {
		assert.ok(!["sortSites", "showKeyword", "showTimer", "password", "orp"].includes(a.key));
	}
});

test("activeAdvanced delay keys depend on action kind; allowOverLock on allowOverride", () => {
	const delayOpts = { delayAutoLoad: false, delayCancel: false, delayFirst: false, delayFirstMode: "1", delayAllowMins: "3" };
	const keys = (r) => r.activeAdvanced.map((a) => a.key);
	assert.deepEqual(keys(rule({ blockURL: "delayed.html?$S&$U", ...delayOpts })),
		["delayAutoLoad", "delayCancel", "delayFirst", "delayFirstMode", "delayAllowMins"]);
	assert.deepEqual(keys(rule({ blockURL: "password.html?$S&$U", ...delayOpts })),
		["delayFirst", "delayFirstMode", "delayAllowMins"]);
	assert.deepEqual(keys(rule({ ...delayOpts })), []);
	assert.deepEqual(keys(rule({ allowOverLock: false })), []);
	assert.deepEqual(keys(rule({ allowOverride: true, allowOverLock: false })), ["allowOverLock"]);
	assert.deepEqual(keys(rule({ allowOverride: true })), []);
});

// ---------- misc ----------

test("describeRule does not mutate inputs and tolerates null/garbage", () => {
	const set = Object.freeze({ sites: "b.com a.com", days: Object.freeze([true, true, true, true, true, true, true]), times: 5 });
	const gen = Object.freeze({ matchSubdomains: "yes" });
	const r = plain(D.describeRule(set, gen));
	assert.equal(r.target.cleanedSites, "a.com b.com");
	assert.equal(r.schedule.cleanedTimes, "");
	assert.equal(r.target.matchSubdomains, false);
	assert.doesNotThrow(() => D.describeRule());
	assert.doesNotThrow(() => D.describeRule(null, null));
	assert.equal(plain(D.describeRule(undefined)).status, "never-blocks");
	// returned days is a copy
	const input = [true, false, false, false, false, false, false];
	const out = D.describeRule({ days: input });
	out.schedule.days[0] = false;
	assert.equal(input[0], true);
});

test("sortSites affects cleanedSites only", () => {
	assert.equal(rule({ sites: "b.com a.com" }).target.cleanedSites, "a.com b.com");
	assert.equal(rule({ sites: "b.com a.com", sortSites: false }).target.cleanedSites, "b.com a.com");
});

test("classifiedKeys exposes roles and the 11 affects-rule general keys", () => {
	const r = D.describeRule({});
	assert.equal(r.classifiedKeys.perSet, D.PER_SET_SUMMARY_ROLES);
	assert.equal(r.classifiedKeys.general.length, 11);
	assert.ok(r.classifiedKeys.general.every((k) => D.GENERAL_SUMMARY_ROLES[k] === "affects-rule"));
});

test("describeBlockSet wraps extractSetOptions + describeRule", () => {
	const full = { numSets: "2", sites2: "a.com", times2: "0900-1700", matchSubdomains: true };
	const direct = plain(D.describeBlockSet(full, 2));
	const { setOptions, generalOptions } = D.extractSetOptions(full, 2);
	assert.deepEqual(direct, plain(D.describeRule(setOptions, generalOptions)));
	assert.equal(direct.status, "active-schedule");
	assert.equal(direct.target.matchSubdomains, true);
	assert.equal(plain(D.describeBlockSet(full, 1)).status, "never-blocks");
	assert.throws(() => D.describeBlockSet(full, 0), (e) => e.name === "RangeError");
});

test("source constraints: license header, no DOM/storage APIs, wired into options.html only", () => {
	const src = fs.readFileSync(path.join(ROOT, "rule-descriptor.js"), "utf8");
	assert.ok(src.startsWith("/* This Source Code Form is subject to the terms of the Mozilla Public"));
	assert.ok(!/\b(document|window|localStorage)\b|browser\.(storage|runtime)/.test(src));
	assert.ok(!/timedata/.test(src));
	assert.ok(!/\b(TODO|T-\d{3}|backlog)\b/i.test(src));
	const html = fs.readFileSync(path.join(ROOT, "options.html"), "utf8");
	assert.ok(/<script src="\/common\.js"><\/script>\s*<script src="\/rule-descriptor\.js"><\/script>\s*<script src="\/options\.js"><\/script>/.test(html));
});
