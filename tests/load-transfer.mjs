/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COMMON_PATH = path.resolve(__dirname, "..", "common.js");
const TRANSFER_PATH = path.resolve(__dirname, "..", "options-transfer.js");

const EXPORTED_SYMBOLS = [
	"MAX_SETS",
	"PER_SET_OPTIONS",
	"GENERAL_OPTIONS",
	"cleanOptions",
	"encodeDays",
	"decodeDays",
	"SUPPORTED_THEMES",
	"FIREFOX_KEY_MAP",
	"FIREFOX_UNSUPPORTED_PREFIXES",
	"exportOptionsToText",
	"exportOptionsToJSON",
	"importOptionsFromText",
	"importOptionsFromJSON",
];

// Run common.js then options-transfer.js as classic scripts in one vm context
export function loadTransfer(overrides = {}) {
	const warnings = [];
	const context = {
		warn: (msg) => warnings.push(String(msg)),
		console,
		chrome: {},
		structuredClone,
		browser: { i18n: { getMessage: () => "" } },
		...overrides,
	};
	vm.createContext(context);
	for (const file of [COMMON_PATH, TRANSFER_PATH]) {
		vm.runInContext(fs.readFileSync(file, "utf8"), context, { filename: file });
	}
	vm.runInContext(`globalThis.__exported = { ${EXPORTED_SYMBOLS.join(", ")} };`, context);
	return { ...context.__exported, _warnings: warnings, _context: context };
}
