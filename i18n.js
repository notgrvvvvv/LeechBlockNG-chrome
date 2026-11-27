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

	function appendTextWithLineBreaks(fragment, text) {
		const lines = text.split("\n");
		for (let i = 0; i < lines.length; i++) {
			if (i > 0) {
				fragment.appendChild(document.createElement("br"));
			}
			if (lines[i]) {
				fragment.appendChild(document.createTextNode(lines[i]));
			}
		}
	}

	function getOutermostSlots(el) {
		const candidates = Array.from(el.querySelectorAll("[id], [data-slot]"));
		const candidateSet = new Set(candidates);
		return candidates.filter((node) => {
			let parent = node.parentElement;
			while (parent && parent !== el) {
				if (candidateSet.has(parent)) {
					return false;
				}
				parent = parent.parentElement;
			}
			return true;
		});
	}

	function applyMessage(el, message) {
		if (el.tagName === "TITLE") {
			document.title = message;
			return;
		}

		const slotChildren = getOutermostSlots(el);
		const hasPlaceholder = HAS_PLACEHOLDER.test(message);

		if (!hasPlaceholder && slotChildren.length === 0) {
			if (!message.includes("\n")) {
				el.textContent = message;
			} else {
				const fragment = document.createDocumentFragment();
				appendTextWithLineBreaks(fragment, message);
				el.replaceChildren(fragment);
			}
			return;
		}

		const slots = new Map();
		for (const child of slotChildren) {
			const slotName = child.getAttribute("data-slot");
			if (slotName && !slots.has(slotName)) {
				slots.set(slotName, child);
			}
			if (child.id && !slots.has(child.id)) {
				slots.set(child.id, child);
			}
		}

		const parts = message.split(PLACEHOLDER_SPLIT);
		const referencedChildren = new Set();
		for (const part of parts) {
			if (!part) continue;
			const match = PLACEHOLDER_NAME.exec(part);
			if (!match) continue;
			const child = slots.get(match[1]);
			if (!child || referencedChildren.has(child)) {
				return;
			}
			referencedChildren.add(child);
		}

		if (referencedChildren.size !== slotChildren.length) {
			return;
		}

		const fragment = document.createDocumentFragment();
		for (const part of parts) {
			if (!part) continue;
			const match = PLACEHOLDER_NAME.exec(part);
			if (match) {
				fragment.appendChild(slots.get(match[1]));
			} else {
				appendTextWithLineBreaks(fragment, part);
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
