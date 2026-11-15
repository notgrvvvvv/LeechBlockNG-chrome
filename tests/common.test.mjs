/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import test from "node:test";
import assert from "node:assert/strict";
import { loadCommon } from "./load-common.mjs";

const common = loadCommon();

test("cleanTimePeriods merges overlapping and adjacent periods and sorts them", () => {
	assert.equal(common.cleanTimePeriods("1300-1700, 0900-1200"), "0900-1200,1300-1700");
	assert.equal(common.cleanTimePeriods("0900-1200, 1100-1300"), "0900-1300");
	assert.equal(common.cleanTimePeriods("0900-1200,1200-1330"), "0900-1330");
	assert.equal(common.cleanTimePeriods("0900-1400, 1000-1200"), "0900-1400");
	assert.equal(common.cleanTimePeriods("0900-2500"), "0900-2400");
});

test("cleanTimePeriods discards overnight and zero-length periods", () => {
	assert.equal(common.cleanTimePeriods("2200-0200"), "");
	assert.equal(common.cleanTimePeriods("1200-1200"), "");
	assert.equal(common.cleanTimePeriods("0900-1200, 2200-0200"), "0900-1200");
	assert.equal(common.cleanTimePeriods(""), "");
});

test("getRegExpSites matches bare domain and www without matchSubdomains, and arbitrary subdomains with matchSubdomains", () => {
	const noSub = common.getRegExpSites("example.com", false);
	const blockNoSub = new RegExp(noSub.block);
	assert.equal(blockNoSub.test("https://example.com/"), true);
	assert.equal(blockNoSub.test("https://www.example.com/path"), true);
	assert.equal(blockNoSub.test("https://sub.example.com/"), false);

	const withSub = common.getRegExpSites("example.com", true);
	const blockWithSub = new RegExp(withSub.block);
	assert.equal(blockWithSub.test("https://example.com/"), true);
	assert.equal(blockWithSub.test("https://www.example.com/path"), true);
	assert.equal(blockWithSub.test("https://sub.example.com/"), true);
	assert.equal(blockWithSub.test("https://a.b.example.com/"), true);
});

test("getRegExpSites handles exceptions (+), wildcards (* and **), referrers (>), keywords (~), and comments (#)", () => {
	const parsed = common.getRegExpSites(
		"# comment\nexample.com\n+docs.example.com\n+example.com/allowed/*\n>aggregator.example\n~distracting_word",
		false
	);
	const blockRe = new RegExp(parsed.block);
	const allowRe = new RegExp(parsed.allow);
	const referRe = new RegExp(parsed.refer);
	const keywordRe = new RegExp(parsed.keyword, "iu");

	assert.equal(blockRe.test("https://example.com/feed"), true);
	assert.equal(allowRe.test("https://docs.example.com/guide"), true);
	assert.equal(allowRe.test("https://example.com/allowed/page"), true);
	assert.equal(allowRe.test("https://example.com/feed"), false);
	assert.equal(referRe.test("https://aggregator.example/links"), true);
	assert.equal(keywordRe.test("This has distracting word inside"), true);
	assert.equal(keywordRe.test("This has distracting_other inside"), false);

	const wildcardParsed = common.getRegExpSites("example.com/*/post **.social.test", true);
	const wildcardRe = new RegExp(wildcardParsed.block);
	assert.equal(wildcardRe.test("https://example.com/user/post"), true);
	assert.equal(wildcardRe.test("https://example.com/a/b/post"), false);
	assert.equal(wildcardRe.test("https://app.social.test/home/feed"), true);
});

