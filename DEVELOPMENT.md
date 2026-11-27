# Development Setup

- **Upstream base**: `proginosko/LeechBlockNG-chrome` (`master`, v1.8)
- **Base commit**: `e88ef65427ade4f7b14703325500c0ede975ca1b`
- **jQuery UI**: `1.14.2` (bundled jQuery `3.7.1`), installed in `jquery-ui/` (ignored by Git via `.gitignore`)

## Load Unpacked in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select this directory

## Automated Checks

Run all inventory and pure-function checks with:

```sh
node --test tests/*.test.mjs
```

### End-to-end upgrade check

To verify real-browser extension upgrades from the upstream base (`e88ef65`) to `HEAD` across `de`, `it-CH`, `it`, and `en` UI locales (requires Playwright Chromium):

```sh
npm --prefix tests/e2e install
node tests/e2e/upgrade-locale.mjs
```

The Italian scenarios compare all nine popup button labels with the Italian popup
loaded from the base commit. The check reads rendered text, including normalized
line breaks, so a missing translation binding fails even when the catalog is valid.
The unpacked-extension test clears the service worker script cache between builds.
The first block after a packaged `.crx` update with that cache intact requires a manual check.

## Legacy localized block URLs

Saved or imported `blockURL<N>` values matching the exact legacy internal form `^\/?(?:\w+\/)?((?:blocked|delayed|password)\.html\?\$S&\$U)$` (for example `it/blocked.html?$S&$U`, `/pt_BR/password.html?$S&$U`, or `/delayed.html?$S&$U`) are normalized to `<page>.html?$S&$U` by `normalizeLegacyBlockURL()` in `common.js` (called from `getLocalizedURL()` at runtime and when loading or importing options in `options.js`).

Absolute `chrome-extension://<id>/<lang>/...` URLs and all other variants (extra query parameters, fragments, different casing, nested path segments, or other filenames) are left byte-identical by the normalization helper and remain unsupported. Relative variants still pass through `getLocalizedURL()`, which prefixes the root locale path `/`.

Updating `common.js:getLocalizedURL()` with this helper is the authorized surgical exception to the frozen blocking engine.

