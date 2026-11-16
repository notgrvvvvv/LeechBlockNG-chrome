/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadTimes, plain } from "./load-times.mjs";

const t = loadTimes();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("ALLOWED_LIMIT_PERIODS is frozen and matches the #limitPeriod1 options", () => {
	assert.equal(Object.isFrozen(t.ALLOWED_LIMIT_PERIODS), true);
	assert.equal(t.ALLOWED_LIMIT_PERIODS.length, 23);
	const html = fs.readFileSync(path.join(root, "options.html"), "utf8");
	const select = /<select id="limitPeriod1">([\s\S]*?)<\/select>/.exec(html)[1];
	const values = [...select.matchAll(/<option value="(\d*)"/g)].map((m) => m[1]);
	assert.deepEqual(plain(t.ALLOWED_LIMIT_PERIODS), values);
});

test("options.html loads times-helper.js between common.js and options.js; options.js untouched by it", () => {
	const html = fs.readFileSync(path.join(root, "options.html"), "utf8");
	const re = /<script src="\/common\.js"><\/script>\s*<script src="\/times-helper\.js"><\/script>\s*<script src="\/options\.js"><\/script>/;
	assert.match(html, re);
	assert.doesNotMatch(fs.readFileSync(path.join(root, "options.js"), "utf8"), /timesToRows|validateSchedule/);
});

test("times-helper.js has license header and no DOM/browser API use", () => {
	const code = fs.readFileSync(path.join(root, "times-helper.js"), "utf8");
	assert.ok(code.startsWith("/* This Source Code Form is subject to the terms of the Mozilla Public"));
	assert.doesNotMatch(code, /\b(document|window|localStorage)\b|browser\./);
});

test("timesToRows: type and empty handling", () => {
	assert.deepEqual(plain(t.timesToRows(null)), {
		valid: false, allDay: false, cleanedTimes: "", rows: [], crossMidnightIndices: [],
		errors: [{ index: -1, code: "invalid-type" }],
	});
	for (const s of ["", "   "]) {
		assert.deepEqual(plain(t.timesToRows(s)), {
			valid: true, allDay: false, cleanedTimes: "", rows: [], crossMidnightIndices: [], errors: [],
		});
	}
});

test("timesToRows: valid input is sorted, merged and trimmed", () => {
	const r = plain(t.timesToRows("  1330-1700 0900-1230,1200-1300  "));
	assert.equal(r.valid, true);
	assert.equal(r.cleanedTimes, "0900-1300,1330-1700");
	assert.deepEqual(r.rows, [{ from: "09:00", to: "13:00" }, { from: "13:30", to: "17:00" }]);
	assert.equal(r.allDay, false);
});

test("timesToRows: all-day and 24:00", () => {
	const r = plain(t.timesToRows("0000-2400"));
	assert.equal(r.allDay, true);
	assert.deepEqual(r.rows, [{ from: "00:00", to: "24:00" }]);
	assert.equal(plain(t.timesToRows("0000-1200,1200-2400")).allDay, true);
});

test("timesToRows: malformed or >24:00 syntax is invalid-format", () => {
	for (const s of ["09:00-12:00", "900-1200", "0900-1200,", "0960-1200", "0900-2500", "0900-2430", "2500-2600", "abc", "0900-1200;1300-1400"]) {
		const r = plain(t.timesToRows(s));
		assert.equal(r.valid, false, s);
		assert.equal(r.allDay, false, s);
		assert.equal(r.cleanedTimes, "", s);
		assert.deepEqual(r.rows, [], s);
		assert.deepEqual(r.crossMidnightIndices, [], s);
		assert.equal(r.errors[0].code, "invalid-format", s);
	}
});

test("timesToRows: cross-midnight is preserved and flagged, not dropped", () => {
	const r = plain(t.timesToRows("0900-1000,2200-0200,2200-0000"));
	assert.equal(r.valid, false);
	assert.equal(r.cleanedTimes, "");
	assert.deepEqual(r.rows, [
		{ from: "09:00", to: "10:00" }, { from: "22:00", to: "02:00" }, { from: "22:00", to: "00:00" },
	]);
	assert.deepEqual(r.crossMidnightIndices, [1, 2]);
	assert.deepEqual(r.errors, [{ index: 1, code: "cross-midnight" }, { index: 2, code: "cross-midnight" }]);
});

