/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Pure, language-independent rule descriptor for block sets.
// Loaded after common.js; reads configuration only (no runtime counters).

const PER_SET_SUMMARY_ROLES = Object.freeze({
	setName: "sentence",
	sites: "sentence",
	sortSites: "cosmetic",
	times: "sentence",
	limitMins: "sentence",
	limitPeriod: "sentence",
	limitOffset: "advanced",
	rollover: "advanced",
	conjMode: "sentence",
	days: "sentence",
	blockURL: "sentence",
	passwordRequire: "sentence",
	passwordSetSpec: "sentence",
	customMsg: "sentence",
	incogMode: "advanced",
	activeTabMode: "advanced",
	applyFilter: "sentence",
	filterName: "sentence",
	filterMute: "sentence",
	filterCustom: "sentence",
	closeTab: "sentence",
	activeBlock: "advanced",
	minBlock: "advanced",
	countFocus: "advanced",
	countAllowed: "advanced",
	countAudio: "advanced",
	showKeyword: "cosmetic",
	titleOnly: "advanced",
	delayFirst: "advanced",
	delayFirstMode: "advanced",
	delaySecs: "sentence",
	delayAllowMins: "sentence",
	delayAutoLoad: "advanced",
	delayCancel: "advanced",
	reloadSecs: "advanced",
	addHistory: "advanced",
	allowOverride: "sentence",
	allowOverLock: "sentence",
	prevOpts: "sentence",
	prevGenOpts: "sentence",
	prevExts: "sentence",
	prevSettings: "sentence",
	prevOverride: "advanced",
	disable: "sentence",
	showTimer: "cosmetic",
	allowRefers: "advanced",
	allowKeywords: "advanced",
	waitSecs: "advanced",
	sitesURL: "sentence",
	regexpBlock: "sentence",
	regexpAllow: "advanced",
	regexpKeyword: "advanced",
	ignoreHash: "advanced",
});

const GENERAL_SUMMARY_ROLES = Object.freeze({
	simplified: "internal",
	numSets: "cosmetic",
	sync: "cosmetic",
	theme: "cosmetic",
	customStyle: "cosmetic",
	oa: "cosmetic",
	password: "affects-rule",
	hpp: "cosmetic",
	apt: "cosmetic",
	timerVisible: "cosmetic",
	timerSize: "cosmetic",
	timerLocation: "cosmetic",
	timerMaxHours: "cosmetic",
	timerBadge: "cosmetic",
	orm: "affects-rule",
	orln: "affects-rule",
	orlp: "affects-rule",
	ora: "affects-rule",
	orcode: "cosmetic",
	orp: "affects-rule",
	orc: "cosmetic",
	orlps: "internal",
	orlc: "internal",
	oret: "internal",
	warnSecs: "cosmetic",
	warnImmediate: "cosmetic",
	contextMenu: "cosmetic",
	matchSubdomains: "affects-rule",
	disableLink: "cosmetic",
	clockTimeFormat: "cosmetic",
	saveSecs: "cosmetic",
	clockOffset: "affects-rule",
	ignoreJumpSecs: "cosmetic",
	allFocused: "affects-rule",
	useDocFocus: "affects-rule",
	processTabsSecs: "cosmetic",
	processActiveTabs: "cosmetic",
	prevPastePassword: "cosmetic",
	accessCodeImage: "cosmetic",
	allowLBWebsite: "affects-rule",
	diagMode: "cosmetic",
	exportPasswords: "cosmetic",
	autoExportSync: "cosmetic",
	lockdownHours: "internal",
	lockdownMins: "internal",
});

// Normalize a days value to a fresh 7-element boolean array (Sun..Sat)
//
function normalizeRuleDays(days) {
	let result = [];
	for (let i = 0; i < 7; i++) {
		result.push(Array.isArray(days) ? Boolean(days[i]) : PER_SET_OPTIONS.days.def[i]);
	}
	return result;
}