test("getTimePeriodStart aligns hourly, daily, and weekly periods and respects limitOffset", () => {
	const sampleNow = Math.floor(new Date(2026, 10, 15, 14, 35, 20).getTime() / 1000); // Sun 2026-11-15 14:35:20 local

	// Hourly (3600s)
	const hourStart = common.getTimePeriodStart(sampleNow, 3600, 0);
	assert.equal(hourStart % 3600, 0);
	assert.ok(hourStart <= sampleNow && sampleNow < hourStart + 3600);
	assert.equal(new Date(hourStart * 1000).getMinutes(), 0);

	// Daily (86400s) with 0 offset -> local 00:00:00 of same day
	const dayStart = common.getTimePeriodStart(sampleNow, 86400, 0);
	const dayDate = new Date(dayStart * 1000);
	assert.equal(dayDate.getFullYear(), 2026);
	assert.equal(dayDate.getMonth(), 10);
	assert.equal(dayDate.getDate(), 15);
	assert.equal(dayDate.getHours(), 0);
	assert.equal(dayDate.getMinutes(), 0);

	// Daily with +3h offset (03:00 local)
	const dayOffsetStart = common.getTimePeriodStart(sampleNow, 86400, 3);
	const dayOffsetDate = new Date(dayOffsetStart * 1000);
	assert.equal(dayOffsetDate.getDate(), 15);
	assert.equal(dayOffsetDate.getHours(), 3);
	assert.ok(dayOffsetStart <= sampleNow && sampleNow < dayOffsetStart + 86400);

	// Daily with +16h offset (16:00 local -> at 14:35 we are still in yesterday's 16:00 period)
	const dayLateOffsetStart = common.getTimePeriodStart(sampleNow, 86400, 16);
	const dayLateDate = new Date(dayLateOffsetStart * 1000);
	assert.equal(dayLateDate.getDate(), 14);
	assert.equal(dayLateDate.getHours(), 16);
	assert.ok(dayLateOffsetStart <= sampleNow && sampleNow < dayLateOffsetStart + 86400);

	// Weekly (604800s) -> Sunday local 00:00:00
	const wedNow = Math.floor(new Date(2026, 10, 18, 10, 0, 0).getTime() / 1000); // Wed 2026-11-18
	const weekStart = common.getTimePeriodStart(wedNow, 604800, 0);
	const weekDate = new Date(weekStart * 1000);
	assert.equal(weekDate.getDay(), 0); // Sunday
	assert.equal(weekDate.getDate(), 15);
	assert.equal(weekDate.getHours(), 0);

	// Falsy limitPeriod defaults to 3600s; negative limitPeriod returns 0
	assert.equal(common.getTimePeriodStart(sampleNow, 0, 0), hourStart);
	assert.equal(common.getTimePeriodStart(sampleNow, "", 0), hourStart);
	assert.equal(common.getTimePeriodStart(sampleNow, -1, 0), 0);
});

test("cleanSites strips protocols and sorts only when requested", () => {
	assert.equal(
		common.cleanSites("  https://zeta.test  http://alpha.test +https://beta.test  ", true),
		"+beta.test alpha.test zeta.test"
	);
	assert.equal(
		common.cleanSites("https://zeta.test alpha.test", false),
		"zeta.test alpha.test"
	);
});

test("encodeDays and decodeDays round-trip all 7 weekdays", () => {
	const weekdays = [false, true, true, true, true, true, false];
	const code = common.encodeDays(weekdays);
	assert.equal(code, 0b0111110);
	assert.deepEqual(Array.from(common.decodeDays(code)), weekdays);
});

test("cleanOptions fills missing defaults and clamps numSets to [1, MAX_SETS]", () => {
	const opts = { numSets: "99", sites1: "example.com" };
	common.cleanOptions(opts);
	assert.equal(opts.numSets, String(common.MAX_SETS));
	assert.equal(opts.sites1, "example.com");
	assert.equal(opts.blockURL1, common.DEFAULT_BLOCK_URL);
	assert.deepEqual(Array.from(opts.days1), [false, true, true, true, true, true, false]);
	assert.equal(opts.sites30, "");
});

test("formatTime and format validators handle valid and invalid inputs", () => {
	assert.equal(common.formatTime(3661), "01:01:01");
	assert.equal(common.formatTime(-65), "-00:01:05");
	assert.equal(common.checkTimePeriodsFormat("0900-1230,1330-1700"), true);
	assert.equal(common.checkTimePeriodsFormat("900-1230"), false);
	assert.equal(common.checkPosIntFormat("10"), true);
	assert.equal(common.checkPosIntFormat("0"), false);
	assert.equal(common.checkPosNegIntFormat("-2"), true);
	assert.equal(common.checkPosNegIntFormat("0"), false);
	assert.equal(common.checkPosNumberFormat("0.5"), true);
	assert.equal(common.checkPosNumberFormat("0"), false);
});
