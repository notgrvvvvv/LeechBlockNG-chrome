/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COMMON_PATH = path.resolve(__dirname, "..", "common.js");
const TIMES_PATH = path.resolve(__dirname, "..", "times-helper.js");

const EXPORTED_SYMBOLS = [
	"ALL_DAY_TIMES",
	"PER_SET_OPTIONS",
	"ALLOWED_LIMIT_PERIODS",
	"timesToRows",
	"rowsToTimes",
	"detectCrossMidnight",
	"splitCrossMidnight",
	"validateSchedule",
];

// Run common.js then times-helper.js as classic scripts in one vm context.
// Results are created in the vm realm; use plain() to compare them.
export function loadTimes(overrides = {}) {
	const warnings = [];
	const context = {
		warn: (msg) => warnings.push(String(msg)),
		structuredClone,
		browser: {
			i18n: {
				getMessage: () => "",
			},
		},
		...overrides,
	};
	vm.createContext(context);
	vm.runInContext(fs.readFileSync(COMMON_PATH, "utf8"), context, { filename: COMMON_PATH });
	vm.runInContext(fs.readFileSync(TIMES_PATH, "utf8"), context, { filename: TIMES_PATH });
	const exportSnippet = `globalThis.__exported = { ${EXPORTED_SYMBOLS.join(", ")} };`;
	vm.runInContext(exportSnippet, context, { filename: "export-snippet.js" });
	return { ...context.__exported, _warnings: warnings, _context: context };
}

// Convert a vm-realm value into a main-realm value for deep comparison
export function plain(value) {
	return JSON.parse(JSON.stringify(value));
}
