import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const BASE_COMMIT = "e88ef65427ade4f7b14703325500c0ede975ca1b";
const JQUERY_UI_SRC = path.join(REPO_ROOT, "jquery-ui");

const LANGUAGES = [
	{
		uiLang: "de",
		expectedHtmlLang: "en",
		expectedBlockedTitle: "Site Blocked",
		expectedWarning: "The page you're trying to access has been blocked by LeechBlock.",
		expectedPasswordPrompt: "Enter the password to access the blocked page:",
		expectedPopupOptions: "Options",
		expectedResetRolloverHasBr: false,
		expectedCountdownRegex: /^The page will be unblocked in \d+ second\(s\)\.$/,
		expectedCommandOptions: "Open the options page",
	},
	{
		uiLang: "it-CH",
		expectedHtmlLang: "it",
		expectedBlockedTitle: "Sito bloccato",
		expectedWarning: "La pagina a cui stai tentando di accedere è stata bloccata da LeechBlock.",
		expectedPasswordPrompt: "Inserisci la password per accedere alla pagina bloccata:",
		expectedPopupOptions: "Opzioni",
		expectedResetRolloverHasBr: true,
		expectedCountdownRegex: /^La pagina verrà sbloccata tra \d+ secondi\.$/,
		expectedCommandOptions: "Apri la pagina delle opzioni",
	},
	{
		uiLang: "it",
		expectedHtmlLang: "it",
		expectedBlockedTitle: "Sito bloccato",
		expectedWarning: "La pagina a cui stai tentando di accedere è stata bloccata da LeechBlock.",
		expectedPasswordPrompt: "Inserisci la password per accedere alla pagina bloccata:",
		expectedPopupOptions: "Opzioni",
		expectedResetRolloverHasBr: true,
		expectedCountdownRegex: /^La pagina verrà sbloccata tra \d+ secondi\.$/,
		expectedCommandOptions: "Apri la pagina delle opzioni",
	},
	{
		uiLang: "en",
		expectedHtmlLang: "en",
		expectedBlockedTitle: "Site Blocked",
		expectedWarning: "The page you're trying to access has been blocked by LeechBlock.",
		expectedPasswordPrompt: "Enter the password to access the blocked page:",
		expectedPopupOptions: "Options",
		expectedResetRolloverHasBr: false,
		expectedCountdownRegex: /^The page will be unblocked in \d+ second\(s\)\.$/,
		expectedCommandOptions: "Open the options page",
	},
];

let failedCount = 0;

function recordResult(lang, checkName, passed, detail = "") {
	const status = passed ? "PASS" : "FAIL";
	if (!passed) {
		failedCount++;
	}
	const suffix = detail ? ` — ${detail}` : "";
	console.log(`${status} [${lang}] ${checkName}${suffix}`);
}

function startLocalServer() {
	return new Promise((resolve, reject) => {
		const server = http.createServer((req, res) => {
			res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
			res.end("<!doctype html><html><head><title>Local Target</title></head><body>Local test page</body></html>");
		});
		server.on("error", reject);
		server.listen(0, () => {
			const addr = server.address();
			resolve({ server, port: addr.port });
		});
	});
}

function emptyDirSync(dirPath) {
	fs.mkdirSync(dirPath, { recursive: true });
	for (const entry of fs.readdirSync(dirPath)) {
		fs.rmSync(path.join(dirPath, entry), { recursive: true, force: true });
	}
}

function extractGitTree(ref, targetDir) {
	emptyDirSync(targetDir);
	const tarPath = path.join(os.tmpdir(), `lbng-${Date.now()}-${Math.random().toString(16).slice(2)}.tar`);
	try {
		execFileSync("git", ["archive", "--format=tar", "-o", tarPath, ref], {
			cwd: REPO_ROOT,
			stdio: "pipe",
		});
		// On Windows use the system bsdtar: a GNU tar found first on PATH (e.g. Git Bash)
		// treats "C:\..." as a remote host and fails.
		const tarBin = process.platform === "win32"
			? path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe")
			: "tar";
		execFileSync(tarBin, ["-xf", tarPath, "-C", targetDir], {
			stdio: "pipe",
		});
	} finally {
		fs.rmSync(tarPath, { force: true });
	}
	fs.cpSync(JQUERY_UI_SRC, path.join(targetDir, "jquery-ui"), { recursive: true });
}

