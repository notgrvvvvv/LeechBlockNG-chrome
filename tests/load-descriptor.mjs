/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COMMON_PATH = path.resolve(__dirname, "..", "common.js");
const DESCRIPTOR_PATH = path.resolve(__dirname, "..", "rule-descriptor.js");

const EXPORTED_SYMBOLS = [
	"MAX_SETS",
	"ALL_DAY_TIMES",
	"PER_SET_OPTIONS",
	"GENERAL_OPTIONS",
	"cleanOptions",
	"PER_SET_SUMMARY_ROLES",
	"GENERAL_SUMMARY_ROLES",
	"extractSetOptions",
	"describeBlockSet",
	"describeRule",
];

// Run common.js then rule-descriptor.js in one plain vm context (no DOM)
export function loadDescriptor(overrides = {}) {
	const warnings = [];
	const context = {
		structuredClone,
		warn: (msg) => warnings.push(String(msg)),
		browser: { i18n: { getMessage: () => "" } },
		...overrides,
	};
	vm.createContext(context);
	for (const file of [COMMON_PATH, DESCRIPTOR_PATH]) {
		vm.runInContext(fs.readFileSync(file, "utf8"), context, { filename: file });
	}
	vm.runInContext(`globalThis.__exported = { ${EXPORTED_SYMBOLS.join(", ")} };`, context);
	return { ...context.__exported, _warnings: warnings, _context: context };
}

// Convert vm-realm values to current-realm plain data (for deepStrictEqual)
export function plain(value) {
	return JSON.parse(JSON.stringify(value));
}
