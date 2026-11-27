/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

(function () {
	"use strict";

	if (typeof chrome === "undefined" || !chrome.i18n || typeof chrome.i18n.getMessage !== "function") {
		return;
	}

	const HAS_PLACEHOLDER = /\{[A-Za-z0-9_-]+\}/;
	const PLACEHOLDER_SPLIT = /(\{[A-Za-z0-9_-]+\})/g;
	const PLACEHOLDER_NAME = /^\{([A-Za-z0-9_-]+)\}$/;
	const ATTR_MAP = [
		["data-i18n-title", "title"],
		["data-i18n-placeholder", "placeholder"],
		["data-i18n-aria-label", "aria-label"],
	];

	function getMessage(key) {
		if (!key) return "";
		return chrome.i18n.getMessage(key) || "";
	}

	function applyMessage(el, message) {
		if (!HAS_PLACEHOLDER.test(message)) {
			if (el.tagName === "TITLE") {
				document.title = message;
			} else {
				el.textContent = message;
			}
			return;
		}

		const slots = new Map();
		for (const child of el.querySelectorAll("[id], [data-slot]")) {
			const slotName = child.getAttribute("data-slot");
			if (slotName && !slots.has(slotName)) {
				slots.set(slotName, child);
			}
			if (child.id && !slots.has(child.id)) {
				slots.set(child.id, child);
			}
		}

		const fragment = document.createDocumentFragment();
		for (const part of message.split(PLACEHOLDER_SPLIT)) {
			if (!part) continue;
			const match = PLACEHOLDER_NAME.exec(part);
			if (match && slots.has(match[1])) {
				fragment.appendChild(slots.get(match[1]));
			} else {
				fragment.appendChild(document.createTextNode(part));
			}
		}
		el.replaceChildren(fragment);
	}

	const htmlLang = getMessage("htmlLang");
	if (htmlLang) {
		document.documentElement.lang = htmlLang;
	}

	for (const el of document.querySelectorAll("[data-i18n]")) {
		const msg = getMessage(el.getAttribute("data-i18n"));
		if (msg) {
			applyMessage(el, msg);
		}
	}

	for (const [dataAttr, targetAttr] of ATTR_MAP) {
		for (const el of document.querySelectorAll(`[${dataAttr}]`)) {
			const msg = getMessage(el.getAttribute(dataAttr));
			if (msg) {
				el.setAttribute(targetAttr, msg);
			}
		}
	}
})();