async function launchWithExtension(userDataDir, extDir, uiLang) {
	const context = await chromium.launchPersistentContext(userDataDir, {
		channel: "chromium",
		headless: true,
		args: [
			`--disable-extensions-except=${extDir}`,
			`--load-extension=${extDir}`,
			`--lang=${uiLang}`,
			`--accept-lang=${uiLang}`,
		],
	});
	return context;
}

async function getServiceWorker(context) {
	let [sw] = context.serviceWorkers();
	if (!sw) {
		sw = await context.waitForEvent("serviceworker", { timeout: 15000 });
	}
	return sw;
}

async function waitForOptionsLoaded(sw, timeoutMs = 10000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const loaded = await sw.evaluate(() => Boolean(typeof gGotOptions !== "undefined" && gGotOptions));
		if (loaded) {
			return;
		}
		await new Promise((r) => setTimeout(r, 100));
	}
	throw new Error("Timed out waiting for service worker gGotOptions === true");
}

async function waitForRedirect(page, targetUrl, predicate, timeoutMs = 15000) {
	try {
		await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
	} catch (err) {
		// Chromium may abort the initial navigation when the extension redirects the tab immediately.
		const msg = String(err?.message || err);
		if (!/ERR_ABORTED|interrupted by another navigation/i.test(msg)) {
			// Still check if the redirect already happened.
			if (!predicate(page.url())) {
				throw err;
			}
		}
	}
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const currentUrl = page.url();
		if (predicate(currentUrl)) {
			await page.waitForLoadState("domcontentloaded").catch(() => {});
			return currentUrl;
		}
		await page.waitForTimeout(150);
	}
	return page.url();
}

function attachErrorCollectors(page, extId, errors) {
	const extOrigin = `chrome-extension://${extId}`;
	page.on("pageerror", (err) => {
		if (page.url().startsWith(extOrigin)) {
			errors.push(`pageerror (${page.url()}): ${err.message}`);
		}
	});
	page.on("console", (msg) => {
		if (msg.type() === "error" && page.url().startsWith(extOrigin)) {
			errors.push(`console.error (${page.url()}): ${msg.text()}`);
		}
	});
}

async function dismissVisibleJQueryDialog(page, dialogSelector, timeoutMs = 10000) {
	const dialog = page.locator(dialogSelector);
	await dialog.waitFor({ state: "visible", timeout: timeoutMs });
	const okButton = page.locator(".ui-dialog:visible .ui-dialog-buttonpane button").first();
	await okButton.click();
	await dialog.waitFor({ state: "hidden", timeout: timeoutMs });
}

