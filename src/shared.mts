/**
 * Helpers shared between the two renderers (`menu.mts`, `settings.mts`). Both are
 * ES modules compiled to sibling `.mjs` files in `dist/`, so they can import this
 * directly — unlike the main process (`app.ts`, CommonJS), which can't statically
 * import an ESM module and keeps its own small copies of anything it also needs.
 */

/**
 * Escapes a value for interpolation into an HTML template string. `s ?? ''`
 * (not `String(s)`) is what makes a missing issuer/account render as nothing
 * instead of the literal text "undefined".
 */
export const esc = (s: unknown): string =>
    String(s ?? '').replace(
        /[&<>"']/g,
        (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] || c,
    );
