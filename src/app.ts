import {
    app,
    Tray,
    nativeImage,
    BrowserWindow,
    ipcMain,
    safeStorage,
    screen,
    systemPreferences,
} from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { getTimeBasedOTP } from './otp';
import { decode, fetchFavicon, issuerToDomains } from './favicon';
import { execSync } from 'node:child_process';

type Account = {
    account: string;
    secret: string;
    issuer: string;
    /** Optional emoji, or a `data:image/png;base64,...` favicon. */
    icon?: string;
    /** Optional website URL used as the preferred source when looking up a favicon. */
    url?: string;
    /** Kept out of the tray dropdown without removing it from Settings. */
    hidden?: boolean;
    /**
     * When the last favicon lookup for this account (still icon-less) came back
     * empty, so backfillIcons() can skip re-asking on every single launch for an
     * issuer nothing has an icon for. Cleared as soon as a lookup succeeds; not
     * set at all once `icon` is.
     */
    iconCheckedAt?: number;
};

/**
 * `npm run demo` loads accounts from an otpauth:// URL file instead of the
 * encrypted store, for screenshots and manual testing without touching real
 * secrets. This must run before DATA_PATH/ICON_RESET_PATH below and before
 * requestSingleInstanceLock(), both of which derive from userData: redirecting
 * it here means a demo run can never read or overwrite the real Keychain-backed
 * accounts file, and gets its own single-instance lock so it can run alongside
 * the real app.
 */
const DEMO_FILE = process.env.EASY_OTP_DEMO_FILE;
if (DEMO_FILE) {
    const demoUserData = path.join(app.getPath('temp'), 'easy-otp-demo');
    fs.mkdirSync(demoUserData, { recursive: true });
    app.setPath('userData', demoUserData);
}

const DATA_PATH = path.join(app.getPath('userData'), 'accounts.enc');
const ICON_RESET_PATH = path.join(app.getPath('userData'), 'icons-reset');

let tray: Tray | null = null;
let settingsWindow: BrowserWindow | null = null;
let lastClickedAccount: Account | null = null;

/**
 * Copy the account's current code, handing it back so the row can show it.
 *
 * Computes the code before touching any state: a malformed secret (stray
 * whitespace that slipped past normalization, a hand-edited store, an old
 * demo file) makes getTimeBasedOTP throw, and the caller is expected to catch
 * that — better an uncaught error there than a "Last clicked" header and a
 * running dismiss timer for a copy that never happened.
 */
function copyAccountCode(a: Account) {
    const code = getTimeBasedOTP(a.secret);

    lastClickedAccount = a;
    setTimeout(() => {
        // Only clear if a later click hasn't already replaced this as the last-clicked
        // account: otherwise this timer would clear a newer click's header early.
        if (lastClickedAccount !== a) return;
        lastClickedAccount = null;
        // Only redraws a popover that is already open. The native menu used to
        // force itself back open here, which a focus-stealing window must not do.
        refreshMenu();
    }, 60 * 1000);

    execSync(`printf '%s' "${code}" | pbcopy`);
    return code;
}

let accounts: Account[] = [];

function accountLabel(a: Account) {
    return `${decode(a.issuer)}: ${decode(a.account)}`;
}

const isImageIcon = (icon?: string) => !!icon?.startsWith('data:image/');

const sameAccount = (a: Pick<Account, 'issuer' | 'account'>, b: Pick<Account, 'issuer' | 'account'>) =>
    a.issuer === b.issuer && a.account === b.account;

/**
 * Encodes an account's identity (not its array index) into a popover row id, so a click
 * still resolves to the right account even if Settings has reordered, inserted or deleted
 * accounts in the window between the popover's last render and the click reaching main.
 */
const accountRowId = (a: Account) =>
    `account:${encodeURIComponent(a.issuer)}:${encodeURIComponent(a.account)}`;

function accountFromRowId(id: string): Account | undefined {
    const m = /^account:([^:]*):([^:]*)$/.exec(id);
    if (!m) return undefined;
    // decode() (not decodeURIComponent directly) so a malformed id can't throw
    // inside an IPC listener that has no caller to catch it.
    const issuer = decode(m[1]!);
    const account = decode(m[2]!);
    return accounts.find((c) => sameAccount(c, { issuer, account }));
}

// prevent multiple instances of the app
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    app.quit();
}