async function runLanguageScenario(config, port) {
	const {
		uiLang,
		expectedHtmlLang,
		expectedBlockedTitle,
		expectedWarning,
		expectedPasswordPrompt,
		expectedPopupOptions,
		expectedResetRolloverHasBr,
		expectedCountdownRegex,
		expectedCommandOptions,
	} = config;
	const workDir = fs.mkdtempSync(path.join(os.tmpdir(), `lbng-e2e-${uiLang}-`));
	const userDataDir = path.join(workDir, "profile");
	const extDir = path.join(workDir, "ext");
	const importFilePath = path.join(workDir, "legacy-import.txt");
	const extensionErrors = [];

	fs.mkdirSync(userDataDir, { recursive: true });
	fs.mkdirSync(extDir, { recursive: true });

	let context = null;
	let italianPopupLabels = null;
	try {
		// Step 1: Extract base e88ef65 into D, copy jquery-ui, launch Chromium
		extractGitTree(BASE_COMMIT, extDir);
		context = await launchWithExtension(userDataDir, extDir, uiLang);
		let sw = await getServiceWorker(context);
		const extId = new URL(sw.url()).host;
		recordResult(uiLang, "base-load", Boolean(extId), `extId=${extId}`);

		if (expectedHtmlLang === "it") {
			const basePopup = await context.newPage();
			await basePopup.goto(`chrome-extension://${extId}/it/popup.html`);
			italianPopupLabels = await basePopup.evaluate(() => Object.fromEntries(
				Array.from(document.querySelectorAll("#button-container button"), (button) => [
					button.id, button.innerText.replace(/\s+/g, " ").trim(),
				])
			));
			recordResult(uiLang, "base-italian-popup-labels", Object.keys(italianPopupLabels).length === 9);
			await basePopup.close();
		}

		// Step 2: Seed settings in chrome.storage.local exactly as the base stores them
		await sw.evaluate(async () => {
			const allDays = [true, true, true, true, true, true, true];
			const re1 = getRegExpSites("127.0.0.1*/blocked", false);
			const re2 = getRegExpSites("localhost", false);
			const re3 = getRegExpSites("127.0.0.1*/delayed", false);
			const seeded = {
				numSets: "6",
				sync: false,
				autoExportSync: false,
				sites1: "127.0.0.1*/blocked",
				blockRE1: re1.block,
				allowRE1: re1.allow,
				referRE1: re1.refer,
				keywordRE1: re1.keyword,
				times1: "0000-2400",
				days1: allDays,
				conjMode1: false,
				disable1: false,
				blockURL1: "it/blocked.html?$S&$U",
				sites2: "localhost",
				blockRE2: re2.block,
				allowRE2: re2.allow,
				referRE2: re2.refer,
				keywordRE2: re2.keyword,
				times2: "0000-2400",
				days2: allDays,
				conjMode2: false,
				disable2: false,
				blockURL2: "it/password.html?$S&$U",
				passwordRequire2: "0",
				passwordSetSpec2: "secret123",
				sites3: "127.0.0.1*/delayed",
				blockRE3: re3.block,
				allowRE3: re3.allow,
				referRE3: re3.refer,
				keywordRE3: re3.keyword,
				times3: "0000-2400",
				days3: allDays,
				conjMode3: false,
				disable3: false,
				blockURL3: "it/delayed.html?$S&$U",
				delaySecs3: "10",
				delayCancel3: false,
			};
			await chrome.storage.local.set(seeded);
		});

		// Restart browser so the base picks up the seeded settings cleanly
		await context.close();
		context = await launchWithExtension(userDataDir, extDir, uiLang);
		sw = await getServiceWorker(context);
		const baseRestartId = new URL(sw.url()).host;
		await waitForOptionsLoaded(sw);

		const basePage = await context.newPage();
		const targetBaseUrl = `http://127.0.0.1:${port}/blocked`;
		await basePage.goto(targetBaseUrl, { waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});
		// Check via chrome.tabs.query() because on non-en base locales, e88ef65 prepends localePath
		// to "it/blocked.html?$S&$U" (e.g. "/de/it/blocked.html?..."), which 404s to chrome-error:// in page.url()
		// while chrome.tabs reports the actual extension redirect URL.
		let baseRedirectUrl = "";
		const baseDeadline = Date.now() + 10000;
		while (Date.now() < baseDeadline) {
			const tabUrls = await sw.evaluate(async () => (await chrome.tabs.query({})).map((t) => t.url || ""));
			const match = tabUrls.find(
				(u) => u.startsWith(`chrome-extension://${extId}/`) && u.includes("it/blocked.html?")
			);
			if (match) {
				baseRedirectUrl = match;
				break;
			}
			await basePage.waitForTimeout(150);
		}
		const baseRedirectOk =
			baseRestartId === extId &&
			baseRedirectUrl.startsWith(`chrome-extension://${extId}/`) &&
			baseRedirectUrl.includes("it/blocked.html?");
		recordResult(uiLang, "base-seed-sanity", baseRedirectOk, `url=${baseRedirectUrl || basePage.url()}`);

		// Step 3: Close browser, replace D contents with HEAD + jquery-ui (same D & profile)
		await context.close();
		context = null;
		extractGitTree("HEAD", extDir);
		// Clear Chromium's unpacked Service Worker script cache so updated importScripts("common.js")
		// is loaded on relaunch (extension storage and ID in the profile remain untouched).
		// background.js is byte-identical to the base, and with an unpacked extension even a
		// manifest version bump keeps the stale cached common.js (observed 2026-11-27). Whether a
		// real Web Store (.crx) update re-registers the worker is not covered here; check it manually.
		fs.rmSync(path.join(userDataDir, "Default", "Service Worker"), { recursive: true, force: true });

		// Step 4: Relaunch without opening Options, verify upgraded blocking & i18n
		context = await launchWithExtension(userDataDir, extDir, uiLang);
		sw = await getServiceWorker(context);
		const upgradedId = new URL(sw.url()).host;
		recordResult(uiLang, "upgrade-keeps-id", upgradedId === extId, `extId=${upgradedId}`);
		await waitForOptionsLoaded(sw);

		// 4.0 Verify effective Chromium UI language and localized command description
		const effectiveUiLang = await sw.evaluate(() => chrome.i18n.getUILanguage());
		const expectedUiLangPrefix = uiLang.split("-")[0].toLowerCase();
		const uiLangOk =
			typeof effectiveUiLang === "string" &&
			effectiveUiLang.toLowerCase().startsWith(expectedUiLangPrefix);
		recordResult(
			uiLang,
			"upgrade-ui-language",
			uiLangOk,
			`getUILanguage()="${effectiveUiLang}" (expected prefix "${expectedUiLangPrefix}")`
		);

		const commands = await sw.evaluate(() => chrome.commands.getAll());
		const optionsCmd = Array.isArray(commands) ? commands.find((c) => c.name === "lb-options") : null;
		recordResult(
			uiLang,
			"upgrade-command-i18n",
			optionsCmd?.description === expectedCommandOptions,
			`lb-options="${optionsCmd?.description || ""}" (expected "${expectedCommandOptions}")`
		);

		// 4.1 Verify popup URL from chrome.action.getPopup({}) and popup.html localization / Italian line breaks
		const rawPopupUrl = await sw.evaluate(() => chrome.action.getPopup({}));
		let resolvedPopupUrl = null;
		try {
			resolvedPopupUrl = new URL(rawPopupUrl, `chrome-extension://${extId}/`);
		} catch {
			resolvedPopupUrl = null;
		}
		const popupUrlOk = Boolean(
			resolvedPopupUrl &&
				resolvedPopupUrl.protocol === "chrome-extension:" &&
				resolvedPopupUrl.host === extId &&
				resolvedPopupUrl.pathname === "/popup.html"
		);
		recordResult(
			uiLang,
			"upgrade-popup-url",
			popupUrlOk,
			`getPopup()="${rawPopupUrl}", resolved=${resolvedPopupUrl ? resolvedPopupUrl.href : "invalid"}`
		);

		const popupPage = await context.newPage();
		attachErrorCollectors(popupPage, extId, extensionErrors);
		await popupPage.goto(resolvedPopupUrl ? resolvedPopupUrl.href : `chrome-extension://${extId}/popup.html`, {
			waitUntil: "domcontentloaded",
		});
		await popupPage.waitForSelector("#options", { timeout: 10000 });
		const popupInfo = await popupPage.evaluate(() => ({
			htmlLang: document.documentElement.lang,
			labels: Object.fromEntries(
				Array.from(document.querySelectorAll("#button-container button"), (button) => [
					button.id, button.innerText.replace(/\s+/g, " ").trim(),
				])
			),
			optionsText: document.querySelector("#options")?.textContent?.trim() || "",
			resetRolloverHasBr: document.querySelector("#resetRollover br") !== null,
			discardTimeHasBr: document.querySelector("#discardTime br") !== null,
		}));
		const popupOk =
			popupUrlOk &&
			popupInfo.htmlLang === expectedHtmlLang &&
			popupInfo.optionsText === expectedPopupOptions &&
			popupInfo.resetRolloverHasBr === expectedResetRolloverHasBr &&
			popupInfo.discardTimeHasBr === expectedResetRolloverHasBr;
		recordResult(
			uiLang,
			"upgrade-popup-i18n",
			popupOk,
			`lang=${popupInfo.htmlLang}, #options="${popupInfo.optionsText}", #resetRollover<br>=${popupInfo.resetRolloverHasBr}, #discardTime<br>=${popupInfo.discardTimeHasBr}`
		);
		await popupPage.close();

		if (italianPopupLabels) {
			const mismatches = Object.keys(italianPopupLabels).filter(
				(id) => popupInfo.labels[id] !== italianPopupLabels[id]
			);
			recordResult(
				uiLang,
				"upgrade-all-italian-popup-labels",
				Object.keys(italianPopupLabels).length === 9
					&& Object.keys(popupInfo.labels).length === 9
					&& mismatches.length === 0,
				`mismatched buttons: ${mismatches.join(", ") || "none"}`
			);
		}

		// 4a. Visit 127.0.0.1/blocked -> expect chrome-extension://<id>/blocked.html?...
		const blockedPage = await context.newPage();
		attachErrorCollectors(blockedPage, extId, extensionErrors);
		const blockedUrl = await waitForRedirect(
			blockedPage,
			`http://127.0.0.1:${port}/blocked`,
			(u) => {
				try {
					const parsed = new URL(u);
					return parsed.protocol === "chrome-extension:" && parsed.host === extId && parsed.pathname === "/blocked.html";
				} catch {
					return false;
				}
			}
		);
		await blockedPage.waitForSelector("#lbWarningMsgDiv h1", { timeout: 10000 });
		await blockedPage.waitForFunction(() => /\(.+\)$/.test(document.title), { timeout: 10000 });
		const blockedInfo = await blockedPage.evaluate(() => ({
			url: location.href,
			pathname: location.pathname,
			htmlLang: document.documentElement.lang,
			title: document.title,
			blockedSetText: document.getElementById("lbBlockedSet")?.innerText?.trim() || "",
			warningText: document.querySelector("#lbWarningMsgDiv h1")?.textContent?.trim() || "",
		}));
		const blockedUrlOk =
			blockedUrl.startsWith(`chrome-extension://${extId}/blocked.html?`) &&
			blockedInfo.pathname === "/blocked.html";
		const expectedTitleWithSuffix = `${expectedBlockedTitle} (${blockedInfo.blockedSetText})`;
		const blockedTitleOk =
			blockedInfo.blockedSetText.length > 0 &&
			blockedInfo.title === expectedTitleWithSuffix;
		recordResult(uiLang, "upgrade-blocked-url", blockedUrlOk, `url=${blockedInfo.url}`);
		recordResult(
			uiLang,
			"upgrade-blocked-i18n",
			blockedInfo.htmlLang === expectedHtmlLang &&
				blockedInfo.warningText === expectedWarning &&
				blockedTitleOk,
			`lang=${blockedInfo.htmlLang} (expected ${expectedHtmlLang}), title="${blockedInfo.title}", heading="${blockedInfo.warningText}"`
		);
		await blockedPage.close();

		// 4a-delayed. Visit 127.0.0.1/delayed -> real redirect to chrome-extension://<id>/delayed.html?... and live countdown
		const delayedPage = await context.newPage();
		attachErrorCollectors(delayedPage, extId, extensionErrors);
		const delayedUrl = await waitForRedirect(
			delayedPage,
			`http://127.0.0.1:${port}/delayed`,
			(u) => {
				try {
					const parsed = new URL(u);
					return parsed.protocol === "chrome-extension:" && parsed.host === extId && parsed.pathname === "/delayed.html";
				} catch {
					return false;
				}
			}
		);
		await delayedPage.waitForSelector("#lbCountdownText", { timeout: 10000 });
		await delayedPage.waitForFunction(
			() => {
				const el = document.querySelector("#lbCountdownText #lbDelaySeconds");
				return Boolean(el && Number.parseInt(el.textContent.trim(), 10) > 0);
			},
			{ timeout: 10000 }
		);
		const delayedInitial = await delayedPage.evaluate(() => {
			const countdown = document.getElementById("lbCountdownText");
			const delaySpan = countdown ? countdown.querySelector("#lbDelaySeconds") : null;
			return {
				url: location.href,
				pathname: location.pathname,
				htmlLang: document.documentElement.lang,
				hasDelaySpanInCountdown: Boolean(delaySpan),
				countdownText: countdown?.textContent?.trim() || "",
				initialSeconds: delaySpan ? Number.parseInt(delaySpan.textContent.trim(), 10) : NaN,
			};
		});
		const delayedUrlOk =
			delayedUrl.startsWith(`chrome-extension://${extId}/delayed.html?`) &&
			delayedInitial.pathname === "/delayed.html";
		recordResult(uiLang, "upgrade-delayed-url", delayedUrlOk, `url=${delayedInitial.url}`);

		let afterSeconds = delayedInitial.initialSeconds;
		try {
			await delayedPage.waitForFunction(
				(startVal) => {
					const el = document.querySelector("#lbCountdownText #lbDelaySeconds");
					if (!el) return false;
					const current = Number.parseInt(el.textContent.trim(), 10);
					return Number.isFinite(current) && current < startVal;
				},
				delayedInitial.initialSeconds,
				{ timeout: 5000 }
			);
			afterSeconds = await delayedPage.evaluate(() => {
				const el = document.querySelector("#lbCountdownText #lbDelaySeconds");
				return el ? Number.parseInt(el.textContent.trim(), 10) : NaN;
			});
		} catch {
			afterSeconds = await delayedPage.evaluate(() => {
				const el = document.querySelector("#lbCountdownText #lbDelaySeconds");
				return el ? Number.parseInt(el.textContent.trim(), 10) : NaN;
			});
		}

		const delayedI18nOk =
			delayedInitial.htmlLang === expectedHtmlLang &&
			delayedInitial.hasDelaySpanInCountdown &&
			expectedCountdownRegex.test(delayedInitial.countdownText);
		recordResult(
			uiLang,
			"upgrade-delayed-i18n",
			delayedI18nOk,
			`lang=${delayedInitial.htmlLang}, #lbDelaySeconds=${delayedInitial.hasDelaySpanInCountdown}, countdown="${delayedInitial.countdownText}"`
		);

		const delayedCountdownOk =
			Number.isFinite(delayedInitial.initialSeconds) &&
			delayedInitial.initialSeconds > 0 &&
			Number.isFinite(afterSeconds) &&
			afterSeconds < delayedInitial.initialSeconds;
		recordResult(
			uiLang,
			"upgrade-delayed-countdown",
			delayedCountdownOk,
			`initial=${delayedInitial.initialSeconds}s -> after=${afterSeconds}s`
		);
		await delayedPage.close();

		// 4b. Visit localhost -> expect chrome-extension://<id>/password.html?...
		const passwordPage = await context.newPage();
		attachErrorCollectors(passwordPage, extId, extensionErrors);
		const passwordUrl = await waitForRedirect(
			passwordPage,
			`http://localhost:${port}/`,
			(u) => {
				try {
					const parsed = new URL(u);
					return parsed.protocol === "chrome-extension:" && parsed.host === extId && parsed.pathname === "/password.html";
				} catch {
					return false;
				}
			}
		);
		await passwordPage.waitForSelector("#lbWarningMsgDiv h1", { timeout: 10000 });
		const passwordInfo = await passwordPage.evaluate(() => ({
			url: location.href,
			pathname: location.pathname,
			htmlLang: document.documentElement.lang,
			warningText: document.querySelector("#lbWarningMsgDiv h1")?.textContent?.trim() || "",
			promptText: document.querySelector("#lbPasswordForm p[data-i18n='passwordPrompt']")?.textContent?.trim() || "",
		}));
		const passwordUrlOk =
			passwordUrl.startsWith(`chrome-extension://${extId}/password.html?`) &&
			passwordInfo.pathname === "/password.html";
		recordResult(uiLang, "upgrade-password-url", passwordUrlOk, `url=${passwordInfo.url}`);
		recordResult(
			uiLang,
			"upgrade-password-i18n",
			passwordInfo.htmlLang === expectedHtmlLang &&
				passwordInfo.warningText === expectedWarning &&
				passwordInfo.promptText === expectedPasswordPrompt,
			`lang=${passwordInfo.htmlLang} (expected ${expectedHtmlLang}), heading="${passwordInfo.warningText}", prompt="${passwordInfo.promptText}"`
		);
		await passwordPage.close();

		// Step 5: Open Options page and verify normalized blockURL1, blockURL2, and #passwordPageOpts2 visibility
		const optionsPage = await context.newPage();
		attachErrorCollectors(optionsPage, extId, extensionErrors);
		optionsPage.on("dialog", async (dialog) => {
			await dialog.accept();
		});
		await optionsPage.goto(`chrome-extension://${extId}/options.html`, { waitUntil: "domcontentloaded" });
		await optionsPage.locator("#form").waitFor({ state: "visible", timeout: 10000 });

		const optBlockURL1 = await optionsPage.locator("#blockURL1").inputValue();
		await optionsPage.locator("#tabBlockSet2 a").click();
		const optBlockURL2 = await optionsPage.locator("#blockURL2").inputValue();
		const pwOpts2Visible = await optionsPage.locator("#passwordPageOpts2").isVisible();

		recordResult(
			uiLang,
			"options-normalized-fields",
			optBlockURL1 === "blocked.html?$S&$U" && optBlockURL2 === "password.html?$S&$U" && pwOpts2Visible,
			`blockURL1="${optBlockURL1}", blockURL2="${optBlockURL2}", #passwordPageOpts2 visible=${pwOpts2Visible}`
		);

		// Step 6a: Import from text file with legacy blockURL1=it/password.html?$S&$U
		const exportText = [
			"numSets=6",
			"sites1=127.0.0.1",
			"times1=0000-2400",
			"days1=127",
			"blockURL1=it/password.html?$S&$U",
			"",
		].join("\n");
		fs.writeFileSync(importFilePath, exportText, "utf8");

		await optionsPage.locator("#tabGeneral a").click();
		await optionsPage.locator("#importFile").setInputFiles(importFilePath);
		await optionsPage.locator("#importOptions").click();
		await dismissVisibleJQueryDialog(optionsPage, "#alertImportSuccess");

		await optionsPage.locator("#tabBlockSet1 a").click();
		const importedFileURL1 = await optionsPage.locator("#blockURL1").inputValue();
		const pwOpts1AfterFile = await optionsPage.locator("#passwordPageOpts1").isVisible();
		recordResult(
			uiLang,
			"options-import-file",
			importedFileURL1 === "password.html?$S&$U" && pwOpts1AfterFile,
			`blockURL1="${importedFileURL1}", #passwordPageOpts1 visible=${pwOpts1AfterFile}`
		);

		// Step 6b: Reset blockURL1 to default, seed chrome.storage.sync, trigger importOptionsSync
		await optionsPage.locator("#defaultPage1").click();
		const beforeSyncURL1 = await optionsPage.locator("#blockURL1").inputValue();
		if (beforeSyncURL1 !== "blocked.html?$S&$U") {
			throw new Error(`Expected defaultPage1 reset to blocked.html?$S&$U, got ${beforeSyncURL1}`);
		}

		await optionsPage.evaluate(async () => {
			await chrome.storage.sync.clear();
			await chrome.storage.sync.set({
				numSets: "6",
				sites1: "127.0.0.1",
				times1: "0000-2400",
				days1: [true, true, true, true, true, true, true],
				blockURL1: "it/password.html?$S&$U",
			});
		});

		await optionsPage.locator("#tabGeneral a").click();
		await optionsPage.locator("#importOptionsSync").click();
		await dismissVisibleJQueryDialog(optionsPage, "#alertImportSuccess");

		await optionsPage.locator("#tabBlockSet1 a").click();
		const importedSyncURL1 = await optionsPage.locator("#blockURL1").inputValue();
		const pwOpts1AfterSync = await optionsPage.locator("#passwordPageOpts1").isVisible();
		recordResult(
			uiLang,
			"options-import-sync",
			importedSyncURL1 === "password.html?$S&$U" && pwOpts1AfterSync,
			`blockURL1="${importedSyncURL1}", #passwordPageOpts1 visible=${pwOpts1AfterSync}`
		);
		await optionsPage.close();

		// Step 7: Assert zero page/console errors on extension pages
		recordResult(
			uiLang,
			"extension-no-errors",
			extensionErrors.length === 0,
			extensionErrors.length === 0 ? "0 errors" : extensionErrors.join(" | ")
		);
	} catch (err) {
		recordResult(uiLang, "scenario-exception", false, String(err?.stack || err));
	} finally {
		if (context) {
			await context.close().catch(() => {});
		}
		fs.rmSync(workDir, { recursive: true, force: true });
	}
}

async function main() {
	if (!fs.existsSync(JQUERY_UI_SRC)) {
		console.error(`Missing jquery-ui directory at ${JQUERY_UI_SRC}`);
		process.exit(1);
	}

	const { server, port } = await startLocalServer();
	try {
		for (const langConfig of LANGUAGES) {
			await runLanguageScenario(langConfig, port);
		}
	} finally {
		await new Promise((resolve) => server.close(resolve));
	}

	if (failedCount > 0) {
		console.error(`\nTotal failures: ${failedCount}`);
		process.exit(1);
	}
	console.log("\nAll E2E upgrade-locale checks passed.");
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
