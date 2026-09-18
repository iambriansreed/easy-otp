# Code review follow-up

Findings from a full review of the working-tree diff (menu popover rewrite, favicon
fetching, settings redesign, web/ site, build changes). Grouped by priority; checked
off as fixed.

## P0 — Correctness & data safety

- [x] Deleting an account twice fast (double-click) can splice the wrong row — guard against re-entrant delete
- [x] Editing an account into an issuer+account collision with another account copies the wrong OTP code from the popover — block/dedupe on Save
- [x] Settings window holds a stale snapshot and overwrites icons `backfillIcons()` found and wrote to disk after that snapshot was taken — sync backfilled icons into the open Settings window
- [x] `writeData()` is not atomic (`writeFileSync` straight to `accounts.enc`) — a crash mid-write can corrupt the only copy of the user's secrets — write to a temp file and rename
- [x] A secret with spaces/lowercase/padding throws uncaught inside the `menu:invoke` IPC handler and crashes the copy flow — normalize secrets on save, guard the copy path
- [x] `src/menu.mts` and `src/settings.mts` are untracked — the renderers' actual JS ships nothing on a fresh clone/commit
- [x] Tray-click open/close is decided from a timestamp race against the blur-hide timer, not the window's actual visibility — a normal-speed click can fail to close the menu
- [x] `menu:ready` unconditionally shows/focuses the window even if the user already dismissed the menu while the render was in flight
- [x] Favicon fetch's abort timer only covers response headers, not the body read — a stalled body hangs a lookup (and everything sharing its cache entry) forever
- [x] Favicon negative results are cached in memory for the process lifetime, so a transient network failure (e.g. offline at login) permanently poisons lookups until restart — add a TTL to negative results
- [x] Overlapping favicon lookups (debounced URL typing) have no sequencing — a slow stale request can overwrite a newer one's result
- [x] Bulk import's icon backfill re-finds accounts in the wrong array (`imported`, not `accounts`), so a concurrent edit can strand a found icon on a detached object
- [x] Re-rendering the account list while an edit panel is open silently discards any staged (unsaved) favicon/URL/emoji, even though the panel stays open looking undisturbed
- [x] Cancelling a drag (Esc) doesn't reset `dragSrcIndex`, so an unrelated later drop can reorder accounts
- [x] Losing the single-instance lock can still run `whenReady()` before `app.quit()` takes effect, letting a second instance read/write the real store
- [x] Manual-add icon editor: reset() doesn't cancel in-flight lookups/debounce, so a stale favicon can attach to the next account typed in
- [x] Clearing the website URL field auto-refills it via the debounced favicon search falling back to the issuer
- [x] ⌘Q shortcut checks `e.key === 'q'`, which breaks under Caps Lock or non-Latin keyboard layouts — use `e.code`
- [x] Placeholder-letter avatar uses `charAt(0)`, which mangles issuers/accounts starting with an astral character (emoji, etc.)
- [x] `npm run demo -- <path>` resolves the path against the wrong directory when invoked from a subdirectory

## P1 — Security & build

- [x] `"identity": "-"` in package.json's mac config is ad-hoc signing (per electron-builder's own docs), not "unsigned" as CLAUDE.md/README claim, and needs `hardenedRuntime: false` or Gatekeeper/launch can fail
- [x] Website's and README's "if that doesn't work" fix run `codesign -s -` on an app that's already ad-hoc signed at build time — it now exits "already signed"; drop the now-redundant codesign step
- [x] Electron pinned back from ^40.6.1 to ^31.7.7 with no comment explaining why — traced through local session transcripts: `^40.6.1` was never a real published version, which corrupted the install and produced an "`app` from the electron import is `undefined`" crash at startup; the fix at the time was pinning to a known-good old version (31.7.7) rather than fixing the version string. Separately, that same session's environment had `ELECTRON_RUN_AS_NODE=1` set (a VS Code extension-host artifact), which produces the exact same "`app` is `undefined`" symptom regardless of Electron version — trying 44.4.1 hit this and looked like confirmation that newer Electron was broken, when it wasn't. Verified today: updated to `^44.4.1` (current latest stable), reinstalled, and launched the built app with `ELECTRON_RUN_AS_NODE` unset — no crash, `app.getPath()`/single-instance-lock/tray APIs all work, clean shutdown on SIGTERM, `tsc` clean against Electron 44's types, and the real `accounts.enc` was left untouched (verified unchanged mtime).

## P2 — Documentation accuracy