function readData() {
    if (!fs.existsSync(DATA_PATH)) return null;

    try {
        const encryptedData = fs.readFileSync(DATA_PATH);
        try {
            const decryptedData = safeStorage.decryptString(encryptedData);
            const parsedData = JSON.parse(decryptedData) as Account[];
            return parsedData.map((a) => ({
                ...a,
                issuer: decode(a.issuer),
                account: decode(a.account),
            }));
        } catch (decryptErr) {
            console.error('Failed to decrypt data, deleting corrupted file:', decryptErr);
            fs.unlinkSync(DATA_PATH);
            return null;
        }
    } catch (err) {
        console.error('Failed to read data file:', err);
        return null;
    }
}

/**
 * Writes to a temp file in the same directory and renames it over the real one.
 * `rename` is atomic on the same volume, so a crash or kill mid-write leaves either
 * the old file or the new one intact — never a half-written accounts.enc, which
 * readData() would treat as corrupted and delete outright.
 */
function writeData(data: Account[]) {
    const tmpPath = `${DATA_PATH}.tmp`;
    fs.writeFileSync(tmpPath, safeStorage.encryptString(JSON.stringify(data)), 'utf-8');
    fs.renameSync(tmpPath, DATA_PATH);
}

/** Mirrors the parser in settings.html; kept separate since main and renderer share no modules. */
function parseOtpUrl(raw: string): Account | null {
    try {
        const u = new URL(raw.trim());
        if (u.protocol !== 'otpauth:') return null;
        if (u.host !== 'totp') return null;

        // Normalized the same way settings.mts's copy of this parser normalizes a
        // pasted secret: space-separated groups and mixed case are common in how
        // providers display a base32 secret, and jsSHA has no tolerance for either.
        const secret = (u.searchParams.get('secret') || '').replace(/\s+/g, '').toUpperCase();
        if (!secret) return null;

        const label = decodeURIComponent(u.pathname.replace(/^\//, ''));
        const colon = label.indexOf(':');
        let issuer: string;
        let account: string;
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

/** Reads one otpauth:// URL per line, e.g. scripts/demo-data.txt; blank lines are skipped. */
function loadDemoAccounts(file: string): Account[] {
    const lines = fs.readFileSync(file, 'utf-8').split('\n');
    const accounts: Account[] = [];
    for (const line of lines) {
        if (!line.trim()) continue;
        const parsed = parseOtpUrl(line);
        if (parsed) accounts.push(parsed);
        else console.error(`Demo mode: skipping unparseable line: ${line}`);
    }
    console.log(`Demo mode: loaded ${accounts.length} account(s) from ${file}`);
    return accounts;
}

/**
 * Fetched icons used to come from each issuer's own site, which gave a mix of
 * sizes, crops and formats. They all come from one service now, so the old ones
 * are dropped once and re-fetched. Emoji are typed by hand, so they stay.
 *
 * The marker is written before anything is erased: if that write fails we skip
 * the reset entirely rather than risk wiping freshly fetched icons on every launch.
 */
function resetFetchedIcons() {
    if (fs.existsSync(ICON_RESET_PATH)) return;

    try {
        fs.writeFileSync(ICON_RESET_PATH, new Date().toISOString(), 'utf-8');
    } catch (err) {
        console.error('Could not record the icon reset, leaving icons alone:', err);
        return;
    }

    if (!accounts.some((a) => isImageIcon(a.icon))) return;

    accounts = accounts.map(({ icon, ...rest }) => (isImageIcon(icon) ? rest : { ...rest, icon }));
    writeData(accounts);
}

// How long a failed lookup is trusted before an icon-less account is retried.
// Long enough that a normal day of launches doesn't repeat the same handful of
// DuckDuckGo/Google requests for an issuer nothing has an icon for; short
// enough that the icon service catching up, or the user fixing a typo'd issuer
// elsewhere, doesn't take forever to notice.
const ICON_MISS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Fill in anything still missing an icon, a few at a time.
 *
 * Runs on every launch rather than only after the reset above: a backfill tied
 * to a one-shot marker is lost for good if it is interrupted before it saves,
 * which is exactly what a quit mid-fetch would do. Each icon is written as it
 * arrives so progress survives being killed part-way, and issuers that are
 * already covered — or were tried within ICON_MISS_TTL_MS and came up empty —
 * cost nothing.
 *
 * Each hit is also pushed to an open Settings window as it's found. Settings
 * only ever reads the account list once at open and pushes its own copy back
 * wholesale on every save, so without this an icon found here can be silently
 * overwritten on disk by the next unrelated Settings action (toggling one
 * account's visibility, say) that fires before Settings has any idea an icon
 * arrived. Pushing only the icon/url as it lands, rather than main's whole
 * array, keeps this from clobbering whatever the user has open and unsaved.
 *
 * That push alone still leaves a narrow window: a save-accounts call already
 * in flight when a hit lands can reach the `save-accounts` handler before the
 * renderer has processed the push, so its (still icon-less) copy of this
 * account would silently win. `pendingIconUpdates` closes that window —
 * save-accounts re-applies anything still pending here for an account that
 * arrives with no icon of its own.
 */
const pendingIconUpdates = new Map<string, Pick<Account, 'icon' | 'url' | 'iconCheckedAt'>>();
const identityKey = (a: Pick<Account, 'issuer' | 'account'>) => `${a.issuer} ${a.account}`;

async function backfillIcons() {
    const queue = accounts.filter(
        (a) => !a.icon && (!a.iconCheckedAt || Date.now() - a.iconCheckedAt > ICON_MISS_TTL_MS),
    );
    if (!queue.length) return;

    let found = 0;
    const worker = async () => {
        while (queue.length) {
            const a = queue.shift()!;
            const result = await fetchFavicon(a.url || a.issuer || a.account);

            // Settings can rewrite the list while this runs, so re-find the account
            const current = accounts.find((c) => sameAccount(c, a));
            if (!current || current.icon) continue;

            if (!result) {
                current.iconCheckedAt = Date.now();
                pendingIconUpdates.set(identityKey(current), { iconCheckedAt: current.iconCheckedAt });
                writeData(accounts);
                continue;
            }

            current.icon = result.icon;
            if (!current.url) current.url = result.domain;
            delete current.iconCheckedAt;
            pendingIconUpdates.set(identityKey(current), { icon: current.icon, url: current.url });
            writeData(accounts);
            found++;
            settingsWindow?.webContents.send('account-icon-found', {
                issuer: current.issuer,
                account: current.account,
                icon: current.icon,
                url: current.url,
            });
        }
    };

    const wanted = queue.length;
    await Promise.all(Array.from({ length: 4 }, worker));
    console.log(`Icon backfill: found ${found} of ${wanted}`);
    if (found) refreshMenu();
}

// ---------------------------------------------------------------------------
// Menu popover
//
// A borderless window standing in for the tray's context menu. A native NSMenu
// gives no hover hook and takes fixed images, so it cannot render icons in grey
// and colour them under the pointer; this can, and it also lets the row spacing
// be set freely. The renderer mirrors macOS menu metrics as closely as it can.
// ---------------------------------------------------------------------------

/** Serialisable mirror of one row in the popover. */
type MenuRow = {
    id?: string;
    type: 'item' | 'separator' | 'header';
    label?: string;
    /** `data:image/png;base64,...` favicon. */
    icon?: string;
    emoji?: string;
    accelerator?: string;
    enabled?: boolean;
};

// The popover sizes to its content between these, the way a native menu does
const MENU_MIN_WIDTH = 220;
const MENU_MAX_WIDTH = 460;
const MENU_EDGE_GAP = 6;

let menuWindow: BrowserWindow | null = null;

function menuRows(): MenuRow[] {
    const rows: MenuRow[] = [];

    if (lastClickedAccount) {
        rows.push({ type: 'header', label: `Last clicked: ${accountLabel(lastClickedAccount)}` });
    }

    if (accounts.length) {
        accounts.forEach((a) => {
            if (a.hidden) return;
            rows.push({
                id: accountRowId(a),
                type: 'item',
                label: accountLabel(a),
                icon: isImageIcon(a.icon) ? a.icon : undefined,
                emoji: a.icon && !isImageIcon(a.icon) ? a.icon : undefined,
                enabled: true,
            });
        });
    } else {
        // True first-run empty state (not just every account being hidden, which
        // is a deliberate choice and shouldn't be second-guessed here) — same id
        // as the Settings row below, since that's exactly what opens the Add
        // Account form.
        rows.push({ id: 'settings', type: 'item', label: 'Add Your First Account...', enabled: true });
    }

    rows.push({ type: 'separator' });
    rows.push({ id: 'settings', type: 'item', label: 'Easy OTP Settings...', enabled: true });
    rows.push({ id: 'quit', type: 'item', label: 'Quit Easy OTP', accelerator: '⌘Q', enabled: true });

    return rows;
}

function menuPayload() {
    // Matches the highlight to whatever accent the user picked in System Settings
    const accent = systemPreferences.getAccentColor?.() || '';
    return {
        rows: menuRows(),
        accent: /^[0-9a-f]{6,8}$/i.test(accent) ? `#${accent.slice(0, 6)}` : '#0a6cff',
    };
}

function createMenuWindow() {
    const win = new BrowserWindow({
        width: MENU_MIN_WIDTH,
        height: 80,
        show: false,
        frame: false,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        hasShadow: true,
        /**
         * A non-activating panel, which is what makes this usable over a
         * full-screen app. Showing an ordinary window means activating the app,
         * and macOS answers that by pulling the user back to the app's Space —
         * then the focus churn from that switch immediately blurs the popover
         * and hides it again. A panel takes key focus without activating.
         */
        type: 'panel',
        // The blurred material and rounded corners macOS menus are drawn with
        vibrancy: 'menu',
        visualEffectState: 'active',
        roundedCorners: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload-menu.js'),
            contextIsolation: true,
            nodeIntegration: false,
            // The popover lays itself out while hidden, between opens; throttling
            // a hidden window would stall the timers that work depends on
            backgroundThrottling: false,
        },
    });

    win.setAlwaysOnTop(true, 'pop-up-menu');
    // Lets the popover appear over a full-screen app instead of forcing a Space
    // switch, the way a real menu-bar menu does
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.loadFile(path.join(__dirname, 'menu.html'));

    /**
     * Clicking away dismisses, the same as a real menu — but a panel that has
     * just been shown can blur for a moment while focus settles, especially when
     * it opens over a full-screen Space. Hiding on that transient blur is what
     * makes the menu flash open and shut, so give focus a beat to come back and
     * only dismiss if it truly went elsewhere.
     */
    win.on('blur', () => {
        setTimeout(() => {
            if (menuWindow && !menuWindow.isFocused()) hideMenu();
        }, 150);
    });
    win.on('closed', () => {
        menuWindow = null;
    });

    return win;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max));

/** Sit the popover under the tray icon, clamped to the display it lives on. */
function positionMenu(size: { width: number; height: number }) {
    if (!menuWindow || !tray) return;

    const trayBounds = tray.getBounds();
    const { workArea } = screen.getDisplayMatching(trayBounds);

    const width = Math.ceil(clamp(size.width, MENU_MIN_WIDTH, MENU_MAX_WIDTH));
    const y = Math.round(trayBounds.y + trayBounds.height + 2);
    const height = Math.ceil(
        clamp(size.height, 1, workArea.y + workArea.height - y - MENU_EDGE_GAP),
    );

    const x = Math.round(
        clamp(
            trayBounds.x + trayBounds.width / 2 - width / 2,
            workArea.x + MENU_EDGE_GAP,
            workArea.x + workArea.width - width - MENU_EDGE_GAP,
        ),
    );

    menuWindow.setBounds({ x, y, width, height });
}

let menuHiddenAt = 0;

// True between a call to showMenu() and the next hideMenu(). menu:ready consults
// this rather than showing unconditionally: a refresh that was already in flight
// when the user dismissed the menu (Escape, a blur) must not pop it back open
// once the renderer finally reports back.
let wantsOpen = false;

function showMenu() {
    wantsOpen = true;
    // The renderer measures itself and calls back on 'menu:ready', which is what
    // positions and shows the window — so there is no flash at the wrong size.
    // A freshly created window bootstraps itself once its page loads (its own
    // first render() call invokes 'menu:items', since there's no refresh to
    // carry a payload yet); every later refresh carries the payload itself, so
    // the renderer isn't sent back to main for it over a second round trip.
    menuWindow ??= createMenuWindow();
    if (!menuWindow.webContents.isLoading()) menuWindow.webContents.send('menu:refresh', menuPayload());
}

function hideMenu() {
    wantsOpen = false;
    if (!menuWindow?.isVisible()) return;
    menuWindow.hide();
    menuHiddenAt = Date.now();
}

/**
 * Toggling from the tray icon. Checking the window's actual visibility first
 * (rather than only a "was it just hidden" timestamp) is what makes this a real
 * toggle: a normal-speed click blurs the panel on mousedown but the blur
 * handler's hide is deferred 150ms, so the tray's 'click' (mouseup) can still
 * see the panel visible and close it directly here, instead of racing the
 * deferred hide and re-showing a menu that was already on its way down.
 *
 * The 250ms guard only matters once the window is already hidden: it stops a
 * click that just finished dismissing the menu (via the deferred blur hide
 * firing before this ran) from immediately reopening it.
 */
function toggleMenu() {
    if (menuWindow?.isVisible()) {
        hideMenu();
        return;
    }
    if (Date.now() - menuHiddenAt > 250) showMenu();
}

/** Redraw an open popover after the accounts behind it change. */
function refreshMenu() {
    if (menuWindow?.isVisible()) menuWindow.webContents.send('menu:refresh', menuPayload());
}

function openSettingsWindow() {
    if (settingsWindow) {
        settingsWindow.focus();
        return;
    }

    app.focus({ steal: true });

    settingsWindow = new BrowserWindow({
        width: 480,
        height: 600,
        minWidth: 380,
        minHeight: 400,
        title: 'Easy OTP Settings',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });

    settingsWindow.loadFile(path.join(__dirname, 'settings.html'));

    settingsWindow.on('closed', () => {
        settingsWindow = null;
    });
}

app.whenReady().then(() => {
    // app.quit() (called above when the lock is lost) is async: 'ready' can still
    // fire before it takes effect. Without this, a losing second instance would
    // read, mutate and write over the real (or demo) accounts file behind the
    // winning instance's back before it finally quits.
    if (!gotTheLock) return;

    if (DEMO_FILE) {
        accounts = loadDemoAccounts(DEMO_FILE);
    } else {
        accounts = readData() || [];
        resetFetchedIcons();
    }

    tray = new Tray(
        nativeImage
            .createFromPath(path.join(app.getAppPath(), 'assets/icon.png'))
            .resize({ width: 16, height: 16 }),
    );

    tray.setToolTip('Easy OTP - Click to view accounts');
    tray.on('click', toggleMenu);
    tray.on('right-click', toggleMenu);

    ipcMain.handle('menu:items', () => menuPayload());

    // The renderer reports the size it laid out to; that drives the reveal.
    ipcMain.on('menu:ready', (_, size: { width: number; height: number }) => {
        if (!menuWindow) return;
        positionMenu(size);
        // wantsOpen can have gone false while this refresh was in flight (the
        // user pressed Escape, or a blur hid the panel) — showing anyway would
        // pop a just-dismissed menu back open a moment later.
        if (!wantsOpen) return;
        // Deliberately no app.focus({ steal: true }) here: activating the app is
        // what drags the user off a full-screen Space. The panel takes key focus
        // on its own, which is all the keyboard handling and blur-to-dismiss need.
        if (!menuWindow.isVisible()) menuWindow.show();
        menuWindow.focus();
        // Joining the active Space can resize a panel out from under the bounds
        // set above, so assert them once more now that it is actually on screen.
        positionMenu(size);
    });

    ipcMain.on('menu:close', hideMenu);

    ipcMain.on('menu:invoke', (_, id: string) => {
        if (id === 'quit') {
            hideMenu();
            return app.quit();
        }
        if (id === 'settings') {
            hideMenu();
            return openSettingsWindow();
        }

        const account = accountFromRowId(id);
        if (!account) return;

        // The popover stays open on the confirmation until the user clicks away,
        // so there is no timer here — blur is what dismisses it. copyAccountCode
        // can throw for a malformed secret (bad base32 that slipped past the
        // Settings save path — a hand-edited store file, an old demo file), and
        // an uncaught exception here would surface as Electron's main-process
        // error dialog with nothing copied and the popover stuck mid-render.
        let code: string;
        try {
            code = copyAccountCode(account);
        } catch (err) {
            console.error(`Could not generate a code for ${accountLabel(account)}:`, err);
            return;
        }
        menuWindow?.webContents.send('menu:copied', {
            issuer: account.issuer || account.account,
            code,
        });
    });

    ipcMain.handle('get-accounts', () => accounts);

    ipcMain.handle('save-accounts', (_, newAccounts: Account[]) => {
        // Settings' own Save handler already blocks this, but it's the only thing
        // that does — nothing stops some other or future write path from getting
        // here with two rows sharing one identity, which accountFromRowId() and
        // backfillIcons() would then silently resolve to whichever comes first.
        for (let i = 0; i < newAccounts.length; i++) {
            for (let j = i + 1; j < newAccounts.length; j++) {
                if (sameAccount(newAccounts[i]!, newAccounts[j]!)) {
                    throw new Error(
                        `Duplicate account identity: ${newAccounts[i]!.issuer}/${newAccounts[i]!.account}`,
                    );
                }
            }
        }

        // Re-apply any backfillIcons() hit/miss this save's snapshot predates —
        // see the comment on pendingIconUpdates above backfillIcons().
        for (const a of newAccounts) {
            if (a.icon) continue;
            const pending = pendingIconUpdates.get(identityKey(a));
            if (pending) Object.assign(a, pending);
        }
        pendingIconUpdates.clear();

        accounts = newAccounts;
        writeData(accounts);
        refreshMenu();
    });

    ipcMain.handle('fetch-favicon', (_, issuer: string) => fetchFavicon(issuer));

    ipcMain.handle('guess-favicon-domain', (_, issuer: string) => issuerToDomains(issuer)[0] || null);

    ipcMain.handle('show-emoji-panel', () => app.showEmojiPanel());

    backfillIcons().catch((err: unknown) => console.error('Icon backfill failed:', err));
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
