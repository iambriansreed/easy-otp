import { esc } from './shared.mjs';

interface Account {
    account: string;
    secret: string;
    issuer: string;
    icon?: string;
    url?: string;
    hidden?: boolean;
    /** Opaque here — only backfillIcons() in the main process reads it — but this
     *  window owns the full array's round trip, so it must be carried forward
     *  through every reconstruction or a save silently resets main's retry TTL. */
    iconCheckedAt?: number;
}

interface OpenEdit {
    issuer: string;
    account: string;
    issuerValue: string;
    accountValue: string;
    secretValue: string;
    /** The icon editor's staged (possibly unsaved) icon and URL, so a re-render
     *  triggered by something unrelated doesn't silently revert them. */
    iconValue: string;
    urlValue: string;
}

type IconEditor = {
    currentIcon: () => string;
    currentUrl: () => string;
    reset: () => void;
};

declare global {
    interface Window {
        api: {
            getAccounts: () => Promise<Account[]>;
            saveAccounts: (accounts: Account[]) => Promise<void>;
            fetchFavicon: (issuer: string) => Promise<{ icon: string; domain: string } | null>;
            guessFaviconDomain: (issuer: string) => Promise<string | null>;
            showEmojiPanel: () => Promise<void>;
            onAccountIconFound: (
                fn: (found: { issuer: string; account: string; icon: string; url?: string }) => void,
            ) => void;
        };
    }
}

const qs = <T extends HTMLElement>(selector: string, parent: Document | Element = document) =>
    parent.querySelector<T>(selector);
const qsa = <T extends HTMLElement>(selector: string, parent: Document | Element = document): T[] =>
    Array.from(parent.querySelectorAll<T>(selector));

let accounts: Account[] = [];
let dragSrcIndex: number | null = null;
/** True while a delete/save/import is already persisting, to ignore a repeat
 *  click on the same control before the row it acted on has been rebuilt. */
let mutating = false;

const sameAccount = (
    a: Account | { issuer: string; account: string },
    b: Account | { issuer: string; account: string },
): boolean => a.issuer === b.issuer && a.account === b.account;

/**
 * Adds `entry` to `accounts`, or — if an account with the same issuer + account
 * already exists — merges into it instead: a fresh otpauth:// URL or a manually
 * re-entered account never carries an icon/url/hidden state, so without this a
 * re-add or re-import would silently drop whichever of those the user had
 * already set on that account. `entry`'s own icon/url win when it has them (an
 * explicit choice on the form beats whatever was there before); `hidden` always
 * carries over, since nothing that creates `entry` ever sets it.
 *
 * Returns the account as actually stored (which callers should use instead of
 * `entry` from here on — e.g. before checking whether it still needs a favicon
 * lookup, since `entry` itself never carries one even when the merge did) and
 * whether an existing account was updated (false means newly added).
 */
function upsertAccount(entry: Account): { account: Account; updated: boolean } {
    const idx = accounts.findIndex((a) => sameAccount(a, entry));
    if (idx === -1) {
        accounts.push(entry);
        return { account: entry, updated: false };
    }
    const existing = accounts[idx]!;
    const icon = entry.icon || existing.icon;
    const account: Account = {
        ...entry,
        icon,
        url: entry.url || existing.url,
        ...(existing.hidden && { hidden: true }),
        // Only meaningful while there's still no icon — once one lands, any prior
        // miss is moot, and backfillIcons() itself clears it the same way.
        ...(!icon && existing.iconCheckedAt && { iconCheckedAt: existing.iconCheckedAt }),
    };
    accounts[idx] = account;
    return { account, updated: true };
}

/** Cancels any in-flight per-row icon-editor debounce before its row is torn down. */
let pendingIconEditorCancellers: (() => void)[] = [];

/** This render's per-row icon editors, keyed by account identity, so
 *  captureOpenEdits() can read back a staged (unsaved) icon/URL before the row
 *  is torn down and rebuilt from the persisted account. */
let liveIconEditors = new Map<string, IconEditor>();
const editorKey = (a: { issuer: string; account: string }) => `${a.issuer}::${a.account}`;

// Rows are only draggable while a mousedown on one of their .drag-handle
// elements is held — otherwise a click-drag anywhere else in the row
// (selecting text, dragging a button) would be hijacked into a reorder.
let armedDragRow: HTMLElement | null = null;
document.addEventListener('mouseup', () => {
    if (armedDragRow) {
        armedDragRow.draggable = false;
        armedDragRow = null;
    }
});