test("timesToRows: zero duration is flagged", () => {
	for (const s of ["0900-0900", "2400-2400"]) {
		const r = plain(t.timesToRows(s));
		assert.equal(r.valid, false);
		assert.equal(r.rows.length, 1);
		assert.deepEqual(r.errors, [{ index: 0, code: "empty-duration" }]);
		assert.deepEqual(r.crossMidnightIndices, []);
	}
	const mixed = plain(t.timesToRows("0900-0900,2200-0100"));
	assert.deepEqual(mixed.errors, [{ index: 0, code: "empty-duration" }, { index: 1, code: "cross-midnight" }]);
	assert.deepEqual(mixed.crossMidnightIndices, [1]);
});

test("timesToRows does not mutate or depend on state", () => {
	const s = "1300-1400,0900-1000";
	assert.equal(plain(t.timesToRows(s)).cleanedTimes, "0900-1000,1300-1400");
	assert.equal(plain(t.timesToRows(s)).cleanedTimes, "0900-1000,1300-1400");
});

test("rowsToTimes: allDay option, invalid type, empty", () => {
	assert.deepEqual(plain(t.rowsToTimes(null, { allDay: true })), {
		valid: true, times: "0000-2400", allDay: true, crossMidnightRows: [], errors: [],
	});
	assert.deepEqual(plain(t.rowsToTimes("x")), {
		valid: false, times: null, allDay: false, crossMidnightRows: [], errors: [{ index: -1, code: "invalid-type" }],
	});
	assert.deepEqual(plain(t.rowsToTimes([])), { valid: true, times: "", allDay: false, crossMidnightRows: [], errors: [] });
});

test("rowsToTimes: canonical output sorts and merges, detects all-day", () => {
	const rows = [{ from: "13:00", to: "17:00" }, { from: "09:00", to: "12:00" }, { from: "11:00", to: "13:00" }];
	const frozen = structuredClone(rows);
	const r = plain(t.rowsToTimes(rows));
	assert.deepEqual(rows, frozen);
	assert.deepEqual(r, { valid: true, times: "0900-1700", allDay: false, crossMidnightRows: [], errors: [] });
	const all = plain(t.rowsToTimes([{ from: "00:00", to: "24:00" }]));
	assert.equal(all.times, "0000-2400");
	assert.equal(all.allDay, true);
});

test("rowsToTimes: end-of-day 00:00 is normalised to 24:00", () => {
	assert.equal(plain(t.rowsToTimes([{ from: "22:00", to: "00:00" }])).times, "2200-2400");
	const r = plain(t.rowsToTimes([{ from: "00:00", to: "00:00" }]));
	assert.equal(r.valid, false);
	assert.deepEqual(r.errors, [{ index: 0, code: "empty-duration" }]);
});

test("rowsToTimes: invalid format rows", () => {
	const bad = [
		{ from: "9:00", to: "10:00" }, { from: "09:00", to: "10:60" }, { from: "25:00", to: "26:00" },
		{ from: "09:00", to: "24:30" }, { from: "09:00" }, null, { from: 900, to: 1000 }, "09:00-10:00",
	];
	const r = plain(t.rowsToTimes(bad));
	assert.equal(r.valid, false);
	assert.equal(r.times, null);
	assert.deepEqual(r.errors, bad.map((_, index) => ({ index, code: "invalid-format" })));
});

test("rowsToTimes: cross-midnight and empty-duration are reported in index order", () => {
	const rows = [
		{ from: "22:00", to: "02:00" }, { from: "09:00", to: "09:00" }, { from: "10:00", to: "11:00" }, { from: "24:00", to: "00:00" },
	];
	const r = plain(t.rowsToTimes(rows));
	assert.equal(r.valid, false);
	assert.equal(r.times, null);
	assert.deepEqual(r.crossMidnightRows, [{ index: 0, from: "22:00", to: "02:00" }]);
	assert.deepEqual(r.errors, [
		{ index: 0, code: "cross-midnight" }, { index: 1, code: "empty-duration" }, { index: 3, code: "empty-duration" },
	]);
});

