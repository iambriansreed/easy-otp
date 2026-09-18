import { esc } from './shared.mjs';

interface Row {
    type: string;
    label?: string;
    accelerator?: string;
    enabled?: boolean;
    id?: string;
    icon?: string;
    emoji?: string;
}

declare global {
    interface Window {
        menu: {
            items: () => Promise<{ rows: Row[]; accent: string }>;
            ready: (size: { width: number; height: number }) => void;
            invoke: (id: string) => void;
            close: () => void;
            onRefresh: (fn: (payload?: { rows: Row[]; accent: string }) => void) => void;
            onCopied: (fn: (data: { issuer: string; code: string }) => void) => void;
        };
    }
}

const menuEl = document.getElementById('menu')!;

/** Indices into `rows` that the pointer and arrow keys can land on. */
let rows: Row[] = [];
let selectable: number[] = [];
let active = -1;

function iconHtml(row: Row): string {
    if (row.icon) return `<span class="icon"><img src="${esc(row.icon)}" alt=""></span>`;
    if (row.emoji) return `<span class="icon">${esc(row.emoji)}</span>`;
    return '';
}

/** Stable DOM id for a row, distinct from `row.id` (the account identity used
 *  for `menu:invoke`) — this one is only for aria-activedescendant to point at. */
const domId = (index: number) => `menu-item-${index}`;

function rowHtml(row: Row, index: number): string {
    // A separator isn't one of ARIA's listed valid children of role="menu", but
    // it's the widely-supported practical pattern for exposing a divider to
    // screen readers, and every major AT handles it.
    if (row.type === 'separator') return '<div class="separator" role="separator"></div>';
    if (row.type === 'header') {
        // Reads out like a disabled entry rather than being silently skipped —
        // there's no ARIA role for a plain section label as a menu's direct
        // child, and a native menu's header is exposed the same way.
        return `<div class="header" id="${domId(index)}" role="menuitem" aria-disabled="true">${esc(row.label)}</div>`;
    }

    const trailing = row.accelerator || '';
    return `
                <div
                    class="row ${row.enabled ? '' : 'disabled'}"
                    id="${domId(index)}"
                    role="menuitem"
                    aria-disabled="${row.enabled ? 'false' : 'true'}"
                    data-index="${index}"
                >
                    ${iconHtml(row)}
                    <span class="label">${esc(row.label)}</span>
                    <span class="trailing">${esc(trailing)}</span>
                </div>
            `;
}

function paintActive() {
    menuEl.querySelectorAll<HTMLElement>('.row').forEach((el) => {
        el.classList.toggle('active', Number(el.dataset.index) === active);
    });
    // The active row never receives real DOM focus (arrow-key navigation moves
    // a CSS class, not focus, so a native menu's own key handling — all of it
    // bound to `window` — isn't disturbed); aria-activedescendant is what tells
    // a screen reader which one to announce as current instead.
    const activeEl = active === -1 ? null : document.getElementById(domId(active));
    if (activeEl) menuEl.setAttribute('aria-activedescendant', activeEl.id);
    else menuEl.removeAttribute('aria-activedescendant');
}

function setActive(index: number) {
    active = index;
    paintActive();
}

/** Step through selectable rows, wrapping at both ends like a real menu. */
function move(delta: number): void {
    if (!selectable.length) return;
    const at = selectable.indexOf(active);
    const next =
        at === -1
            ? delta > 0
                ? 0
                : selectable.length - 1
            : (at + delta + selectable.length) % selectable.length;
    const idx = selectable[next];
    if (idx !== undefined) setActive(idx);
}

function activate(index: number) {
    const row = rows[index];
    if (!row || !row.id || !row.enabled) return;
    window.menu.invoke(row.id);
}

/**
 * Natural size of the content, the way a native menu sizes to its widest
 * item. Width is read with the list briefly unconstrained; the window is
 * whatever it was from the previous open, which must not influence this.
 */
