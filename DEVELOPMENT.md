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