// Extract (normalized copies of) the options for one block set plus the general options.
// Never mutates fullOptions.
//
function extractSetOptions(fullOptions, setNumber) {
	if (typeof setNumber != "number" || !Number.isInteger(setNumber)
			|| setNumber < 1 || setNumber > MAX_SETS) {
		throw new RangeError(`setNumber must be an integer between 1 and ${MAX_SETS}`);
	}

	let copy = Object.assign({}, fullOptions || {});

	// cleanOptions would turn an unparseable numSets into "NaN"; use the default instead
	if (typeof copy.numSets == "string" && Number.isNaN(+copy.numSets)) {
		delete copy.numSets;
	}

	// First pass: normalize general options and the caller's own range of sets
	cleanOptions(copy);
	let numSets = copy.numSets;

	// Second pass: ensure defaults exist for the requested set (even beyond numSets)
	copy.numSets = Math.max(+numSets, setNumber).toString();
	cleanOptions(copy);
	copy.numSets = numSets;

	let setOptions = {};
	for (let name in PER_SET_OPTIONS) {
		let value = copy[`${name}${setNumber}`];
		setOptions[name] = (name == "days") ? normalizeRuleDays(value) : value;
	}

	let generalOptions = {};
	for (let name in GENERAL_OPTIONS) {
		generalOptions[name] = copy[name];
	}

	return { setOptions, generalOptions };
}

// Describe the rule of one block set within a full options object
//
function describeBlockSet(fullOptions, setNumber) {
	let { setOptions, generalOptions } = extractSetOptions(fullOptions, setNumber);
	return describeRule(setOptions, generalOptions);
}

// Convert a minute count to a 4-digit HHMM string
//
function formatRuleMinutes(mins) {
	let h = Math.floor(mins / 60);
	let m = mins % 60;
	return ((h < 10) ? "0" : "") + h + ((m < 10) ? "0" : "") + m;
}

