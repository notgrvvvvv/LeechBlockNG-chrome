/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Time ranges, days and schedule helpers.
// Classic script: loaded after common.js, pure functions only (no DOM,
// no storage/runtime APIs, no mutation of arguments).

const ALLOWED_LIMIT_PERIODS = Object.freeze([
	"", "300", "600", "900", "1200", "1800", "3600", "5400", "7200",
	"10800", "14400", "21600", "28800", "43200", "86400", "172800",
	"259200", "345600", "604800", "1209600", "2592000", "5184000", "7776000"
]);

const TIMES_HELPER_DAYS_RULE = "selected-days-apply-to-after-midnight";
const TIMES_HELPER_ROW_FORMAT = /^([0-2]\d):([0-5]\d)$/;

// Format minutes since midnight as "HH:MM" (1440 -> "24:00")
//
function timesHelperFormatMins(mins) {
	let h = Math.floor(mins / 60);
	let m = mins % 60;
	return ((h < 10) ? "0" : "") + h + ":" + ((m < 10) ? "0" : "") + m;
}

// Format minutes since midnight as "HHMM"
//
function timesHelperCompactMins(mins) {
	return timesHelperFormatMins(mins).replace(":", "");
}

// Parse "HH:MM" (00:00 to 24:00) into minutes, or null if invalid
//
function timesHelperParseRowTime(value) {
	if (typeof value != "string") {
		return null;
	}
	let results = TIMES_HELPER_ROW_FORMAT.exec(value);
	if (results == null) {
		return null;
	}
	let h = parseInt(results[1], 10);
	let m = parseInt(results[2], 10);
	if (h > 24 || (h == 24 && m != 0)) {
		return null;
	}
	return h * 60 + m;
}

// Parse a stored times string into raw {start, end} minute periods,
// or null if the syntax is invalid (hours > 24 and 24:xx are rejected)
//
function timesHelperParseTimes(times) {
	if (typeof times != "string") {
		return null;
	}
	let trimmed = times.trim();
	if (trimmed == "") {
		return [];
	}
	if (!checkTimePeriodsFormat(trimmed)) {
		return null;
	}
	let periods = getMinPeriods(trimmed);
	for (let p of periods) {
		if (p.start > 1440 || p.end > 1440) {
			return null;
		}
	}
	return periods;
}

// Parse editable rows into {index, start, end, from, to}. Rows with invalid
// format are skipped (their indices are collected in the invalid array, if
// given). A row with from > 00:00 and to == 00:00 ends at 24:00.
//
function timesHelperParseRows(rows, invalid) {
	let parsed = [];
	for (let i = 0; i < rows.length; i++) {
		let row = rows[i];
		let start = null;
		let end = null;
		if (row !== null && typeof row == "object") {
			start = timesHelperParseRowTime(row.from);
			end = timesHelperParseRowTime(row.to);
		}
		if (start === null || end === null) {
			if (invalid) {
				invalid.push(i);
			}
			continue;
		}
		if (start > 0 && end == 0) {
			end = 1440;
		}
		parsed.push({ index: i, start: start, end: end, from: row.from, to: row.to });
	}
	return parsed;
}

function timesHelperToRow(p) {
	return { from: timesHelperFormatMins(p.start), to: timesHelperFormatMins(p.end) };
}

function timesHelperMinPeriodsToRows(times) {
	return getMinPeriods(times).map(timesHelperToRow);
}

function timesHelperJoin(periods) {
	return periods.map(function (p) {
		return timesHelperCompactMins(p.start) + "-" + timesHelperCompactMins(p.end);
	}).join(",");
}

