# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Easy OTP is an unsigned, macOS-only Electron menu bar app that stores TOTP accounts encrypted on disk and copies the current 6-digit code to the clipboard when an account is clicked. Published as `@iambrian/easy-otp`, released as a `.dmg` on GitHub.

The repo also contains `web/`, a separate static marketing/docs site built with Skrapa. It has its own `package.json`, lockfile, `node_modules`, and `tsconfig.json`. Treat it as an independent project (see the end of this file).

## Commands (root Electron app)

Requires macOS and Node 22+. There are no tests and no linter; `tsc` (strict, `noUncheckedIndexedAccess`) is the only static check.

```sh
npm run init         # one-time setup: install deps, remove quarantine, sign Electron binary
npm install
npm start            # wipe dist/, copy assets, tsc, copy src/*.html, launch Electron
npm run dev          # watch src/ and re-run `npm start` on every change, plus web/'s Skrapa dev server
npm run demo         # like `npm run dev`, but loads accounts from scripts/demo-data.txt instead of the real store
npm run pack         # build an unpacked .app into dist/ (fastest for testing the packaged app)
npm run build        # build the distributable .dmg into dist/
npm run make-icons   # regenerate build/icon.icns from assets/icon.svg (needs macOS `iconutil` + sharp)
npm run release      # npm version patch && git push --follow-tags  -> triggers the GitHub Release workflow
npx tsc --noEmit     # type-check only
```

