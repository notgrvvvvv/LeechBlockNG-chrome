/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COMMON_PATH = path.resolve(__dirname, "..", "common.js");

const EXPORTED_SYMBOLS = [
	"TIMEDATA_LEN",
	"MAX_SETS",
	"ALL_DAY_TIMES",
	"BLOCKED_PAGE",
	"DELAYED_PAGE",
	"PASSWORD_PAGE",
	"DEFAULT_BLOCK_URL",
	"DELAYED_BLOCK_URL",
	"PASSWORD_BLOCK_URL",
	"DEFAULT_ICON",
	"OVERRIDE_ICON",
	"PARSE_URL",
	"ABSOLUTE_URL",
	"INTERNAL_BLOCK_URL",
	"LEECHBLOCK_URL",
	"PER_SET_OPTIONS",
	"GENERAL_OPTIONS",
	"listObjectProperties",
	"cleanOptions",
	"cleanTimeData",
	"getParsedURL",
	"cleanSites",
	"getRegExpSites",
	"patternToRegExp",
	"keywordToRegExp",
	"checkTimePeriodsFormat",
	"checkPosIntFormat",
	"checkPosNegIntFormat",
	"checkPosNumberFormat",
	"checkBlockURLFormat",
	"getMinPeriods",
	"cleanTimePeriods",
	"getTimePeriodStart",
	"updateRolloverTime",
	"formatTime",
	"allTrue",
	"encodeDays",
	"decodeDays",
	"createAccessCode",
	"setTheme",
	"getLocalizedURL",
	"getCleanURL",
	"hashCode32",
	"getTimestampSuffix",
];

export function loadCommon(overrides = {}) {
	const code = fs.readFileSync(COMMON_PATH, "utf8");
	const warnings = [];
	const context = {
		warn: (msg) => warnings.push(String(msg)),
		browser: {
			i18n: {
				getMessage: (key) => (key === "localePath" ? "" : ""),
			},
		},
		...overrides,
	};
	vm.createContext(context);
	const exportSnippet = `\n;globalThis.__exported = { ${EXPORTED_SYMBOLS.join(", ")} };`;
	vm.runInContext(code + exportSnippet, context, { filename: COMMON_PATH });
	return { ...context.__exported, _warnings: warnings };
}