const svgIcon = (size: number, inner: string): string =>
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

const ICON_EYE = svgIcon(
    14,
    '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z"/><circle cx="12" cy="12" r="3"/>',
);
const ICON_EYE_OFF = svgIcon(
    14,
    '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>',
);
const ICON_SEARCH = svgIcon(
    13,
    '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
);

const isImageIcon = (icon: unknown): icon is string =>
    typeof icon === 'string' && icon.startsWith('data:image/');

const stripScheme = (url: string | undefined): string => (url || '').replace(/^https?:\/\//i, '');

/**
 * Secrets are commonly displayed by providers in space-separated groups
 * ("abcd efgh ijkl") and are case-insensitive base32; normalizing on save is
 * what keeps a pasted secret from reaching jsSHA unmodified, where it throws
 * inside the main-process copy handler instead of producing a code.
 */
const normalizeSecret = (s: string): string => s.replace(/\s+/g, '').toUpperCase();

/** Clamp a text input to a single visual character (emoji, modifiers and all). */
function clampToOneEmoji(el: HTMLInputElement): void {
    const value = el.value;
    if (!value) return;
    const graphemes = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value)];
    if (graphemes.length > 1) el.value = graphemes[0]!.segment;
}

function iconHtml(acct: Partial<Account>): string {
    if (isImageIcon(acct.icon)) return `<img src="${esc(acct.icon)}" alt="">`;
    if (acct.icon) return esc(acct.icon);
    // Array destructuring (not charAt/slice) so an issuer/account starting with an
    // astral character (many emoji, some CJK extensions) takes its whole code
    // point instead of a lone surrogate half, which renders as U+FFFD.
    const [first] = [...(acct.issuer || acct.account || '?').trim()];
    const seed = (first || '?').toUpperCase();
    return `<span class="icon-blank">${esc(seed)}</span>`;
}

/** Icon-editing markup shared by the per-account edit panel and the manual add form. */
function iconEditorHtml(icon: string | undefined, url: string | undefined): string {
    return `
                <div class="icon-row">
                    <span class="icon-slot icon-preview"></span>
                    <select class="icon-mode">
                        <option value="favicon">Favicon</option>
                        <option value="emoji">Emoji</option>
                    </select>
                    <div class="favicon-controls">
                        <div class="url-group">
                            <span class="url-prefix">https://</span>
                            <input class="edit-url" type="text" placeholder="example.com" value="${esc(stripScheme(url || ''))}">
                        </div>
                        <button class="btn-icon find-icon" title="Find favicon">${ICON_SEARCH}</button>
                    </div>
                    <div class="emoji-controls">
                        <input class="edit-icon emoji-input" type="text" placeholder="🙂" maxlength="20" title="Click to open the emoji picker" value="${isImageIcon(icon) ? '' : esc(icon || '')}">
                    </div>
                    <button class="btn-icon clear-icon" title="Clear icon">✕</button>
                </div>
                <span class="icon-status"></span>
            `;
}

/**
 * Wires up icon-editor markup built by iconEditorHtml() and found inside `scope`:
 * the favicon/emoji mode toggle, favicon search (button click and debounced on URL
 * edit), emoji input/picker, and clear. `getLabel()` returns the current
 * `{ issuer, account }` for the live preview and as a favicon-search fallback.
 * Returns the icon/url currently staged, plus a reset() for reuse after submit.
 */
