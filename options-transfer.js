/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Pure import/export logic for LeechBlock options (text and JSON formats).
// Depends on common.js (must be loaded first). Touches no DOM or browser APIs.

const SUPPORTED_THEMES = Object.freeze(["", "light", "dark"]);

const FIREFOX_KEY_MAP = Object.freeze({ prevAddons: "prevExts" });

const FIREFOX_UNSUPPORTED_PREFIXES = Object.freeze(["prevDebugging", "prevProfiles", "prevSupport"]);

const TRANSFER_NOT_TRANSFERRED = ["timedata", "stats", "lockdown"];

const TRANSFER_NUMERIC = /^-?\d+(\.\d+)?$/;

function transferHas(obj, key) {
	return Object.prototype.hasOwnProperty.call(obj, key);
}

function transferEscapeNewlines(str) {
	return str.replace(/\n/g, "\\n");
}

function transferUnescapeNewlines(str) {
	return str.replace(/\\n/g, "\n");
}

function transferClampNumSets(rawNumSets) {
	return Math.max(1, Math.min(MAX_SETS, Math.floor(Number(rawNumSets))));
}

// Clean and normalize a copy of the options (the argument is never mutated)
//
function transferNormalizeForExport(options) {
	let normalized = {};
	if (options && typeof options == "object") {
		for (let key of Object.keys(options)) {
			let val = options[key];
			normalized[key] = Array.isArray(val) ? val.slice() : val;
		}
	}
	if (typeof normalized.numSets == "number" && Number.isFinite(normalized.numSets)) {
		normalized.numSets = String(normalized.numSets);
	}
	cleanOptions(normalized);

	let numSets = Number(normalized.numSets);
	for (let set = 1; set <= numSets; set++) {
		normalized[`sites${set}`] = cleanSites(normalized[`sites${set}`], normalized[`sortSites${set}`]);
		normalized[`times${set}`] = cleanTimePeriods(normalized[`times${set}`]);
	}
	return normalized;
}

// Compile exportable key/value pairs in canonical order
// (asText: true for text format with days as bitmask, false for JSON format)
//
function transferCompileExport(options, exportSettings, asText) {
	let normalized = transferNormalizeForExport(options);
	let settings = exportSettings || {};
	let includePasswords = (settings.includePasswords !== undefined)
		? Boolean(settings.includePasswords)
		: Boolean(normalized.exportPasswords);
	let numSets = Number(normalized.numSets);
	let out = [];

	function addValue(key, type, val) {
		if (type == "array") {
			out.push([key, asText ? encodeDays(val) : Array.from({ length: 7 }, (_, i) => Boolean(val[i]))]);
		} else if (type == "boolean") {
			out.push([key, asText ? String(val) : val]);
		} else {
			out.push([key, transferEscapeNewlines(val)]);
		}
	}

	for (let set = 1; set <= numSets; set++) {
		for (let name in PER_SET_OPTIONS) {
			if (!includePasswords && name == "passwordSetSpec") continue;
			addValue(`${name}${set}`, PER_SET_OPTIONS[name].type, normalized[`${name}${set}`]);
		}
	}
	for (let name in GENERAL_OPTIONS) {
		if (GENERAL_OPTIONS[name].id === null) continue;
		if (!includePasswords && (name == "password" || name == "orp")) continue;
		addValue(name, GENERAL_OPTIONS[name].type, normalized[name]);
	}
	return out;
}

// Serialize options to the text (.txt) export format
//
function exportOptionsToText(options, exportSettings = {}) {
	let pairs = transferCompileExport(options, exportSettings, true);
	return pairs.map(([key, val]) => `${key}=${val}\n`).join("");
}

// Serialize options to the JSON (.json) export format
//
function exportOptionsToJSON(options, exportSettings = {}) {
	let obj = {};
	for (let [key, val] of transferCompileExport(options, exportSettings, false)) {
		obj[key] = val;
	}
	return JSON.stringify(obj);
}

function transferFail(code, message) {
	return { ok: false, options: null, report: null, error: { code, message } };
}