- `build/` is gitignored, so on a fresh clone `npm run pack` / `npm run build` fail until `npm run make-icons` has produced `build/icon.icns`. CI does this step before building.
- `tsx` and `skrapa` are not in `devDependencies`; `npx` fetches them on demand.
- `dist/` is both the `tsc` output directory and the electron-builder output directory, and every `npm start` deletes it.
- `npm run dev` spawns `npm start` in a detached process group and kills the whole group (npm + shell + Electron) on change or Ctrl+C. This matters because the app holds a single-instance lock: an orphaned Electron process makes the next launch silently quit.
- `npm run dev` also runs `npx --yes skrapa dev` inside `web/` (Skrapa's live-reload server, on the port set in `web/skrapa.config.ts`) in its own detached group. It is started once, not restarted on `src/` changes, and killed with the app on Ctrl+C. It must not go through `npm run dev` in `web/`: when `web/` has no `package.json`, npm resolves to the root package, re-runs `scripts/dev.ts`, and loops forever. It needs Node 24+; if it fails, the Electron side keeps running.

### macOS Gatekeeper (unsigned Electron development)

On macOS, Gatekeeper may block unsigned Electron binaries with "Malware Blocked and Moved to Trash". Since this app is intentionally unsigned, use this setup on fresh clones or after Electron is moved to trash:

```sh
cd /Users/brianreed/Projects/easy-otp
rm -rf node_modules/electron
npm install
xattr -dr com.apple.quarantine node_modules/electron/dist/Electron.app
codesign -s - node_modules/electron/dist/Electron.app
npm start
```

This removes the quarantine attribute and adds an ad-hoc signature so Gatekeeper allows the binary to run. If issues persist, check System Settings → Privacy & Security → App Management for any Electron notifications and allow it there. `npm run init` (`scripts/init.sh`) automates this.

## Architecture

### Process layout

Everything in the main process lives in `src/app.ts`: tray, in-memory `accounts` state, storage, IPC handlers, and both windows. There are two renderers, each with its own preload and its own `contextBridge` namespace:

| Renderer | Preload | Exposed as | IPC channels |
| --- | --- | --- | --- |
| `src/menu.html` (tray popover) | `src/preload-menu.ts` | `window.menu` | `menu:items`, `menu:ready`, `menu:invoke`, `menu:close`, `menu:refresh`, `menu:copied` |
| `src/settings.html` (settings window) | `src/preload.ts` | `window.api` | `get-accounts`, `save-accounts`, `fetch-favicon`, `guess-favicon-domain`, `show-emoji-panel`, `account-icon-found` |

Both renderers run with `contextIsolation: true` and `nodeIntegration: false`. The HTML files are **copied verbatim** into `dist/` by the npm scripts, not compiled — but their `<script>` tags load `./menu.mjs` / `./settings.mjs`, which *are* compiled: `src/menu.mts` and `src/settings.mts` are ES modules that `tsc` emits as `.mjs`, and both import `src/shared.mts` (-> `shared.mjs`) for renderer-only helpers (currently just `esc()`). The main process (`src/app.ts`, `src/favicon.ts`, `src/otp.ts`, both preloads) is separate `.ts` emitted as CommonJS (`package.json` has no top-level `"type": "module"`); it cannot statically import ESM `.mjs` files, renderer or shared, which is why a couple of small helpers that main also needs (`parseOtpUrl`, `isImageIcon`, `sameAccount`) are duplicated in `app.ts` instead.

### The tray menu is a custom window, not a native `Menu`

The popover is a frameless `type: 'panel'` `BrowserWindow` with `vibrancy: 'menu'` that mimics macOS menu metrics. This was a deliberate replacement for `Tray.setContextMenu`: a native `NSMenu` can't render icons greyed-out-until-hovered or change row spacing. The cost is a lot of subtle macOS focus and Spaces handling, all documented in comments in `app.ts` and `menu.mts`. Read those comments before touching any of it. The invariants:

- **Open flow:** tray click -> `showMenu()` -> main sends `menu:refresh` (with the payload attached, since main already computed it) -> renderer renders, **measures synchronously**, sends `menu:ready(size)` -> main positions under the tray icon (clamped to the display's work area) and shows. The renderer must not wait for `requestAnimationFrame`: a hidden window paints no frames, so the callback would never fire and the menu would open exactly once. `backgroundThrottling: false` exists for the same reason. `menu:items` (a separate invoke/reply) still exists only for the renderer's own first-load bootstrap, made before any refresh has been sent.
- **Never call `app.focus({ steal: true })` when showing the popover.** Activating the app drags the user off a full-screen Space, and the resulting focus churn blurs and hides the popover. The panel takes key focus on its own.
- **Dismissal is blur-driven** with a 150 ms grace period for transient blur, plus a 250 ms guard so a tray click that dismissed the menu doesn't immediately reopen it. `toggleMenu()` checks the window's actual visibility first, not just that timestamp, so a normal-speed click reliably closes an open menu instead of racing the deferred blur-hide.
- **Copy flow:** `menu:invoke('account:<issuer>:<account>')` -> main runs `pbcopy` -> sends `menu:copied` -> renderer replaces the whole menu with a large confirmation and re-reports its size. The popover stays open until blur. Row ids encode identity (issuer + account), not array index, so a click still resolves to the right account if Settings has changed the list in between.

### Account data model and storage

```ts
type Account = {
    account: string;
    secret: string;
    issuer: string;
    icon?: string;   // emoji, or a data:image/png;base64,... favicon
    url?: string;    // preferred favicon-lookup source, when set
    hidden?: boolean; // kept out of the tray dropdown without removing it from Settings
    iconCheckedAt?: number; // main-only: last empty favicon lookup, for backfillIcons' retry TTL
};
```

- **Identity is `issuer + account`.** Imports and adds dedupe/merge on that pair; `backfillIcons` re-finds accounts by it because the settings window may replace the array mid-fetch. Editing an existing account's issuer/account through Settings is blocked from colliding with another account's identity, since two rows sharing one identity would make popover clicks, backfill and icon lookups all resolve to whichever comes first.
- `icon` is either a short emoji string or a `data:image/png;base64,...` 32x32 favicon. `isImageIcon()` tells the two apart; it's duplicated in `app.ts` and `settings.mts` (the popover renderer, `menu.mts`, never receives a raw `icon` string — main pre-splits it into `icon`/`emoji` fields on each row).
- The settings renderer owns the full array and pushes it back wholesale via `save-accounts`; main replaces its state and re-renders an open popover. There is no per-field patch API. Because of that, main pushes any icon it finds via its own launch-time `backfillIcons()` back to an *open* Settings window over a separate `account-icon-found` channel — otherwise the next unrelated save from Settings (its copy predates the backfill) would overwrite that icon on disk.
- Persisted at `<userData>/accounts.enc`, encrypted with Electron `safeStorage`, written via a temp-file-then-rename so a crash mid-write can't corrupt it. A file that fails to decrypt is **deleted** on read. `<userData>/icons-reset` is a one-shot migration marker that strips previously fetched favicons (not emoji) so they are re-fetched from the current icon service.
- `issuer` and `account` are `decodeURIComponent`-ed on read, so `%40` from an `otpauth://` label becomes `@`.
- **Demo mode:** when `EASY_OTP_DEMO_FILE` is set (`npm run demo`), `app.ts` redirects `app.getPath('userData')` to a throwaway directory *before* `DATA_PATH` or `requestSingleInstanceLock()` are computed, then loads accounts by parsing one `otpauth://` URL per line from that file instead of calling `readData()`. This guarantees a demo run can never read or overwrite the real `accounts.enc`/Keychain-backed store, and gets its own single-instance lock so it can run alongside the real app.

### Favicons (`src/favicon.ts`)

Every icon is fetched from an icon service on purpose: DuckDuckGo's (`icons.duckduckgo.com/ip3/<domain>.ico`) for every candidate domain first, then Google's (`google.com/s2/favicons?domain=<domain>&sz=64`) only if DuckDuckGo had nothing for any of them. Google covers sites that publish only an SVG icon (render.com), which DuckDuckGo doesn't rasterise. Fetching issuers' sites directly was abandoned: bot-protected sites return 403 and the rest return inconsistent sizes/formats. The privacy tradeoff (DuckDuckGo sees which issuers are looked up, Google sees the ones DuckDuckGo missed) is documented in the file header and on the website's Privacy section. Other points:

- An issuer (or `url`) that already looks like a domain is used as-is, with no `.com` guesses: guessing turned `render.com` into the unrelated `rendercom.com`.

- `issuerToDomains()` turns a free-text issuer into candidate domains ("T-Mobile ID" -> `t-mobileid.com`, `t-mobile.com`), stripping auth-ish words and trying `.com` variants. An explicit `url` on the account is preferred over the issuer.
- Electron's `nativeImage` can't decode `.ico`, so the file contains a hand-written ICO directory parser and BITMAPINFOHEADER DIB decoder (1/4/8/24/32-bit, AND mask, premultiplied BGRA). Results are normalised to 32x32 PNG data URLs.
- Lookups are cached in memory per domain. A hit is kept for the process lifetime; a miss expires after a short TTL rather than being permanent, since a miss is indistinguishable here from a transient network failure and a bad moment at launch shouldn't poison a domain until restart.
- On every launch, `backfillIcons()` fills accounts with no icon using 4 concurrent workers and writes after each hit. This is a separate, longer-lived miss marker than the in-memory cache above: a miss sets `Account.iconCheckedAt`, persisted to `accounts.enc`, so an issuer nothing has an icon for isn't re-asked on every single app launch — only after `ICON_MISS_TTL_MS` (7 days).

### OTP generation (`src/otp.ts`)

Hand-rolled RFC 6238 TOTP on top of `jssha` (the only runtime dependency): base32 secret, HMAC-SHA1, 30-second step, 6 digits, all hard-coded. `parseOtpUrl` (in `settings.mts`, and duplicated in `app.ts` for demo mode) only reads `secret` and `issuer`, and only accepts `otpauth://totp/`; `algorithm`, `digits`, and `period` parameters are ignored. Secrets are normalized (whitespace stripped, upper-cased) before being stored, since jsSHA has no tolerance for the space-separated groups providers commonly display a secret in.

### macOS-only shortcuts

Clipboard writes go through `execSync('printf ... | pbcopy')` rather than Electron's `clipboard`; the emoji picker is `app.showEmojiPanel()`; the highlight colour comes from `systemPreferences.getAccentColor()`. None of this is portable and the app makes no attempt to be.

## Release pipeline

`.github/workflows/release.yml` runs on `v*` tags (which `npm run release` creates): `npm ci` -> `npm run make-icons` -> `npm run build` with `CSC_IDENTITY_AUTO_DISCOVERY=false` -> attach `dist/*.dmg` to the GitHub Release. `package.json`'s `build.mac.identity` is `"-"`, which electron-builder treats as an explicit opt-in to ad-hoc signing (not a real Developer ID signature, and not notarized) with `hardenedRuntime: false` alongside it since there's no entitlements file for the hardened-runtime default. Gatekeeper still blocks first launch the same as a fully unsigned build; first launch requires right-click -> Open, or on macOS 15+:

```sh
xattr -dr com.apple.quarantine "/Applications/Easy OTP.app"
```

electron-builder config is inline in `package.json` under `"build"`; the app only packages `dist/**` and `assets/**`, and `app.ts` loads the tray icon from `assets/icon.png` via `app.getAppPath()`.

## Test fixtures

`scripts/demo-data.txt` holds fake `otpauth://` URLs. It is what `npm run demo` loads by default (pass another file with `npm run demo -- <path>`, resolved relative to wherever `npm run demo` was invoked from), and it also works for exercising the Import File tab.

`local-otp*` files at the root are gitignored. Do not read or commit `local-otp-urls.txt`; assume it contains real secrets.

## Code style

Four-space indentation, single quotes, trailing commas, roughly 100-column lines, and long explanatory comments on anything non-obvious (especially around macOS window behaviour). Match that; the "why" comments in `app.ts` are load-bearing.

## `web/` (Skrapa static site)

Separate package requiring Node 24+. Run from inside `web/`:

```sh
npm install
npm run dev     # live-reload dev server at http://localhost:4159
npm run build   # static HTML to web/dist/
```

- Skrapa compiles JSX to HTML strings **at build time**; there is no framework or runtime in the browser. Every `src/**/index.tsx` exporting `Page()` becomes a route; `index.html` beside it is the HTML shell (falling back to `src/index.html`); `client.ts` beside it is the browser bundle; `assets/` is copied through verbatim.
- `skrapa.config.ts` sets `base: '/easy-otp/'` for a GitHub Pages project site, so hand-written root-relative URLs must carry that prefix.
- `web/skrapa.d.ts` is regenerated by every Skrapa command. Do not edit it; put project globals in a separate `.d.ts`.
- `web/src/development/` is the Development guide linked from the home page (setup, scripts, how the app works) — not Skrapa's scaffold page.
- `.github/workflows/deploy-web.yml` (at the repository root) deploys `web/dist` to GitHub Pages on every push to `main`, running `npm ci` and `npm run build` inside `web/` on Node 24. `npm ci` needs `web/package-lock.json` to be committed.
