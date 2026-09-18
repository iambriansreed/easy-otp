/**
 * SKRAPA Types - managed by skrapa.
 *
 * Every skrapa command checks this file and rewrites it only when it differs
 * from the version bundled with your installed skrapa, so edits here are
 * overwritten on the next run. Do NOT add your own global types here; put
 * project globals in a separate `.d.ts` file instead.
 *
 * Types live under the `Skrapa` namespace so nothing shipped here can collide
 * with a type of your own. The four names outside it are the ones the compiler
 * and the runtime must find globally, by exactly these names: `jsx` and
 * `Fragment` are the JSX factory pair named in tsconfig.json and are called by
 * the emitted code, `JSX` is where TypeScript looks up intrinsic elements, and
 * `VERSION` is injected as a global at build time. Moving any of them into the
 * namespace makes every `<div>` fail to compile.
 */
declare global {
    namespace Skrapa {
        type CSSProps = Partial<CSSStyleDeclaration> & {
            [key: `--${string}`]: string | number; // Support for CSS variables (custom properties)
        };

        /**
         * One thing that may appear in a child position.
         *
         * `null`, `undefined` and booleans render as nothing, which is what
         * makes `{flag && <p>hi</p>}` work. A `string` or `number` renders as
         * escaped text, never as markup: to emit markup held in a string, wrap
         * it in {@link raw}.
         */
        type Child = JSX.Element | string | number | boolean | null | undefined;

        /**
         * What a child position accepts: one {@link Child}, or any nesting of
         * arrays of them. The recursion is deliberate, since a nested map
         * (`rows.map((r) => r.cells.map(...))`) produces arrays of arrays, and
         * every level is flattened when rendered.
         */
        type Children = Child | readonly Children[];

        type Props = {
            children?: never;
            style?: CSSProps;
        };

        type PropsWithChildren = {
            children?: Children;
            style?: CSSProps;
        };

        // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
        type Tag = string | Function;

        type Page =
            | JSX.Element
            | {
                  /**
                   * Replaces the text of the shell's <title> element. The shell
                   * must already contain a <title> tag; if it does not, this is
                   * ignored.
                   */
                  title?: string;
                  /** Appended to the shell's <body>, just before </body> */
                  body?: JSX.Element;
                  /** Appended to the shell's <head>, just before </head> */
                  head?: string;
                  /**
                   * Attributes to set on the shell's <html> and <body> elements. Anything the
                   * shell already set and you do not name here is left alone.
                   *
                   * A string overwrites: whatever the shell had for that attribute
                   * is gone. To build on the existing value instead, pass a
                   * function; it receives the shell's current value ('' if it set
                   * none) and returns the new one:
                   *
                   *     html: {
                   *         lang: 'fr',                            // overwrite
                   *         class: (prev) => `${prev} dark`,       // merge
                   *     }
                   */
                  shellAttrs?: {
                      /** Set on the shell's opening <html> tag. */
                      html?: Record<string, string | ((prev: string) => string)>;
                      /** Set on the shell's opening <body> tag. */
                      body?: Record<string, string | ((prev: string) => string)>;
                  };
              };

        /**
         * A base path, always leading-slash-prefixed: `"/"` for a site at the
         * domain root, `"/repo/"` for one served from a subpath.
         */
        type BasePath = `/${string}`;

        /**
         * A public origin including its scheme, e.g. `"https://dev.localhost"`.
         * `""` means nothing is proxying the dev server, so its URL is derived
         * from `host` and `port` instead.
         */
        type Origin = `${string}://${string}` | '';

        /**
         * What you write in `skrapa.config.ts`. Every field is optional: what you
         * leave out takes its default, and a CLI flag of the same name beats
         * whatever is here.
         *
         *     export default {
         *         input: 'src',
         *         port: 8080,
         *     } satisfies Skrapa.Config;
         *
         * This is the authoring shape. Skrapa merges it over the defaults, then
         * over the CLI flags, and normalizes the result before any command runs.
         */
        type Config = {
            /**
             * Input directory containing index.tsx and client.ts.
             *
             * It errors if the directory does not exist or if index.tsx is
             * missing. Watched in dev mode, where a change triggers a rebuild.
             * @default "src"
             */
            input?: string;
            /**
             * Output directory for built files. Created if it does not exist.
             *
             * In dev mode this directory is served, and watched so a change
             * triggers a reload.
             * @default "dist"
             */
            output?: string;
            /**
             * Static files copied to the output directory as-is, for things the
             * input references but does not import (images, fonts). Skipped with
             * a warning if the directory does not exist.
             *
             * In dev mode a created or changed file here is copied straight
             * through, without a full rebuild.
             *
             * The copy runs after the pages are rendered, so a file in here
             * whose path lands on a generated one would replace it. The build
             * fails instead, naming both sources and the output path; in dev
             * mode that copy is skipped and logged, leaving the server up.
             * @default "assets"
             */
            assets?: string;
            /**
             * Port for the dev server. If it is already in use, dev logs an
             * error and exits rather than silently picking another.
             *
             * Accepts a number or a numeric string, since a `--port` flag always
             * arrives as a string.
             * @default 8080
             */
            port?: number | `${number}`;
            /**
             * Network interface the dev server binds to. Use `"0.0.0.0"` to
             * accept connections from other devices on the network.
             *
             * This is the bind address only. To change the URL the site is
             * reached* at, see {@link Config.origin}.
             * @default "localhost"
             */
            host?: string;
            /**
             * Public origin the dev server is reached at when something sits in
             * front of it, e.g. a reverse proxy or tunnel mapping
             * `"https://dev.localhost"` to `"localhost:8080"`. Include the
             * scheme; the port is optional, so an origin with no port produces
             * URLs with no port.
             *
             * Cosmetic only: it changes the URL logged at startup, not what the
             * server binds to. Live reload needs nothing set here, since the
             * injected client derives its WebSocket URL from the page's own
             * location. The proxy does have to forward WebSocket upgrade
             * requests on `/hmr`.
             * @default ""
             */
            origin?: Origin;
            /**
             * Base URL path the site is served from, injected as `<base href>`
             * into every page's `<head>` so relative asset and link URLs resolve
             * from nested pages (e.g. `/about/`) rather than 404ing at
             * `/about/asset.svg`.
             *
             * For a GitHub Pages project site served under a subpath, set it to
             * the repo name, e.g. `"/my-site/"`. A trailing slash is added if
             * missing. Paths skrapa rewrites carry it; a root-relative URL you
             * write by hand has to carry it too, since `<base href>` does not
             * apply to those.
             * @default "/"
             */
            base?: BasePath;
            /**
             * URL globs the build's link check leaves alone, for paths served
             * by something other than the build: `['/api/**', '/uploads/*.pdf']`.
             * `*` matches within a path segment, `**` across them (a trailing
             * `/**` covers the path itself too), `?` one character. A
             * `--ignore` flag takes them comma-separated.
             * @default []
             */
            ignore?: readonly string[];
            /**
             * Directory that `input`, `output` and `assets` resolve against.
             *
             * Really a CLI flag. Skrapa looks for `skrapa.config.ts` in the
             * directory `--root` names, so setting this *inside* the config file
             * moves where the other paths resolve, but not where the file itself
             * was found.
             * @default process.cwd()
             */
            root?: string;
        };
    }

    function jsx(
        tag: Skrapa.Tag,
        props: Skrapa.Props | undefined,
        ...children: Skrapa.Children[]
    ): JSX.Element;

    /**
     * Mark HTML you built yourself as a {@link JSX.Element}, so it renders as
     * markup instead of being escaped.
     *
     * Every string reaching a child position is HTML-escaped, which is what
     * makes `{userName}` safe by default. `raw` is the deliberate way out, for
     * when you really do have markup sitting in a string:
     *
     *     export function Page(): Skrapa.Page {
     *         return raw(rows.map((r) => `<li>${r}</li>`).join(''));
     *     }
     *
     * Nothing here is escaped or checked. Whatever you pass is emitted verbatim,
     * so never build one out of untrusted input.
     */
    function raw(html: string): JSX.Element;

    // `var`, not `let`: only a var declaration becomes a property of
    // `typeof globalThis`, and index.ts assigns both through globalThis.

    /**
     * The `<>...</>` factory, named by tsconfig's `jsxFragmentFactory`. Renders
     * its children with no wrapping element.
     *
     * It has to be callable: TypeScript rejects `<>` outright ("does not have
     * any construct or call signatures") if this is anything else.
     */
    var Fragment: (props: Skrapa.PropsWithChildren) => JSX.Element;

    var VERSION: string;

    namespace JSX {
        interface IntrinsicElements {
            [elemName: string]: unknown;
        }
        /**
         * Names the prop that receives JSX children. TypeScript reads only the
         * key* here and ignores the value type, so the shape a child position
         * actually accepts lives on `jsx`'s rest parameter and on
         * {@link Skrapa.PropsWithChildren}, both {@link Skrapa.Children}.
         */
        interface ElementChildrenAttribute {
            children: Skrapa.Children;
        }
        /**
         * Rendered JSX.
         *
         * Deliberately *not* a string. Skrapa escapes every string that lands in
         * a child position, so an element has to be distinguishable from text at
         * runtime, not merely in the type system. That is what lets
         * `{<b>hi</b>}` render as markup while `{'<b>hi</b>'}` renders as
         * visible text.
         *
         * It stringifies to its HTML, so `String(el)` and `` `${el}` `` both
         * give the markup. To go the other way, from a string you built to an
         * element, use {@link raw}.
         */
        interface Element {
            /** Phantom brand. No such property exists on the value. */
            readonly __jsx: 'element';
            toString(): string;
        }
    }
}

export declare const Fragment = 'Fragment';
/** < SKRAPA Types */