// Shared import logic.
//
// entries: array of { key, value, unmatched } in order of first appearance
//   (duplicates already resolved: later value wins, first position kept).
//   For unmatched text lines, key is the trimmed line and unmatched is true.
// format: "text" or "json"
//
function transferBuildImport(entries, format, currentOptions) {
	let isJSON = (format == "json");
	let current = (currentOptions && typeof currentOptions == "object") ? currentOptions : {};
	let present = new Map();
	for (let e of entries) {
		if (!e.unmatched) present.set(e.key, e.value);
	}

	// Number of sets
	let numSetsImported = transferClampNumSets(GENERAL_OPTIONS.numSets.def);
	if (present.has("numSets")) {
		let raw = present.get("numSets");
		let valid;
		if (isJSON) {
			valid = (typeof raw == "number" && Number.isFinite(raw)) ||
				(typeof raw == "string" && TRANSFER_NUMERIC.test(raw));
		} else {
			valid = TRANSFER_NUMERIC.test(raw);
		}
		if (!valid) {
			return transferFail("invalid-value", "Invalid value for numSets");
		}
		numSetsImported = transferClampNumSets(raw);
	}

	if (!isJSON) {
		for (let [key, val] of present) {
			if (/^days\d+$/.test(key) && !/^\d+$/.test(val)) {
				return transferFail("invalid-value", `Invalid value for ${key}`);
			}
		}
	}

	let report = {
		sourceFormat: format,
		numSetsImported: numSetsImported,
		mappedKeys: [],
		firefoxOnlyKeys: [],
		unavailableTheme: null,
		unknownKeys: [],
		missingPasswords: {
			generalAccess: false,
			generalAccessActive: false,
			override: false,
			overrideActive: false,
			perSet: [],
			preservedFromCurrent: [],
		},
		notTransferred: TRANSFER_NOT_TRANSFERRED.slice(),
	};
	let unknownSeen = new Set();
	function addUnknown(key) {
		if (!unknownSeen.has(key)) {
			unknownSeen.add(key);
			report.unknownKeys.push(key);
		}
	}

	// Convert a raw value according to the option type
	// (returns undefined when the value cannot be used; JSON values are pre-validated)
	function convert(type, raw) {
		if (isJSON) {
			return (type == "string") ? transferUnescapeNewlines(raw) : (type == "array" ? raw.slice() : raw);
		}
		if (type == "array") return decodeDays(Number(raw));
		if (type == "boolean") return /^(true|false)$/i.test(raw) ? /^true$/i.test(raw) : undefined;
		return transferUnescapeNewlines(raw);
	}

	function checkJSON(key, type, raw) {
		let ok;
		if (type == "array") {
			ok = Array.isArray(raw) && raw.length == 7 && raw.every(v => typeof v == "boolean");
		} else {
			ok = (typeof raw == type);
		}
		return ok ? null : transferFail("invalid-value", `Invalid value for ${key}`);
	}

	let imported = {};
	let mappedSources = []; // { to, raw }
	let rawTheme;

	for (let e of entries) {
		let key = e.key;
		if (e.unmatched) {
			addUnknown(key);
			continue;
		}
		let raw = present.get(key);
		let m;

		if (key == "numSets") {
			continue;
		}
		if ((m = /^prevAddons(\d+)$/.exec(key))) {
			let set = Number(m[1]);
			if (String(set) == m[1] && set >= 1 && set <= numSetsImported) {
				let to = FIREFOX_KEY_MAP.prevAddons + set;
				if (isJSON) {
					let err = checkJSON(key, "boolean", raw);
					if (err) return err;
				}
				report.mappedKeys.push({ from: key, to });
				mappedSources.push({ to, raw });
			} else {
				addUnknown(key);
			}
			continue;
		}
		if (FIREFOX_UNSUPPORTED_PREFIXES.includes(key) ||
				/^(prevDebugging|prevProfiles|prevSupport)\d+$/.test(key)) {
			if (!report.firefoxOnlyKeys.includes(key)) report.firefoxOnlyKeys.push(key);
			continue;
		}
		if ((m = /^([A-Za-z]+)(\d+)$/.exec(key)) && transferHas(PER_SET_OPTIONS, m[1])) {
			let set = Number(m[2]);
			if (String(set) == m[2] && set >= 1 && set <= numSetsImported) {
				let type = PER_SET_OPTIONS[m[1]].type;
				if (isJSON) {
					let err = checkJSON(key, type, raw);
					if (err) return err;
				}
				let val = convert(type, raw);
				if (val !== undefined) imported[key] = val;
			} else {
				addUnknown(key);
			}
			continue;
		}
		if (transferHas(GENERAL_OPTIONS, key) && GENERAL_OPTIONS[key].id !== null) {
			let type = GENERAL_OPTIONS[key].type;
			if (isJSON) {
				let err = checkJSON(key, type, raw);
				if (err) return err;
			}
			let val = convert(type, raw);
			if (val !== undefined) {
				imported[key] = val;
				if (key == "theme") rawTheme = raw;
			}
			continue;
		}
		addUnknown(key);
	}

	// Firefox mapped keys (explicit prevExts takes precedence)
	for (let src of mappedSources) {
		if (present.has(src.to)) continue;
		let val = convert("boolean", src.raw);
		if (val !== undefined) imported[src.to] = val;
	}

	// Theme availability
	if (transferHas(imported, "theme") && !SUPPORTED_THEMES.includes(imported.theme)) {
		report.unavailableTheme = { original: rawTheme, fallback: "" };
		imported.theme = "";
	}

	// Passwords not present in import: preserve from current options
	let preserve = (key) => {
		if (typeof current[key] == "string" && current[key] !== "") {
			imported[key] = current[key];
			report.missingPasswords.preservedFromCurrent.push(key);
		}
	};
	let generalMissing = !present.has("password");
	let overrideMissing = !present.has("orp");
	if (generalMissing) preserve("password");
	if (overrideMissing) preserve("orp");
	let missingSets = [];
	for (let set = 1; set <= numSetsImported; set++) {
		if (!present.has(`passwordSetSpec${set}`)) {
			missingSets.push(set);
			preserve(`passwordSetSpec${set}`);
		}
	}

	// Final normalization
	let options = imported;
	options.numSets = String(numSetsImported);
	cleanOptions(options);
	for (let set = 1; set <= numSetsImported; set++) {
		options[`sites${set}`] = cleanSites(options[`sites${set}`], options[`sortSites${set}`]);
		options[`times${set}`] = cleanTimePeriods(options[`times${set}`]);
	}

	let mp = report.missingPasswords;
	mp.generalAccess = generalMissing;
	mp.generalAccessActive = generalMissing && options.oa === "1";
	mp.override = overrideMissing;
	mp.overrideActive = overrideMissing && options.ora === "9";
	for (let set of missingSets) {
		mp.perSet.push({
			set: set,
			key: `passwordSetSpec${set}`,
			active: options[`passwordRequire${set}`] === "0" &&
				/^(\w+\/)?password\.html\?\$S&\$U$/.test(options[`blockURL${set}`]),
		});
	}

	return { ok: true, error: null, options, report };
}

