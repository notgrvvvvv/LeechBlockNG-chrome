/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadCommon } from "./load-common.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const inventory = JSON.parse(fs.readFileSync(path.join(__dirname, "inventory.json"), "utf8"));
const optionsHtml = fs.readFileSync(path.join(ROOT, "options.html"), "utf8");
const common = loadCommon();

test("PER_SET_OPTIONS matches inventory 1:1 (all 53 keys)", () => {
	const actualKeys = Object.keys(common.PER_SET_OPTIONS);
	const invKeys = Object.keys(inventory.perSetOptions);

	const missing = actualKeys.filter((k) => !invKeys.includes(k));
	const extra = invKeys.filter((k) => !actualKeys.includes(k));

	assert.deepEqual(missing, [], `Missing PER_SET_OPTIONS keys in inventory: ${missing.join(", ")}`);
	assert.deepEqual(extra, [], `Extra PER_SET_OPTIONS keys in inventory: ${extra.join(", ")}`);
	assert.equal(actualKeys.length, 53);

	for (const key of actualKeys) {
		const spec = common.PER_SET_OPTIONS[key];
		const entry = inventory.perSetOptions[key];
		assert.equal(entry.type, spec.type, `Type mismatch for PER_SET_OPTIONS.${key}`);
		assert.equal(entry.id, spec.id, `DOM id mismatch for PER_SET_OPTIONS.${key}`);
		assert.deepEqual(
			Array.isArray(spec.def) ? Array.from(spec.def) : spec.def,
			entry.def,
			`Default mismatch for PER_SET_OPTIONS.${key}`
		);
		assert.ok(entry.summaryRole, `Missing summaryRole for PER_SET_OPTIONS.${key}`);

		const domId = spec.id === "day" ? "day01" : `${spec.id}1`;
		assert.ok(
			optionsHtml.includes(`id="${domId}"`),
			`Expected DOM control id="${domId}" in options.html for PER_SET_OPTIONS.${key}`
		);
	}
});

test("GENERAL_OPTIONS matches inventory 1:1 (all 45 keys)", () => {
	const actualKeys = Object.keys(common.GENERAL_OPTIONS);
	const invKeys = Object.keys(inventory.generalOptions);

	const missing = actualKeys.filter((k) => !invKeys.includes(k));
	const extra = invKeys.filter((k) => !actualKeys.includes(k));

	assert.deepEqual(missing, [], `Missing GENERAL_OPTIONS keys in inventory: ${missing.join(", ")}`);
	assert.deepEqual(extra, [], `Extra GENERAL_OPTIONS keys in inventory: ${extra.join(", ")}`);
	assert.equal(actualKeys.length, 45);

	let uiControlCount = 0;
	for (const key of actualKeys) {
		const spec = common.GENERAL_OPTIONS[key];
		const entry = inventory.generalOptions[key];
		assert.equal(entry.type, spec.type, `Type mismatch for GENERAL_OPTIONS.${key}`);
		assert.equal(entry.id, spec.id, `DOM id mismatch for GENERAL_OPTIONS.${key}`);
		assert.deepEqual(entry.def, spec.def, `Default mismatch for GENERAL_OPTIONS.${key}`);

		if (spec.id !== null) {
			uiControlCount++;
			assert.ok(
				optionsHtml.includes(`id="${spec.id}"`),
				`Expected DOM control id="${spec.id}" in options.html for GENERAL_OPTIONS.${key}`
			);
		} else {
			assert.equal(entry.control, "internal");
		}
	}
	assert.equal(uiControlCount, 39);
});

test("non-option features inventory covers all 12 core areas and referenced files exist", () => {
	const expectedIds = [
		"lockdown",
		"override",
		"add-sites",
		"commands",
		"stats",
		"diagnostics",
		"timers-badge",
		"warning-banner",
		"access-protection",
		"sync-storage",
		"managed-storage",
		"custom-block-pages",
	];
	const actualIds = inventory.nonOptionFeatures.map((f) => f.id);
	assert.deepEqual(actualIds, expectedIds);

	for (const feat of inventory.nonOptionFeatures) {
		for (const file of feat.files) {
			assert.ok(fs.existsSync(path.join(ROOT, file)), `Referenced file missing for ${feat.id}: ${file}`);
		}
	}
});