// Describe a rule from per-set options (no set number suffix) and general options.
// Pure: never mutates arguments, never reads runtime counters, never exposes plaintext passwords.
//
function describeRule(setOptions, generalOptions = {}) {
	// Normalize copies of the inputs using cleanOptions (set number 1 as carrier)
	let temp = {};
	let rawGeneral = generalOptions || {};
	let rawSet = setOptions || {};
	for (let name in GENERAL_OPTIONS) {
		temp[name] = rawGeneral[name];
	}
	temp.numSets = "1";
	for (let name in PER_SET_OPTIONS) {
		temp[`${name}1`] = rawSet[name];
	}
	cleanOptions(temp);

	let s = {};
	for (let name in PER_SET_OPTIONS) {
		s[name] = temp[`${name}1`];
	}
	s.days = normalizeRuleDays(s.days);
	let g = {};
	for (let name in GENERAL_OPTIONS) {
		g[name] = temp[name];
	}

	let disabled = s.disable;

	// Target
	let cleanedSites = cleanSites(s.sites, s.sortSites);
	let counts = { sites: 0, exceptions: 0, keywords: 0, referrers: 0, comments: 0, totalEntries: 0 };
	if (cleanedSites !== "") {
		for (let token of cleanedSites.split(/\s+/)) {
			let c = token.charAt(0);
			if (c == "#") {
				counts.comments++;
			} else if (c == "~") {
				counts.keywords++;
			} else if (c == ">") {
				counts.referrers++;
			} else if (c == "+") {
				counts.exceptions++;
			} else {
				counts.sites++;
			}
		}
	}
	counts.totalEntries = counts.sites + counts.exceptions + counts.keywords
			+ counts.referrers + counts.comments;

	let regexps = getRegExpSites(cleanedSites, g.matchSubdomains);
	let hasMatchableTarget = Boolean(s.regexpBlock || s.sitesURL || regexps.block
			|| (regexps.refer && !s.allowRefers));
	let hasLine558Gate = Boolean(s.regexpBlock || s.sitesURL || regexps.block || regexps.refer);

	let mode;
	if (s.sitesURL !== "" && (cleanedSites !== "" || s.regexpBlock !== "")) {
		mode = "external-url-and-sites";
	} else if (s.sitesURL !== "") {
		mode = "external-url";
	} else if (s.regexpBlock !== "") {
		mode = "regexp";
	} else if (hasMatchableTarget) {
		mode = "sites";
	} else {
		mode = "none";
	}

	// Schedule
	let cleanedTimes = cleanTimePeriods(s.times);
	let timePeriods = getMinPeriods(cleanedTimes).map((mp) => ({
		start: formatRuleMinutes(mp.start),
		end: formatRuleMinutes(mp.end),
		startMins: mp.start,
		endMins: mp.end
	}));
	let hasTimes = (cleanedTimes !== "");
	let hasDays = s.days.some(Boolean);
	let limitConfigured = Boolean(s.limitMins && s.limitPeriod);

	let incompleteReasons = [];
	if (!hasDays) incompleteReasons.push("no-days");
	if (s.conjMode) {
		if (!hasTimes) incompleteReasons.push("and-missing-times");
		if (!limitConfigured) incompleteReasons.push("and-missing-limit");
	} else if (!hasTimes && !limitConfigured) {
		incompleteReasons.push("no-times-or-limit");
	}

	let canTriggerOrdinarily = !disabled && hasDays
			&& (s.conjMode ? (hasTimes && limitConfigured) : (hasTimes || limitConfigured));
	let hasEffectiveTarget = hasMatchableTarget
			|| ((s.prevExts || s.prevSettings) && hasLine558Gate);
	let lockdownPossible = !disabled && hasEffectiveTarget;

	let status;
	let neverBlocks;
	let neverBlocksReasons;
	if (disabled) {
		status = "disabled";
		neverBlocks = true;
		neverBlocksReasons = ["disabled"];
	} else if (!hasEffectiveTarget) {
		status = "never-blocks";
		neverBlocks = true;
		neverBlocksReasons = [(!s.regexpBlock && !s.sitesURL && cleanedSites === "")
				? "no-sites" : "no-matchable-target"];
	} else if (canTriggerOrdinarily) {
		status = "active-schedule";
		neverBlocks = false;
		neverBlocksReasons = [];
	} else {
		status = "lockdown-only";
		neverBlocks = false;
		neverBlocksReasons = [];
	}

	// Action
	let kind;
	if (s.closeTab) {
		kind = "close-tab";
	} else if (s.applyFilter) {
		kind = "filter";
	} else if (s.blockURL == "about:blank") {
		kind = "blank-page";
	} else if (/^(\w+\/)?delayed\.html\?\$S&\$U$/.test(s.blockURL)) {
		kind = "delayed-page";
	} else if (/^(\w+\/)?password\.html\?\$S&\$U$/.test(s.blockURL)) {
		kind = "password-page";
	} else if (/^(\w+\/)?blocked\.html\?\$S&\$U$/.test(s.blockURL)) {
		kind = "default-page";
	} else {
		kind = "custom-url";
	}

	let delay = null;
	if (kind == "delayed-page") {
		delay = {
			delaySecs: s.delaySecs,
			delayFirst: s.delayFirst,
			delayFirstMode: s.delayFirstMode,
			delayAllowMins: s.delayAllowMins,
			delayAutoLoad: s.delayAutoLoad,
			delayCancel: s.delayCancel
		};
	}

	let password = null;
	if (kind == "password-page") {
		let configured = (s.passwordRequire == "1") ? Boolean(g.orp)
				: (s.passwordRequire == "2") ? Boolean(g.password)
				: Boolean(s.passwordSetSpec);
		password = {
			requireMode: s.passwordRequire,
			configured: configured,
			delayFirst: s.delayFirst,
			delayFirstMode: s.delayFirstMode,
			delayAllowMins: s.delayAllowMins
		};
	}

	let filter = null;
	if (kind == "filter") {
		filter = { name: s.filterName, mute: s.filterMute, custom: s.filterCustom };
	}

	// Imprecise flags
	let imprecise = [];
	let overrideKeys = [];
	if (s.regexpBlock !== "" && counts.sites > 0) overrideKeys.push("regexpBlock");
	if (s.regexpAllow !== "" && counts.exceptions > 0) overrideKeys.push("regexpAllow");
	if (s.regexpKeyword !== "" && counts.keywords > 0) overrideKeys.push("regexpKeyword");
	if (overrideKeys.length > 0) {
		imprecise.push({ code: "regexp-overrides-sites", keys: overrideKeys.concat("sites") });
	}
	if (s.sitesURL !== "") {
		imprecise.push({ code: "external-sites-url", keys: ["sitesURL"] });
	}
	if (s.regexpKeyword !== "" || regexps.keyword !== "") {
		let keys = [];
		if (regexps.keyword !== "") keys.push("sites");
		if (s.regexpKeyword !== "") keys.push("regexpKeyword");
		keys.push("allowKeywords", "titleOnly");
		imprecise.push({ code: "keywords-depend-on-content", keys: keys });
	}
	if (regexps.refer !== "") {
		imprecise.push({ code: "referrers-depend-on-navigation", keys: ["sites", "allowRefers"] });
	}
	if (s.incogMode !== "0") {
		imprecise.push({ code: "incognito-scope", keys: ["incogMode"], value: s.incogMode });
	}
	if (s.activeTabMode !== "0") {
		imprecise.push({ code: "active-tab-scope", keys: ["activeTabMode"], value: s.activeTabMode });
	}
	if (s.waitSecs !== "") {
		imprecise.push({ code: "wait-before-check", keys: ["waitSecs"], value: s.waitSecs });
	}
	if (g.clockOffset !== "") {
		imprecise.push({ code: "clock-offset-active", keys: ["clockOffset"], value: g.clockOffset });
	}
	if ((s.prevExts || s.prevSettings) && !hasLine558Gate) {
		let keys = [];
		if (s.prevExts) keys.push("prevExts");
		if (s.prevSettings) keys.push("prevSettings");
		imprecise.push({ code: "prev-internal-needs-target", keys: keys });
	}

	// Active advanced settings (non-default values only)
	let activeAdvanced = [];
	let addSet = (key) => {
		if (s[key] !== PER_SET_OPTIONS[key].def) {
			activeAdvanced.push({ key: key, scope: "set", value: s[key] });
		}
	};
	for (let key of ["limitOffset", "rollover", "incogMode", "activeTabMode", "activeBlock",
			"minBlock", "countFocus", "countAllowed", "countAudio", "titleOnly", "reloadSecs",
			"addHistory", "prevOverride", "allowRefers", "allowKeywords", "waitSecs",
			"regexpAllow", "regexpKeyword", "ignoreHash"]) {
		addSet(key);
	}
	if (kind == "delayed-page") {
		addSet("delayAutoLoad");
		addSet("delayCancel");
	}
	if (kind == "delayed-page" || kind == "password-page") {
		addSet("delayFirst");
		addSet("delayFirstMode");
		addSet("delayAllowMins");
	}
	if (s.allowOverride === true && s.allowOverLock === false) {
		addSet("allowOverLock");
	}
	for (let key of ["matchSubdomains", "clockOffset", "allFocused", "useDocFocus", "allowLBWebsite"]) {
		if (g[key] !== GENERAL_OPTIONS[key].def) {
			activeAdvanced.push({ key: key, scope: "general", value: g[key] });
		}
	}

	return {
		setName: s.setName,
		disabled: disabled,
		status: status,
		neverBlocks: neverBlocks,
		neverBlocksReasons: neverBlocksReasons,
		target: {
			mode: mode,
			cleanedSites: cleanedSites,
			counts: counts,
			hasMatchableTarget: hasMatchableTarget,
			matchSubdomains: g.matchSubdomains,
			sitesURL: s.sitesURL,
			regexpBlock: s.regexpBlock,
			regexpAllow: s.regexpAllow,
			regexpKeyword: s.regexpKeyword,
			allowRefers: s.allowRefers,
			allowKeywords: s.allowKeywords,
			ignoreHash: s.ignoreHash
		},
		schedule: {
			canTriggerOrdinarily: canTriggerOrdinarily,
			lockdownPossible: lockdownPossible,
			days: s.days,
			hasDays: hasDays,
			cleanedTimes: cleanedTimes,
			timePeriods: timePeriods,
			allDay: (cleanedTimes === ALL_DAY_TIMES),
			hasTimes: hasTimes,
			limit: {
				configured: limitConfigured,
				limitMins: s.limitMins,
				limitPeriod: s.limitPeriod,
				limitOffset: s.limitOffset,
				rollover: s.rollover
			},
			conjMode: s.conjMode,
			incompleteReasons: incompleteReasons
		},
		action: {
			kind: kind,
			blockURL: s.blockURL,
			customMsgPresent: (s.customMsg !== ""),
			activeBlock: s.activeBlock,
			alreadyOpenTabsNote: (!disabled && !s.activeBlock),
			delay: delay,
			password: password,
			filter: filter,
			minBlock: s.minBlock,
			reloadSecs: s.reloadSecs
		},
		exit: {
			allowOverride: s.allowOverride,
			allowOverLock: s.allowOverLock,
			overrideDurationMins: g.orm,
			overrideLimitNum: g.orln,
			overrideLimitPeriod: g.orlp,
			overrideAccess: g.ora
		},
		protections: {
			prevOpts: s.prevOpts,
			prevGenOpts: s.prevGenOpts,
			prevExts: s.prevExts,
			prevSettings: s.prevSettings,
			prevOverride: s.prevOverride
		},
		imprecise: imprecise,
		activeAdvanced: activeAdvanced,
		cosmetic: {
			sortSites: s.sortSites,
			showKeyword: s.showKeyword,
			showTimer: s.showTimer
		},
		classifiedKeys: {
			perSet: PER_SET_SUMMARY_ROLES,
			general: ["orm", "orln", "orlp", "ora", "matchSubdomains", "clockOffset",
					"allFocused", "useDocFocus", "password", "orp", "allowLBWebsite"]
		}
	};
}