// Import options from text (.txt) export format
//
function importOptionsFromText(text, currentOptions = {}) {
	if (typeof text != "string" || text.trim() === "") {
		return transferFail("empty-input", "Input is empty");
	}
	let entries = [];
	let index = new Map();
	let hasOptions = false;
	for (let line of text.split(/\r?\n/)) {
		if (line.trim() === "") continue;
		let m = /^(\w+)=(.*)$/.exec(line);
		if (m) {
			hasOptions = true;
			let id = "k:" + m[1];
			if (index.has(id)) {
				index.get(id).value = m[2];
			} else {
				let entry = { key: m[1], value: m[2], unmatched: false };
				index.set(id, entry);
				entries.push(entry);
			}
		} else {
			let trimmed = line.trim();
			let id = "l:" + trimmed;
			if (!index.has(id)) {
				let entry = { key: trimmed, value: null, unmatched: true };
				index.set(id, entry);
				entries.push(entry);
			}
		}
	}
	if (!hasOptions) {
		return transferFail("no-options", "No options found in input");
	}
	return transferBuildImport(entries, "text", currentOptions);
}

// Import options from JSON (.json) export format
//
function importOptionsFromJSON(jsonText, currentOptions = {}) {
	if (typeof jsonText != "string" || jsonText.trim() === "") {
		return transferFail("empty-input", "Input is empty");
	}
	let parsed;
	try {
		parsed = JSON.parse(jsonText);
	} catch (e) {
		return transferFail("invalid-json", "Input is not valid JSON");
	}
	if (parsed === null || typeof parsed != "object" || Array.isArray(parsed)) {
		return transferFail("invalid-shape", "JSON must be an object of options");
	}
	let keys = Object.keys(parsed);
	if (keys.length == 0) {
		return transferFail("no-options", "No options found in input");
	}
	let entries = keys.map(key => ({ key, value: parsed[key], unmatched: false }));
	return transferBuildImport(entries, "json", currentOptions);
}