test("detectCrossMidnight: rows", () => {
	const r = plain(t.detectCrossMidnight([
		{ from: "09:00", to: "10:00" }, { from: "23:00", to: "01:30" }, { from: "22:00", to: "00:00" }, { from: "bad", to: "x" },
	]));
	assert.deepEqual(r, {
		hasCrossMidnight: true, indices: [1], ranges: [{ index: 1, from: "23:00", to: "01:30" }],
		daysRule: "selected-days-apply-to-after-midnight",
	});
});

test("detectCrossMidnight: string", () => {
	const r = plain(t.detectCrossMidnight("0900-1000, 2300-0130 2200-0000"));
	assert.equal(r.hasCrossMidnight, true);
	assert.deepEqual(r.indices, [1, 2]);
	assert.deepEqual(r.ranges, [{ index: 1, from: "23:00", to: "01:30" }, { index: 2, from: "22:00", to: "00:00" }]);
	const none = plain(t.detectCrossMidnight("0900-1000"));
	assert.deepEqual(none, {
		hasCrossMidnight: false, indices: [], ranges: [], daysRule: "selected-days-apply-to-after-midnight",
	});
	assert.equal(plain(t.detectCrossMidnight("")).hasCrossMidnight, false);
	assert.equal(plain(t.detectCrossMidnight(42)).hasCrossMidnight, false);
});

test("splitCrossMidnight: string", () => {
	const r = plain(t.splitCrossMidnight("2330-0030,0900-1000"));
	assert.equal(r.changed, true);
	assert.deepEqual(r.rows, [
		{ from: "23:30", to: "24:00" }, { from: "00:00", to: "00:30" }, { from: "09:00", to: "10:00" },
	]);
	assert.deepEqual(r.afterMidnightParts, [{ from: "00:00", to: "00:30" }]);
	assert.equal(r.times, "0000-0030,0900-1000,2330-2400");
	assert.deepEqual(r.cleanedRows, [
		{ from: "00:00", to: "00:30" }, { from: "09:00", to: "10:00" }, { from: "23:30", to: "24:00" },
	]);
	assert.equal(r.allDay, false);
	assert.equal(r.daysRule, "selected-days-apply-to-after-midnight");
});

test("splitCrossMidnight: no crossing leaves ranges intact", () => {
	const r = plain(t.splitCrossMidnight("0900-1000"));
	assert.equal(r.changed, false);
	assert.deepEqual(r.rows, [{ from: "09:00", to: "10:00" }]);
	assert.deepEqual(r.afterMidnightParts, []);
	assert.equal(r.times, "0900-1000");
});

test("splitCrossMidnight: merges with ranges adjacent to midnight and detects all-day", () => {
	const r = plain(t.splitCrossMidnight("2200-0200,0200-2200"));
	assert.equal(r.times, "0000-2400");
	assert.equal(r.allDay, true);
	const adj = plain(t.splitCrossMidnight([{ from: "22:00", to: "02:00" }, { from: "00:00", to: "03:00" }, { from: "20:00", to: "22:00" }]));
	assert.equal(adj.times, "0000-0300,2000-2400");
});

test("splitCrossMidnight: rows apply 00:00 end-of-day normalisation and do not mutate", () => {
	const rows = [{ from: "22:00", to: "00:00" }, { from: "23:00", to: "01:00" }];
	const copy = structuredClone(rows);
	const r = plain(t.splitCrossMidnight(rows));
	assert.deepEqual(rows, copy);
	assert.deepEqual(r.rows, [
		{ from: "22:00", to: "24:00" }, { from: "23:00", to: "24:00" }, { from: "00:00", to: "01:00" },
	]);
	assert.equal(r.times, "0000-0100,2200-2400");
	assert.equal(r.changed, true);
});

test("splitCrossMidnight: zero-length after-midnight part from 2200-0000 is reported but not kept in times", () => {
	const r = plain(t.splitCrossMidnight("2200-0000"));
	assert.equal(r.changed, true);
	assert.deepEqual(r.afterMidnightParts, [{ from: "00:00", to: "00:00" }]);
	assert.equal(r.times, "2200-2400");
});

test("splitCrossMidnight: invalid string yields empty result", () => {
	const r = plain(t.splitCrossMidnight("0900-2500"));
	assert.equal(r.changed, false);
	assert.equal(r.times, "");
	assert.deepEqual(r.rows, []);
});