- [x] CLAUDE.md is staged but deleted from the working tree (only a stray untracked copy exists at `.claude/DOCS.md`, which nothing loads) — restore it to disk
- [x] CLAUDE.md: inline-script/CommonJS-only claim is stale now that both renderers are compiled `.mts` ES modules
- [x] CLAUDE.md: `parseOtpUrl` location and `isImageIcon` "duplicated in both renderers" claim are stale
- [x] CLAUDE.md: `Account` type sample is missing the new `hidden` field
- [x] CLAUDE.md: `web/src/development/` is no longer the Skrapa scaffold, it's a real Development guide
- [x] README says favicons come from "the issuer's site" — they only ever come from DuckDuckGo's/Google's icon services (matches the website's own Privacy section, just not the README)
- [x] README's "Build Locally" section omits the required `npm run make-icons` step (icon.icns isn't committed)
- [x] Website's usage guide says "There is no Quit item" — the popover has always had one in this diff

## P3 — Duplication & simplification

- [x] Debug `console.log` calls left in `src/app.ts` (`[showMenu]`, `[createMenuWindow]`, `[menu:items]`, `[menu:ready]`, no-op `did-finish-load` listener)
- [x] `isJpeg`/dead branch in `src/favicon.ts`'s `toIcon()` — both branches call the same function
- [x] `accent as unknown as string` double-cast in `src/menu.mts` where `accent` is already typed `string`
- [x] `esc()` duplicated between `menu.mts`/`settings.mts` with different null handling — moved to a new `src/shared.mts` (both renderers are ESM and can import it; the CJS main process still can't, so its own small copies of `isImageIcon`/`sameAccount`/`parseOtpUrl` stay). `esc()` now uses the safer `s ?? ''` behavior everywhere.
- [x] Three copies of the "keep existing icon/url/hidden, then replace-or-push" merge logic in `settings.mts` — collapsed into one `upsertAccount(entry)` used by URL add, manual add and import; it returns the merged/stored account so callers (import's icon backfill queue, the post-add `autoFavicon` check) see the carried-over icon/url instead of the pre-merge entry.
- [x] `parseOtpUrl` duplicated in `app.ts` and `settings.mts` with diverging return types — `settings.mts`'s copy is now typed `Account | null` (matching `app.ts`'s, and matching what it's always actually returned), which removed every `as Account` cast at its call sites. The two implementations themselves stay duplicated (documented in CLAUDE.md): the CJS main process can't statically import the ESM renderer module that would need to hold a shared copy.

## P4 — Efficiency

- [x] `backfillIcons()` re-queries every icon-less account on every launch with no persisted miss marker — added `Account.iconCheckedAt`; a miss is remembered for 7 days (`ICON_MISS_TTL_MS`) before being retried, instead of every single launch forever.
- [x] `renderAccounts()` eagerly wires a full icon editor for every row's hidden edit panel on every render — now deferred to the Edit click (or restored immediately only for a row whose panel is already open across the rebuild), cutting the querySelectors/listeners/IPC domain-guess call down to the one row actually being edited.
- [x] Menu open does an extra IPC round trip (`menu:refresh` → `menu:items` → reply → `menu:ready`) that could be collapsed — `menu:refresh` now carries the payload directly (`menuPayload()` computed once in main and sent as the event's argument); `menu:items` is kept only for the renderer's own first-load bootstrap, before any refresh exists to carry a payload.
- [x] Website's below-the-fold screenshots aren't lazy-loaded — added `loading="lazy" decoding="async"` to the three below-the-fold screenshots; the hero screenshot stays eager.

## P5 — Accessibility

- [x] Custom popover has no ARIA roles (`role="menu"`/`menuitem`), unlike the native `Menu` it replaced — added `role="menu"` (with `tabindex="-1"` so it can hold real DOM focus) on the container, `role="menuitem"`/`aria-disabled` on each row, `role="separator"` on dividers, and `aria-activedescendant` tracking the keyboard/mouse-highlighted row (a screen reader needs this since the highlight is a CSS class, not real per-row focus — arrow keys must keep working via the existing window-level handler). The copy confirmation got `role="status"` so it's announced without needing focus moved to it.

## Verification

Every item above was verified with `npx tsc --noEmit` (root, `scripts/`, and `web/`) after each change, and the built app was launched directly (`node_modules/electron/dist/Electron.app/Contents/MacOS/Electron .`, with `ELECTRON_RUN_AS_NODE` explicitly unset — see the Electron item above) multiple times across the session with no crash and a clean shutdown on SIGTERM. The website was rebuilt with Skrapa to confirm the JSX/copy edits render correctly. Interactive verification of the tray click / keyboard navigation itself (actually seeing the popover, clicking a row) wasn't possible from this shell — no accessibility/UI-automation access was available (`osascript` targeting the menu bar item hung on what looks like a permission prompt) — so those paths are covered by type-checking and code review, not a live click-through.