function measure() {
    menuEl.style.width = 'max-content';
    const width = menuEl.scrollWidth;
    menuEl.style.width = '';
    // scrollHeight covers the full content even while max-height clips it
    return { width: width + 1, height: menuEl.scrollHeight };
}

/**
 * `payload` is provided on every refresh after the window's first: main sends
 * it directly alongside the 'menu:refresh' event since it already computed it
 * to build that event, saving the renderer a round trip back to fetch the same
 * thing via 'menu:items'. Only the very first call — the window's own bootstrap
 * at the bottom of this file, made before any refresh has been sent — has
 * nothing to receive it from and asks for it directly.
 */
async function render(payload?: { rows: Row[]; accent: string }): Promise<void> {
    const { rows: next, accent } = payload ?? (await window.menu.items());
    rows = next;
    selectable = rows
        .map((r, i) => (r.type === 'item' && r.enabled && r.id ? i : -1))
        .filter((i): i is number => i !== -1);
    active = -1;

    document.documentElement.style.setProperty('--accent', accent);
    menuEl.innerHTML = rows.map(rowHtml).join('');
    menuEl.scrollTop = 0;
    // Clears aria-activedescendant left over from the torn-down previous
    // render, since it points at a row id that no longer exists.
    paintActive();
    // Real DOM focus on the container (not any one row) is what makes a screen
    // reader honour aria-activedescendant; the panel already has macOS key
    // focus (menuWindow.focus() in main), so this doesn't steal focus from
    // anything else.
    menuEl.focus();

    // Measured synchronously on purpose. Reading scrollWidth forces a
    // layout, so the size is already correct here — and waiting for a
    // frame would be fatal: reopening happens while the window is still
    // hidden, and a hidden window paints no frames, so a
    // requestAnimationFrame callback would never run and the menu would
    // open exactly once.
    window.menu.ready(measure());
}

menuEl.addEventListener('mousemove', (e: MouseEvent) => {
    const row = (e.target as Element).closest('.row');
    const index =
        row && !row.classList.contains('disabled') ? Number((row as HTMLElement).dataset.index) : -1;
    if (index !== active) setActive(index);
});

menuEl.addEventListener('mouseleave', () => setActive(-1));

menuEl.addEventListener('click', (e: MouseEvent) => {
    const row = (e.target as Element).closest('.row');
    if (row && !row.classList.contains('disabled')) activate(Number((row as HTMLElement).dataset.index));
});

window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape') return window.menu.close();
    // e.code (physical key), not e.key: e.key is 'Q' under Caps Lock and a
    // different character entirely on non-Latin layouts, either of which would
    // silently make ⌘Q do nothing.
    if (e.code === 'KeyQ' && e.metaKey) return window.menu.invoke('quit');
    if (e.key === 'ArrowDown') {
        e.preventDefault();
        return move(1);
    }
    if (e.key === 'ArrowUp') {
        e.preventDefault();
        return move(-1);
    }
    if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        return activate(active);
    }
});

// Right-clicking inside a menu should do nothing
window.addEventListener('contextmenu', (e: Event) => e.preventDefault());

/**
 * Throw the menu away and stand the confirmation in its place, then
 * report the new size so the popover shrinks around it. Nothing is
 * selectable any more — the popover stays open until blur dismisses it,
 * there is no auto-close timer.
 */
function showCopied({ issuer, code }: { issuer: string; code: string }): void {
    rows = [];
    selectable = [];
    active = -1;
    menuEl.removeAttribute('aria-activedescendant');

    menuEl.innerHTML = `
                <div class="confirm" role="status">
                    <span class="issuer">${esc(issuer)}</span>
                    <span class="word">Copied</span>
                    <span class="code">${esc(code)}</span>
                </div>
            `;
    window.menu.ready(measure());
}

window.menu.onCopied(showCopied);
window.menu.onRefresh(render);
void render();