test("validateSchedule: defaults", () => {
	const r = plain(t.validateSchedule());
	assert.equal(r.valid, true);
	assert.deepEqual(r.normalized, {
		times: "", allDay: false, days: [false, true, true, true, true, true, false],
		limitMins: "", limitPeriod: "", conjMode: false,
	});
	assert.equal(r.hasDays, true);
	assert.equal(r.hasTimes, false);
	assert.equal(r.limitConfigured, false);
	assert.equal(r.canTriggerOrdinarily, false);
	assert.deepEqual(r.warnings, ["no-times-or-limit"]);
	assert.deepEqual(r.errors, []);
	assert.equal(plain(t.validateSchedule(null)).valid, true);
});

test("validateSchedule: times, rows and allDay sources", () => {
	let r = plain(t.validateSchedule({ times: "1300-1400,0900-1000" }));
	assert.equal(r.normalized.times, "0900-1000,1300-1400");
	assert.equal(r.canTriggerOrdinarily, true);
	r = plain(t.validateSchedule({ rows: [{ from: "09:00", to: "10:00" }], times: "bogus" }));
	assert.equal(r.valid, true);
	assert.equal(r.normalized.times, "0900-1000");
	r = plain(t.validateSchedule({ allDay: true, times: "bogus", rows: "bogus" }));
	assert.equal(r.valid, true);
	assert.equal(r.normalized.times, "0000-2400");
	assert.equal(r.normalized.allDay, true);
	r = plain(t.validateSchedule({ times: "0000-2400" }));
	assert.equal(r.normalized.allDay, true);
});

test("validateSchedule: times/rows errors are copied with field and index", () => {
	let r = plain(t.validateSchedule({ times: "2200-0200" }));
	assert.equal(r.valid, false);
	assert.equal(r.normalized.times, "");
	assert.deepEqual(r.errors, [{ field: "times", code: "cross-midnight", index: 0 }]);
	assert.equal(r.canTriggerOrdinarily, false);
	r = plain(t.validateSchedule({ rows: [{ from: "09:00", to: "09:00" }] }));
	assert.deepEqual(r.errors, [{ field: "times", code: "empty-duration", index: 0 }]);
	r = plain(t.validateSchedule({ rows: 5 }));
	assert.deepEqual(r.errors, [{ field: "times", code: "invalid-type", index: -1 }]);
	r = plain(t.validateSchedule({ times: "09:00" }));
	assert.deepEqual(r.errors, [{ field: "times", code: "invalid-format", index: -1 }]);
});

test("validateSchedule: access-prevent times reject all-day", () => {
	let r = plain(t.validateSchedule({ times: "0000-2400", isAccessPreventTimes: true }));
	assert.equal(r.valid, false);
	assert.deepEqual(r.errors, [{ field: "times", code: "apt-cannot-be-all-day" }]);
	r = plain(t.validateSchedule({ allDay: true, isAccessPreventTimes: true }));
	assert.deepEqual(r.errors, [{ field: "times", code: "apt-cannot-be-all-day" }]);
	r = plain(t.validateSchedule({ rows: [{ from: "00:00", to: "12:00" }, { from: "12:00", to: "24:00" }], isAccessPreventTimes: true }));
	assert.equal(r.valid, false);
	assert.equal(plain(t.validateSchedule({ times: "0900-1000", isAccessPreventTimes: true })).valid, true);
});

test("validateSchedule: days validation", () => {
	const def = [false, true, true, true, true, true, false];
	for (const days of [[true], "x", null, [1, 0, 0, 0, 0, 0, 0], [true, true, true, true, true, true, true, true]]) {
		const r = plain(t.validateSchedule({ days, times: "0900-1000" }));
		assert.equal(r.valid, false);
		assert.deepEqual(r.errors, [{ field: "days", code: "invalid-days" }]);
		assert.deepEqual(r.normalized.days, def);
		assert.equal(r.canTriggerOrdinarily, false);
	}
	const none = plain(t.validateSchedule({ days: new Array(7).fill(false), times: "0900-1000" }));
	assert.equal(none.hasDays, false);
	assert.equal(none.canTriggerOrdinarily, false);
	assert.deepEqual(none.warnings, ["no-days"]);
});