// Convert a stored times string to editable rows plus validation metadata
//
function timesToRows(times) {
	if (typeof times != "string") {
		return {
			valid: false, allDay: false, cleanedTimes: "", rows: [],
			crossMidnightIndices: [], errors: [{ index: -1, code: "invalid-type" }]
		};
	}
	if (times.trim() == "") {
		return { valid: true, allDay: false, cleanedTimes: "", rows: [], crossMidnightIndices: [], errors: [] };
	}
	let periods = timesHelperParseTimes(times);
	if (periods === null) {
		return {
			valid: false, allDay: false, cleanedTimes: "", rows: [],
			crossMidnightIndices: [], errors: [{ index: -1, code: "invalid-format" }]
		};
	}
	let rows = periods.map(timesHelperToRow);
	let crossMidnightIndices = [];
	let errors = [];
	periods.forEach(function (p, index) {
		if (p.start > p.end) {
			crossMidnightIndices.push(index);
			errors.push({ index: index, code: "cross-midnight" });
		} else if (p.start == p.end) {
			errors.push({ index: index, code: "empty-duration" });
		}
	});
	if (errors.length > 0) {
		return { valid: false, allDay: false, cleanedTimes: "", rows: rows, crossMidnightIndices: crossMidnightIndices, errors: errors };
	}
	let cleanedTimes = cleanTimePeriods(times.trim());
	return {
		valid: true,
		allDay: (cleanedTimes === ALL_DAY_TIMES),
		cleanedTimes: cleanedTimes,
		rows: timesHelperMinPeriodsToRows(cleanedTimes),
		crossMidnightIndices: [],
		errors: []
	};
}

// Convert editable rows to a canonical times string
//
function rowsToTimes(rows, options = {}) {
	if (options && options.allDay === true) {
		return { valid: true, times: ALL_DAY_TIMES, allDay: true, crossMidnightRows: [], errors: [] };
	}
	if (!Array.isArray(rows)) {
		return { valid: false, times: null, allDay: false, crossMidnightRows: [], errors: [{ index: -1, code: "invalid-type" }] };
	}
	if (rows.length == 0) {
		return { valid: true, times: "", allDay: false, crossMidnightRows: [], errors: [] };
	}
	let invalid = [];
	let parsed = timesHelperParseRows(rows, invalid);
	let crossMidnightRows = [];
	let errors = invalid.map(function (index) { return { index: index, code: "invalid-format" }; });
	for (let p of parsed) {
		if (p.start == p.end) {
			errors.push({ index: p.index, code: "empty-duration" });
		} else if (p.start > p.end) {
			crossMidnightRows.push({ index: p.index, from: p.from, to: p.to });
			errors.push({ index: p.index, code: "cross-midnight" });
		}
	}
	if (errors.length > 0) {
		errors.sort(function (a, b) { return a.index - b.index; });
		return { valid: false, times: null, allDay: false, crossMidnightRows: crossMidnightRows, errors: errors };
	}
	let times = cleanTimePeriods(timesHelperJoin(parsed));
	return { valid: true, times: times, allDay: (times === ALL_DAY_TIMES), crossMidnightRows: [], errors: [] };
}

// Get periods (with original index) from either rows or a times string
//
function timesHelperGetPeriods(rowsOrTimes) {
	if (Array.isArray(rowsOrTimes)) {
		return timesHelperParseRows(rowsOrTimes, null);
	}
	let periods = timesHelperParseTimes(rowsOrTimes);
	if (periods === null) {
		return [];
	}
	return periods.map(function (p, index) { return { index: index, start: p.start, end: p.end }; });
}

// Detect cross-midnight ranges in rows or a times string
//
function detectCrossMidnight(rowsOrTimes) {
	let indices = [];
	let ranges = [];
	let isRows = Array.isArray(rowsOrTimes);
	for (let p of timesHelperGetPeriods(rowsOrTimes)) {
		if (p.start > p.end) {
			indices.push(p.index);
			ranges.push(isRows
				? { index: p.index, from: p.from, to: p.to }
				: { index: p.index, from: timesHelperFormatMins(p.start), to: timesHelperFormatMins(p.end) });
		}
	}
	return { hasCrossMidnight: indices.length > 0, indices: indices, ranges: ranges, daysRule: TIMES_HELPER_DAYS_RULE };
}

// Split cross-midnight ranges at midnight in rows or a times string
//
function splitCrossMidnight(rowsOrTimes) {
	let changed = false;
	let periods = [];
	let afterMidnightParts = [];
	for (let p of timesHelperGetPeriods(rowsOrTimes)) {
		if (p.start > p.end) {
			changed = true;
			periods.push({ start: p.start, end: 1440 });
			periods.push({ start: 0, end: p.end });
			afterMidnightParts.push({ from: "00:00", to: timesHelperFormatMins(p.end) });
		} else {
			periods.push({ start: p.start, end: p.end });
		}
	}
	let times = cleanTimePeriods(timesHelperJoin(periods));
	return {
		changed: changed,
		rows: periods.map(timesHelperToRow),
		cleanedRows: timesHelperMinPeriodsToRows(times),
		times: times,
		allDay: (times === ALL_DAY_TIMES),
		afterMidnightParts: afterMidnightParts,
		daysRule: TIMES_HELPER_DAYS_RULE
	};
}