function wireIconEditor(
    scope: HTMLElement,
    initial: Partial<Account>,
    getLabel: () => { issuer: string; account: string },
): IconEditor {
    const initialIcon = initial.icon || '';
    const initialUrl = initial.url || '';

    let pendingIcon = isImageIcon(initialIcon) ? initialIcon : null;
    let mode = isImageIcon(initialIcon) || !initialIcon ? 'favicon' : 'emoji';
    // Bumped by every new search and by reset(); a findFavicon() call whose
    // sequence number no longer matches when it resolves was superseded (a
    // faster later search finished first, or the form was reset/submitted
    // while it was in flight) and must not touch pendingIcon/urlInput/status.
    let searchSeq = 0;

    const iconInput = qs<HTMLInputElement>('.edit-icon', scope)!;
    const iconPreview = qs<HTMLElement>('.icon-preview', scope)!;
    const iconStatus = qs<HTMLElement>('.icon-status', scope)!;
    const modeSelect = qs<HTMLSelectElement>('.icon-mode', scope)!;
    const faviconControls = qs<HTMLElement>('.favicon-controls', scope)!;
    const emojiControls = qs<HTMLElement>('.emoji-controls', scope)!;
    const findBtn = qs<HTMLButtonElement>('.find-icon', scope)!;
    const urlInput = qs<HTMLInputElement>('.edit-url', scope)!;

    const currentIcon = () => (mode === 'emoji' ? iconInput.value.trim() : pendingIcon) || '';
    const currentUrl = () => {
        const raw: string = stripScheme(urlInput.value.trim());
        return raw ? `https://${raw}` : '';
    };
    const refreshPreview = () => {
        const { issuer, account } = getLabel();
        iconPreview.innerHTML = iconHtml({ icon: currentIcon(), issuer, account });
    };

    function applyMode(next: string) {
        mode = next;
        modeSelect.value = mode;
        faviconControls.classList.toggle('hidden', mode !== 'favicon');
        emojiControls.classList.toggle('hidden', mode !== 'emoji');
    }
    applyMode(mode);
    refreshPreview();

    // A favicon was found for this account before the URL field existed —
    // backfill it from the same domain guess the original lookup would have used.
    if (isImageIcon(initialIcon) && !initialUrl) {
        const seed = (getLabel().issuer || getLabel().account || '').trim();
        if (seed) {
            window.api.guessFaviconDomain(seed).then((domain) => {
                if (domain && !urlInput.value.trim()) urlInput.value = domain;
            });
        }
    }

    modeSelect.addEventListener('change', () => {
        applyMode(modeSelect.value);
        if (mode === 'emoji') {
            iconInput.focus();
            window.api.showEmojiPanel();
        }
        refreshPreview();
    });

    iconInput.addEventListener('input', () => {
        clampToOneEmoji(iconInput);
        refreshPreview();
    });

    iconInput.addEventListener('click', () => window.api.showEmojiPanel());

    async function findFavicon() {
        // The URL field is checked first — an explicit source beats guessing from the name
        const explicitUrl = urlInput.value.trim();
        const { issuer, account } = getLabel();
        const source = explicitUrl || issuer.trim() || account.trim();
        if (!source) {
            iconStatus.textContent = 'Enter a website URL or issuer first.';
            return;
        }

        const seq = ++searchSeq;
        findBtn.disabled = true;
        findBtn.innerHTML = '<span class="spinner"></span>';
        iconStatus.textContent = 'Searching…';
        const result = await window.api.fetchFavicon(source);
        // A newer search (or a reset/submit) started while this was in flight —
        // applying this result now would overwrite whatever that did with a
        // stale answer to a question nobody's asking anymore.
        if (seq !== searchSeq) return;

        findBtn.disabled = false;
        findBtn.innerHTML = ICON_SEARCH;

        if (result) {
            pendingIcon = result.icon;
            if (!explicitUrl) urlInput.value = result.domain;
            iconStatus.textContent = 'Found — save to keep it.';
        } else {
            iconStatus.textContent = 'No favicon found.';
        }
        refreshPreview();
    }

    findBtn.addEventListener('click', findFavicon);

    let urlDebounce: ReturnType<typeof setTimeout>;
    urlInput.addEventListener('input', () => {
        clearTimeout(urlDebounce);
        // An empty field means the user is clearing the URL, not asking for a
        // lookup — searching anyway would fall back to the issuer/account and
        // silently refill the very field they just emptied.
        if (!urlInput.value.trim()) {
            iconStatus.textContent = '';
            return;
        }
        urlDebounce = setTimeout(findFavicon, 600);
    });
    pendingIconEditorCancellers.push(() => clearTimeout(urlDebounce));

    qs<HTMLButtonElement>('.clear-icon', scope)?.addEventListener('click', () => {
        searchSeq++;
        pendingIcon = null;
        iconInput.value = '';
        iconStatus.textContent = '';
        refreshPreview();
    });

    return {
        currentIcon,
        currentUrl,
        reset() {
            searchSeq++; // invalidate any in-flight findFavicon() from before this reset
            clearTimeout(urlDebounce);
            pendingIcon = null;
            mode = 'favicon';
            iconInput.value = '';
            urlInput.value = '';
            iconStatus.textContent = '';
            applyMode(mode);
            refreshPreview();
        },
    };
}

/**
 * Look up a favicon for an account that has no icon yet. `list` is re-searched by
 * identity right before writing rather than mutating `acct` directly: a concurrent
 * Save can replace `list[index]` with a brand-new object while this fetch is in
 * flight, which would otherwise leave the result written to a detached object that
 * never reaches `list` or gets persisted.
 */