test("validateSchedule: days default is a copy and input days are not shared", () => {
	const a = t.validateSchedule();
	a.normalized.days[0] = true;
	assert.deepEqual(plain(t.validateSchedule().normalized.days), [false, true, true, true, true, true, false]);
	assert.equal(t.PER_SET_OPTIONS.days.def[0], false);
	const days = [true, true, true, true, true, true, true];
	const r = t.validateSchedule({ days });
	r.normalized.days[0] = false;
	assert.equal(days[0], true);
});

test("validateSchedule: limit validation", () => {
	let r = plain(t.validateSchedule({ limitMins: "0", limitPeriod: "3600" }));
	assert.deepEqual(r.errors, [{ field: "limitMins", code: "invalid-limit-mins" }]);
	assert.equal(r.normalized.limitMins, "");
	assert.equal(r.limitConfigured, false);
	assert.deepEqual(r.warnings.filter((w) => w.startsWith("limit-")), []);
	r = plain(t.validateSchedule({ limitMins: 30 }));
	assert.deepEqual(r.errors, [{ field: "limitMins", code: "invalid-limit-mins" }]);
	r = plain(t.validateSchedule({ limitMins: "1.5", limitPeriod: "3601" }));
	assert.deepEqual(r.errors, [{ field: "limitPeriod", code: "invalid-limit-period" }]);
	r = plain(t.validateSchedule({ limitPeriod: 3600 }));
	assert.deepEqual(r.errors, [{ field: "limitPeriod", code: "invalid-limit-period" }]);
	r = plain(t.validateSchedule({ limitMins: "30", limitPeriod: "3600" }));
	assert.equal(r.valid, true);
	assert.equal(r.limitConfigured, true);
	assert.equal(r.canTriggerOrdinarily, true);
	assert.deepEqual(r.warnings, []);
	r = plain(t.validateSchedule({ limitMins: "0.5", limitPeriod: "300" }));
	assert.equal(r.valid, true);
});

test("validateSchedule: conjMode validation", () => {
	const r = plain(t.validateSchedule({ conjMode: "yes" }));
	assert.deepEqual(r.errors, [{ field: "conjMode", code: "invalid-conj-mode" }]);
	assert.equal(r.normalized.conjMode, false);
});

test("validateSchedule: warnings and canTriggerOrdinarily", () => {
	let r = plain(t.validateSchedule({ limitMins: "10" }));
	assert.deepEqual(r.warnings, ["limit-missing-period", "no-times-or-limit"]);
	r = plain(t.validateSchedule({ limitPeriod: "600" }));
	assert.deepEqual(r.warnings, ["limit-missing-mins", "no-times-or-limit"]);
	r = plain(t.validateSchedule({ conjMode: true }));
	assert.deepEqual(r.warnings, ["and-missing-times", "and-missing-limit"]);
	r = plain(t.validateSchedule({ conjMode: true, times: "0900-1000" }));
	assert.deepEqual(r.warnings, ["and-missing-limit"]);
	assert.equal(r.canTriggerOrdinarily, false);
	r = plain(t.validateSchedule({ conjMode: true, limitMins: "5", limitPeriod: "300" }));
	assert.deepEqual(r.warnings, ["and-missing-times"]);
	r = plain(t.validateSchedule({ conjMode: true, times: "0900-1000", limitMins: "5", limitPeriod: "300" }));
	assert.deepEqual(r.warnings, []);
	assert.equal(r.canTriggerOrdinarily, true);
	r = plain(t.validateSchedule({ days: new Array(7).fill(false), conjMode: true }));
	assert.deepEqual(r.warnings, ["no-days", "and-missing-times", "and-missing-limit"]);
});

test("validateSchedule does not mutate its input", () => {
	const input = {
		rows: [{ from: "13:00", to: "14:00" }, { from: "09:00", to: "10:00" }],
		days: [true, false, true, false, true, false, true],
		limitMins: "5", limitPeriod: "300", conjMode: true, isAccessPreventTimes: false,
	};
	const copy = structuredClone(input);
	t.validateSchedule(input);
	assert.deepEqual(input, copy);
});