// Validate a full schedule configuration
//
function validateSchedule(scheduleInput = {}) {
	let input = (scheduleInput !== null && typeof scheduleInput == "object") ? scheduleInput : {};
	let errors = [];
	let times = "";

	// Times
	if (input.allDay === true) {
		times = ALL_DAY_TIMES;
	} else if (input.rows !== undefined || input.times !== undefined) {
		let errs;
		if (input.rows !== undefined) {
			let res = rowsToTimes(input.rows, { allDay: false });
			errs = res.errors;
			times = res.valid ? res.times : "";
		} else {
			let res = timesToRows(input.times);
			errs = res.errors;
			times = res.valid ? res.cleanedTimes : "";
		}
		for (let e of errs) {
			errors.push({ field: "times", code: e.code, index: e.index });
		}
	}
	if (input.isAccessPreventTimes === true && times === ALL_DAY_TIMES) {
		errors.push({ field: "times", code: "apt-cannot-be-all-day" });
	}

	// Days
	let days = PER_SET_OPTIONS.days.def.slice();
	if (input.days !== undefined) {
		if (Array.isArray(input.days) && input.days.length == 7 && input.days.every(function (d) { return typeof d == "boolean"; })) {
			days = input.days.slice();
		} else {
			errors.push({ field: "days", code: "invalid-days" });
		}
	}

	// Limit
	let limitMins = "";
	let limitMinsValid = true;
	if (input.limitMins !== undefined) {
		if (typeof input.limitMins == "string" && checkPosNumberFormat(input.limitMins)) {
			limitMins = input.limitMins;
		} else {
			limitMinsValid = false;
			errors.push({ field: "limitMins", code: "invalid-limit-mins" });
		}
	}
	let limitPeriod = "";
	let limitPeriodValid = true;
	if (input.limitPeriod !== undefined) {
		if (typeof input.limitPeriod == "string" && ALLOWED_LIMIT_PERIODS.includes(input.limitPeriod)) {
			limitPeriod = input.limitPeriod;
		} else {
			limitPeriodValid = false;
			errors.push({ field: "limitPeriod", code: "invalid-limit-period" });
		}
	}

	// Conjunction mode
	let conjMode = false;
	if (input.conjMode !== undefined) {
		if (typeof input.conjMode == "boolean") {
			conjMode = input.conjMode;
		} else {
			errors.push({ field: "conjMode", code: "invalid-conj-mode" });
		}
	}

	let valid = (errors.length == 0);
	let hasDays = days.some(Boolean);
	let hasTimes = (times !== "");
	let limitConfigured = limitMinsValid && limitPeriodValid && Boolean(limitMins && limitPeriod);
	let canTriggerOrdinarily = valid && hasDays &&
			(conjMode ? (hasTimes && limitConfigured) : (hasTimes || limitConfigured));

	let warnings = [];
	if (!hasDays) {
		warnings.push("no-days");
	}
	if (limitMinsValid && limitPeriodValid) {
		if (limitMins !== "" && limitPeriod === "") {
			warnings.push("limit-missing-period");
		}
		if (limitMins === "" && limitPeriod !== "") {
			warnings.push("limit-missing-mins");
		}
	}
	if (conjMode) {
		if (!hasTimes) {
			warnings.push("and-missing-times");
		}
		if (!limitConfigured) {
			warnings.push("and-missing-limit");
		}
	} else if (!hasTimes && !limitConfigured) {
		warnings.push("no-times-or-limit");
	}

	return {
		valid: valid,
		normalized: {
			times: times,
			allDay: (times === ALL_DAY_TIMES),
			days: days,
			limitMins: limitMins,
			limitPeriod: limitPeriod,
			conjMode: conjMode
		},
		hasDays: hasDays,
		hasTimes: hasTimes,
		limitConfigured: limitConfigured,
		canTriggerOrdinarily: canTriggerOrdinarily,
		warnings: warnings,
		errors: errors
	};
}