async function autoFavicon(list: Account[], acct: Account): Promise<boolean> {
    if (acct.icon) return false;
    const source = (acct.url || acct.issuer || acct.account || '').trim();
    if (!source) return false;
    try {
        const result = await window.api.fetchFavicon(source);
        if (result) {
            const current = list.find((a) => sameAccount(a, acct));
            if (!current || current.icon) return false;
            current.icon = result.icon;
            if (!current.url) current.url = result.domain;
            return true;
        }
    } catch (err) {
        console.error('Favicon lookup failed:', err);
    }
    return false;
}

async function fillMissingIcons(
    targets: Account[],
    onProgress?: (done: number, total: number, found: number) => void,
): Promise<number> {
    const queue = targets.filter((a) => !a.icon);
    const total = queue.length;
    if (!total) return 0;

    let done = 0,
        found = 0;
    const worker = async (): Promise<void> => {
        while (queue.length) {
            const acct = queue.shift();
            // Re-find in the live `accounts` array, not `targets`: for an import,
            // `targets` is the separate `imported` list of just-parsed objects, and
            // a concurrent Save replaces the matching object in `accounts` with a
            // new one that `targets` never sees — searching `targets` would strand
            // any icon found here on a detached object nothing ever persists.
            if (acct && (await autoFavicon(accounts, acct))) found++;
            done++;
            if (onProgress) onProgress(done, total, found);
        }
    };

    await Promise.all(Array.from({ length: Math.min(4, total) }, worker));
    return found;
}

/** Always returns a complete Account (icon/url/hidden are the only optional
 *  fields, and this never sets any of them) — never Partial, so callers don't
 *  need an `as Account` cast to hand the result to upsertAccount(). */
function parseOtpUrl(raw: string): Account | null {
    try {
        const u = new URL(raw.trim());
        if (u.protocol !== 'otpauth:') return null;
        if (u.host !== 'totp') return null;

        const secret = normalizeSecret(u.searchParams.get('secret') || '');
        if (!secret) return null;

        const label = decodeURIComponent(u.pathname.replace(/^\//, ''));
        const colon = label.indexOf(':');
        let issuer: string, account: string;
        if (colon !== -1) {
            issuer = label.slice(0, colon).trim();
            account = label.slice(colon + 1).trim();
        } else {
            issuer = '';
            account = label.trim();
        }

        const issuerParam = u.searchParams.get('issuer');
        if (issuerParam) issuer = issuerParam;

        return { account, secret, issuer };
    } catch {
        return null;
    }
}

async function persist() {
    await window.api.saveAccounts(accounts);
}

/**
 * Which accounts (by identity) currently have their edit panel open, plus whatever
 * is typed into the issuer/account/secret fields, so a rebuild triggered by an
 * unrelated action (another row's toggle, a bulk icon lookup finishing) does not
 * silently collapse the panel and discard an in-progress, unsaved edit.
 *
 * Identity comes from the row itself (stamped at render time), not from
 * `accounts[row.dataset.index]`: by the time this runs a delete or drag reorder
 * has already shifted the array, so the index would resolve to a neighbour and
 * that account would get this row's unsaved values.
 */
function captureOpenEdits(): OpenEdit[] {
    const open: OpenEdit[] = [];
    qsa<HTMLElement>('#account-list .account-row', document).forEach((row) => {
        const editPanel = qs<HTMLElement>('.account-edit', row)!;
        if (editPanel.classList.contains('hidden')) return;
        const issuer = row.dataset.issuer || '';
        const account = row.dataset.account || '';
        // Read from the live icon editor's closure, not the account it was
        // opened with: a staged-but-unsaved favicon/URL/emoji only exists there,
        // and pulling from `accounts` here would silently revert it on rebuild.
        const editor = liveIconEditors.get(editorKey({ issuer, account }));
        open.push({
            issuer,
            account,
            issuerValue: qs<HTMLInputElement>('.edit-issuer', editPanel)?.value || '',
            accountValue: qs<HTMLInputElement>('.edit-account', editPanel)!.value || '',
            secretValue: qs<HTMLInputElement>('.edit-secret', editPanel)!.value || '',
            iconValue: editor?.currentIcon() ?? '',
            urlValue: editor?.currentUrl() ?? '',
        });
    });
    return open;
}

function renderAccounts() {
    const list = document.getElementById('account-list')!;
    const emptyMsg = document.getElementById('empty-msg')!;
    const openEdits = captureOpenEdits();
    liveIconEditors = new Map();
    pendingIconEditorCancellers.forEach((cancel) => cancel());
    pendingIconEditorCancellers = [];
    list.innerHTML = '';
    emptyMsg.style.display = accounts.length ? 'none' : 'block';

    // Nothing to find once every account already has an icon — hide the
    // button instead of leaving one that would just report that back. The
    // status text stays put so a "Found N of M." from just finishing the
    // last of them is still visible; it's only cleared once there's new
    // work again, so it doesn't linger stale next to a reappeared button.
    const missingIcon = accounts.some((a) => !a.icon);
    document.getElementById('bulk-icons-btn')!.style.display = missingIcon ? '' : 'none';
    if (missingIcon) {
        const status = document.getElementById('bulk-icons-status')!;
        status.textContent = '';
        status.classList.remove('success');
    }

    accounts.forEach((acct, index) => {
        const row = document.createElement('div');
        row.className = acct.hidden ? 'account-row is-hidden' : 'account-row';
        row.draggable = false;
        row.dataset.index = String(index);
        row.dataset.issuer = acct.issuer;
        row.dataset.account = acct.account;

        const label = acct.issuer ? `${esc(acct.issuer)}: ${esc(acct.account)}` : esc(acct.account);
        const hiddenBadge = acct.hidden ? '<span class="hidden-badge">Hidden</span>' : '';

        row.innerHTML = `
                    <div class="account-view">
                        <span class="drag-handle" title="Drag to reorder">⠿</span>
                        <span class="icon-slot">${iconHtml(acct)}</span>
                        <span class="account-label">${label}</span>
                        <div class="row-actions">
                            ${hiddenBadge}
                            <button class="btn-icon toggle-hidden" title="${acct.hidden ? 'Show in menu' : 'Hide from menu'}">${acct.hidden ? ICON_EYE_OFF : ICON_EYE}</button>
                            <button class="btn-icon edit">Edit</button>
                            <button class="btn-icon delete">×</button>
                        </div>
                    </div>
                    <div class="account-edit hidden">
                        <input class="edit-issuer" type="text" placeholder="Issuer" value="${esc(acct.issuer)}">
                        <input class="edit-account" type="text" placeholder="Account" value="${esc(acct.account)}">
                        <input class="edit-secret" type="text" placeholder="Secret" value="${esc(acct.secret)}">
                        ${iconEditorHtml(acct.icon, acct.url)}
                        <p class="error edit-error"></p>
                        <div class="edit-actions">
                            <span class="drag-handle" title="Drag to reorder">⠿</span>
                            <div class="action-buttons">
                                <button class="btn-cancel-sm">Cancel</button>
                                <button class="btn-save">Save</button>
                            </div>
                        </div>
                    </div>
                `;

        const view = qs<HTMLElement>('.account-view', row)!;
        const editPanel = qs<HTMLElement>('.account-edit', row)!;

        const getIconLabel = () => ({
            issuer: qs<HTMLInputElement>('.edit-issuer', editPanel)!.value,
            account: qs<HTMLInputElement>('.edit-account', editPanel)!.value,
        });

        // Wiring an icon editor does real work — several querySelectors, half a
        // dozen listeners, an initial preview render, and (for a favicon with no
        // URL yet) an IPC round trip to guess one. Only one row is ever open at a
        // time, so doing that for every row on every render is wasted on all the
        // others; it's deferred to the Edit click below, except when the panel is
        // already open from a previous render (openEdit), where it must exist
        // immediately. An open edit's staged icon/URL (if any) beats the saved
        // account's, so a rebuild triggered by something unrelated doesn't revert
        // an in-progress favicon search or emoji pick the user hasn't saved yet.
        const openEdit = openEdits.find((e) => sameAccount(e, acct));
        let iconEditor: IconEditor | null = openEdit
            ? wireIconEditor(editPanel, { icon: openEdit.iconValue, url: openEdit.urlValue }, getIconLabel)
            : null;
        if (iconEditor) liveIconEditors.set(editorKey(acct), iconEditor);

        if (openEdit) {
            view.classList.add('hidden');
            editPanel.classList.remove('hidden');
            qs<HTMLInputElement>('.edit-issuer', editPanel)!.value = openEdit.issuerValue;
            qs<HTMLInputElement>('.edit-account', editPanel)!.value = openEdit.accountValue;
            qs<HTMLInputElement>('.edit-secret', editPanel)!.value = openEdit.secretValue;
        }

        qs<HTMLElement>('.toggle-hidden', row)!.addEventListener('click', async () => {
            // Same `mutating` guard as Save/Delete: without it, a click landing while
            // Delete's splice-then-persist is in flight reads this row's stale
            // closured `index` against an already-spliced array and toggles whatever
            // account has shifted into that slot instead.
            if (mutating) return;
            mutating = true;
            try {
                const a = accounts[index];
                if (a?.hidden) delete a.hidden;
                else if (a) a.hidden = true;
                await persist();
            } finally {
                mutating = false;
                renderAccounts();
            }
        });

        qs<HTMLElement>('.btn-icon.edit', row)!.addEventListener('click', () => {
            view.classList.add('hidden');
            editPanel.classList.remove('hidden');
            if (!iconEditor) {
                iconEditor = wireIconEditor(editPanel, { icon: acct.icon, url: acct.url }, getIconLabel);
                liveIconEditors.set(editorKey(acct), iconEditor);
            }
            qs<HTMLElement>('.edit-issuer', editPanel)!.focus();
        });

        qs<HTMLElement>('.btn-cancel-sm', row)!.addEventListener('click', () => {
            view.classList.remove('hidden');
            editPanel.classList.add('hidden');
        });

        qs<HTMLElement>('.btn-save', row)!.addEventListener('click', async () => {
            if (mutating) return;
            const issuer = qs<HTMLInputElement>('.edit-issuer', editPanel)!.value.trim();
            const account = qs<HTMLInputElement>('.edit-account', editPanel)!.value.trim();
            const secret = normalizeSecret(qs<HTMLInputElement>('.edit-secret', editPanel)!.value);
            const errEl = qs<HTMLElement>('.edit-error', editPanel)!;
            if (!account || !secret) {
                errEl.textContent = 'Account and Secret are required.';
                return;
            }
            // Unlike Add/Import, editing an existing row has no natural "merge with
            // the match" outcome — two rows both claiming the same identity is what
            // the popover, backfill and this same capture-by-identity mechanism all
            // resolve by taking the first match, silently copying the wrong account's
            // code. Block it here instead.
            const collision = accounts.some(
                (a, i) => i !== index && sameAccount(a, { issuer, account }),
            );
            if (collision) {
                errEl.textContent = 'Another account already has this issuer and account.';
                return;
            }
            errEl.textContent = '';

            // Can't actually be null here — Save is only reachable once the panel
            // (and therefore the icon editor) has been shown — but the type is
            // nullable since it's set lazily by a separate listener.
            if (!iconEditor) return;
            const icon = iconEditor.currentIcon();
            const url = iconEditor.currentUrl();
            mutating = true;
            try {
                accounts[index] = {
                    account,
                    secret,
                    issuer,
                    ...(icon && { icon }),
                    ...(url && { url }),
                    ...(accounts[index]?.hidden && { hidden: true }),
                    // Same reasoning as upsertAccount(): moot once an icon is set,
                    // otherwise this rebuild would silently reset the retry TTL.
                    ...(!icon && accounts[index]?.iconCheckedAt && {
                        iconCheckedAt: accounts[index]!.iconCheckedAt,
                    }),
                };
                // Close the panel before rebuilding, or captureOpenEdits() sees it
                // open and reopens it in the new row, so Save never appears to work.
                editPanel.classList.add('hidden');
                await persist();
            } finally {
                // Both in `finally` so a rejected persist() (main-process error, IPC
                // hiccup) can't leave future save/delete permanently blocked, nor
                // leave stale index-closures on rows below this one in the DOM.
                mutating = false;
                renderAccounts();
            }
        });

        qs<HTMLElement>('.btn-icon.delete', row)!.addEventListener('click', async () => {
            // Without this, two fast clicks both read the same `index` before either
            // await resolves and splice it twice, deleting the next row along with it.
            if (mutating) return;
            mutating = true;
            try {
                accounts.splice(index, 1);
                await persist();
            } finally {
                // Both in `finally`: if persist() rejects, the splice above already
                // happened, so every row below this one now has a stale index
                // closure unless the DOM is rebuilt regardless of the outcome.
                mutating = false;
                renderAccounts();
            }
        });

        row.querySelectorAll<HTMLElement>('.drag-handle').forEach((handle) => {
            handle.addEventListener('mousedown', () => {
                armedDragRow = row;
                row.draggable = true;
            });
        });

        row.addEventListener('dragstart', (e: DragEvent) => {
            dragSrcIndex = index;
            row.classList.add('dragging');
            if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
        });

        row.addEventListener('dragend', () => {
            row.draggable = false;
            armedDragRow = null;
            dragSrcIndex = null;
            row.classList.remove('dragging');
            qsa<HTMLElement>('.drag-over', list).forEach((el) =>
                el.classList.remove('drag-over'),
            );
        });

        row.addEventListener('dragover', (e: DragEvent) => {
            e.preventDefault();
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
            qsa<HTMLElement>('.drag-over', list).forEach((el) =>
                el.classList.remove('drag-over'),
            );
            if (dragSrcIndex !== index) row.classList.add('drag-over');
        });

        row.addEventListener('dragleave', () => row.classList.remove('drag-over'));

        row.addEventListener('drop', async (e: DragEvent) => {
            e.preventDefault();
            row.classList.remove('drag-over');
            if (dragSrcIndex === null || dragSrcIndex === index) return;
            const [moved] = accounts.splice(dragSrcIndex, 1);
            if (moved) {
                // Removing the source first shifts every index after it down by one,
                // so a downward drag (dragSrcIndex < index) must target one slot
                // earlier than `index` to still land just before the row dropped on.
                const insertAt = dragSrcIndex < index ? index - 1 : index;
                accounts.splice(insertAt, 0, moved);
                dragSrcIndex = null;
                await persist();
                renderAccounts();
            }
        });

        list.appendChild(row);
    });
}

// Mode tabs
qsa<HTMLElement>('.tab', document).forEach((tab) => {
    tab.addEventListener('click', () => {
        qsa<HTMLElement>('.tab', document).forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        const mode = tab.dataset.mode;
        document.getElementById('url-panel')!.classList.toggle('hidden', mode !== 'url');
        document.getElementById('manual-panel')!.classList.toggle('hidden', mode !== 'manual');
        document.getElementById('import-panel')!.classList.toggle('hidden', mode !== 'import');
        document.getElementById('add-btn')!.style.display = mode === 'import' ? 'none' : '';
        // Clear every tab's status text — url-error/manual-error now live in a
        // shared footer row with the button, so a stale message from the tab
        // just left behind would otherwise keep showing after the switch.
        document.getElementById('url-error')!.textContent = '';
        document.getElementById('manual-error')!.textContent = '';
        document.getElementById('import-result')!.textContent = '';
    });
});

// Bulk import
const importDrop = document.getElementById('import-drop')!;
const importFile = document.getElementById('import-file') as HTMLInputElement;

importDrop.addEventListener('click', () => importFile.click());

importDrop.addEventListener('dragover', (e: DragEvent) => {
    e.preventDefault();
    importDrop.classList.add('drag-active');
});
importDrop.addEventListener('dragleave', () => importDrop.classList.remove('drag-active'));
importDrop.addEventListener('drop', (e: DragEvent) => {
    e.preventDefault();
    importDrop.classList.remove('drag-active');
    const file = e.dataTransfer?.files?.[0];
    if (file) processImportFile(file);
});

importFile.addEventListener('change', () => {
    if (importFile.files?.[0]) processImportFile(importFile.files[0]);
    importFile.value = '';
});

async function processImportFile(file: File): Promise<void> {
    const text = await file.text();
    const lines = text
        .split('\n')
        .map((l: string) => l.trim())
        .filter(Boolean);
    const imported: Account[] = [];
    let added = 0,
        updated = 0,
        skipped = 0;

    for (const line of lines) {
        const parsed = parseOtpUrl(line);
        if (!parsed) {
            skipped++;
            continue;
        }
        const { account, updated: wasUpdated } = upsertAccount(parsed);
        if (wasUpdated) updated++;
        else added++;
        imported.push(account);
    }

    await persist();
    renderAccounts();

    const parts = [];
    if (added) parts.push(`${added} added`);
    if (updated) parts.push(`${updated} updated`);
    if (skipped) parts.push(`${skipped} skipped`);
    const summary = parts.join(', ') || 'No valid URLs found.';
    const resultEl = document.getElementById('import-result')!;
    resultEl.textContent = summary;

    const found = await fillMissingIcons(imported, (done, total) => {
        resultEl.textContent = `${summary} — looking up icons ${done}/${total}…`;
    });
    if (found) {
        await persist();
        renderAccounts();
    }
    resultEl.textContent = summary;
}

// Add account
document.getElementById('add-btn')!.addEventListener('click', async () => {
    const mode = document.querySelector<HTMLElement>('.tab.active')?.dataset.mode;
    let entry: Account | undefined;

    if (mode === 'url') {
        const input = document.getElementById('otp-url') as HTMLInputElement;
        const errEl = document.getElementById('url-error')!;
        const parsed = parseOtpUrl(input.value);
        if (!parsed) {
            errEl.textContent = 'Invalid otpauth:// URL.';
            return;
        }
        errEl.textContent = '';
        entry = upsertAccount(parsed).account;
        input.value = '';
    } else {
        const issuer = (document.getElementById('m-issuer') as HTMLInputElement).value.trim();
        const account = (document.getElementById('m-account') as HTMLInputElement).value.trim();
        const secret = normalizeSecret((document.getElementById('m-secret') as HTMLInputElement).value);
        const errEl = document.getElementById('manual-error')!;
        if (!account || !secret) {
            errEl.textContent = 'Account and Secret are required.';
            return;
        }
        errEl.textContent = '';
        const icon = manualIconEditor.currentIcon();
        const url = manualIconEditor.currentUrl();
        entry = upsertAccount({
            account,
            secret,
            issuer,
            ...(icon && { icon }),
            ...(url && { url }),
        }).account;
        (document.getElementById('m-issuer') as HTMLInputElement).value = '';
        (document.getElementById('m-account') as HTMLInputElement).value = '';
        (document.getElementById('m-secret') as HTMLInputElement).value = '';
        manualIconEditor.reset();
    }

    await persist();
    renderAccounts();

    // No icon given — try the issuer's site for a favicon
    if (entry && (await autoFavicon(accounts, entry))) {
        await persist();
        renderAccounts();
    }
});

// Bulk favicon lookup
const bulkBtn = document.getElementById('bulk-icons-btn') as HTMLButtonElement;
const bulkStatus = document.getElementById('bulk-icons-status')!;

bulkBtn.addEventListener('click', async () => {
    const missing = accounts.filter((a) => !a.icon).length;
    // The button is hidden whenever nothing is missing, so this shouldn't
    // be reachable — guarded anyway rather than trusting that from in here.
    if (!missing) return;

    bulkBtn.disabled = true;
    bulkStatus.classList.remove('success');
    bulkStatus.textContent = `Looking up icons 0/${missing}…`;
    try {
        const found = await fillMissingIcons(accounts, (done, total) => {
            bulkStatus.textContent = `Looking up icons ${done}/${total}…`;
        });
        await persist();
        // Success (green) means the button just disappeared above — every
        // account that was missing an icon now has one.
        bulkStatus.classList.toggle('success', !accounts.some((a) => !a.icon));
        bulkStatus.textContent = found ? `Found ${found} of ${missing}.` : 'No favicons found.';
    } finally {
        // Both in `finally`: a rejected persist() must not leave the button stuck
        // disabled with no way to retry short of closing and reopening Settings.
        renderAccounts();
        bulkBtn.disabled = false;
    }
});

// Manual add form's icon editor — same markup and behavior as an account's edit panel
const manualPanel = document.getElementById('manual-panel')!;
document.getElementById('m-icon-editor')!.innerHTML = iconEditorHtml('', '');
const manualIconEditor = wireIconEditor(manualPanel, { icon: '', url: '' }, () => ({
    issuer: (document.getElementById('m-issuer') as HTMLInputElement).value,
    account: (document.getElementById('m-account') as HTMLInputElement).value,
}));

// Enter key submits add form. Listed explicitly rather than queried broadly, so it
// does not also catch the icon editor's nested .edit-url / .emoji-input fields.
qsa<HTMLElement>('#otp-url, #m-issuer, #m-account, #m-secret', document).forEach((input) => {
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') document.getElementById('add-btn')!.click();
    });
});

// Main's own launch-time icon backfill runs independently of this window and
// writes straight to disk; without this, the next unrelated save from here
// (persist() always pushes the whole `accounts` array) would overwrite that
// icon on disk before this window ever knew it existed. Only ever fills in an
// icon/url an account doesn't already have, so it never fights an in-progress
// edit — captureOpenEdits() already protects a staged icon on its own account.
window.api.onAccountIconFound(({ issuer, account, icon, url }) => {
    const current = accounts.find((a) => sameAccount(a, { issuer, account }));
    if (!current || current.icon) return;
    current.icon = icon;
    if (!current.url && url) current.url = url;
    renderAccounts();
});

async function init() {
    accounts = await window.api.getAccounts();
    renderAccounts();
}

init();
