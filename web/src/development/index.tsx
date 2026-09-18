import { GitHubLink } from '../components/github-link';

const SETUP_COMMAND =
    'git clone https://github.com/iambriansreed/easy-otp.git && cd easy-otp && npm install';

export function Page(): Skrapa.Page {
    return (
        <>
            <header class="nav">
                <a href="./" class="brand">
                    <img src="logo.png" alt="" width="28" height="28" />
                    Easy OTP
                </a>
                <nav>
                    <a href="./">Home</a>
                    <GitHubLink />
                </nav>
            </header>

            <div class="center">
                <h1>Development</h1>
                <div class="prose">
                    <h2>Prerequisites</h2>
                    <ul>
                        <li>macOS. The app relies on macOS-only features and won't run elsewhere.</li>
                        <li>Node.js 22 or later.</li>
                        <li>Node.js 24 or later, only if you also want to run the website locally.</li>
                    </ul>

                    <h2>Setup</h2>
                    <div class="code-block">
                        <pre>
                            <code>{SETUP_COMMAND}</code>
                        </pre>
                        <button class="copy-btn" type="button">
                            Copy
                        </button>
                    </div>
                    <p>
                        The <code>build/</code> folder isn't committed, so generate the app icon once
                        before packaging:
                    </p>
                    <div class="code-block">
                        <pre>
                            <code>npm run make-icons</code>
                        </pre>
                        <button class="copy-btn" type="button">
                            Copy
                        </button>
                    </div>
                    <p>
                        This creates <code>build/icon.icns</code> from <code>assets/icon.svg</code>{' '}
                        using macOS's <code>iconutil</code> and sharp. To use a different icon, replace
                        the SVG and run it again.
                    </p>

                    <h2>Running the app</h2>
                    <div class="code-block">
                        <pre>
                            <code>npm start</code>
                        </pre>
                        <button class="copy-btn" type="button">
                            Copy
                        </button>
                    </div>
                    <p>
                        Compiles the TypeScript into <code>dist/</code> and launches Electron. The Easy
                        OTP icon appears in the menu bar.
                    </p>
                    <div class="code-block">
                        <pre>
                            <code>npm run dev</code>
                        </pre>
                        <button class="copy-btn" type="button">
                            Copy
                        </button>
                    </div>
                    <p>
                        Restarts the app whenever a file in <code>src/</code> changes, and runs the
                        website's dev server alongside it. Press Control-C to stop both.
                    </p>
                    <p>
                        Only one copy of Easy OTP can run at a time. If another copy is already open, a
                        new launch quits straight away, so close the installed app first.
                    </p>

                    <h2>Demo mode</h2>
                    <div class="code-block">
                        <pre>
                            <code>npm run demo</code>
                        </pre>
                        <button class="copy-btn" type="button">
                            Copy
                        </button>
                    </div>
                    <p>
                        Runs the app with the sample accounts in <code>scripts/demo-data.txt</code>{' '}
                        instead of your saved ones, and restarts it when <code>src/</code> changes. Use
                        it for screenshots and for testing without real secrets.
                    </p>
                    <p>
                        A demo run keeps its data in a separate temporary folder, so it never reads or
                        changes your real accounts, and it can run alongside the installed app. To load
                        a different file, run <code>npm run demo -- path/to/urls.txt</code>.
                    </p>

                    <h2>Building</h2>
                    <div class="code-block">
                        <pre>
                            <code>npm run pack</code>
                        </pre>
                        <button class="copy-btn" type="button">
                            Copy
                        </button>
                    </div>
                    <p>
                        Builds an unpacked <code>.app</code> in <code>dist/</code>. This is the quickest
                        way to test the packaged app.
                    </p>
                    <div class="code-block">
                        <pre>
                            <code>npm run build</code>
                        </pre>
                        <button class="copy-btn" type="button">
                            Copy
                        </button>
                    </div>
                    <p>
                        Builds the distributable <code>.dmg</code> in <code>dist/</code>.
                    </p>

                    <h2>Releasing</h2>
                    <div class="code-block">
                        <pre>
                            <code>npm run release</code>
                        </pre>
                        <button class="copy-btn" type="button">
                            Copy
                        </button>
                    </div>
                    <p>
                        Bumps the patch version and pushes the commit and its tag. The tag starts a
                        GitHub Actions workflow that builds an unsigned <code>.dmg</code> and attaches
                        it to a GitHub release.
                    </p>

                    <h2>How it works</h2>

                    <h3>Storage</h3>
                    <p>
                        Accounts are saved as <code>accounts.enc</code> in the app's user data folder,
                        encrypted with Electron's <code>safeStorage</code>. If that file can't be
                        decrypted, it is deleted and the app starts with no accounts.
                    </p>

                    <h3>Codes</h3>
                    <p>
                        <code>src/otp.ts</code> generates RFC 6238 codes with 6 digits, a 30-second
                        step, and HMAC-SHA1. The <code>algorithm</code>, <code>digits</code>, and{' '}
                        <code>period</code> parameters of an <code>otpauth://</code> URL are ignored.
                    </p>

                    <h3>Icons</h3>
                    <p>
                        <code>src/favicon.ts</code> turns an issuer name into likely domains and asks
                        DuckDuckGo's icon service for each one, then Google's if DuckDuckGo had
                        nothing. Electron can't read <code>.ico</code>{' '}
                        files, so the file includes its own ICO decoder. Icons are stored with the
                        account as 32x32 PNG data URLs, and lookups are cached until the app quits.
                    </p>

                    <h3>The menu</h3>
                    <p>
                        The menu bar dropdown is a frameless panel window (<code>src/menu.html</code>)
                        rather than a native menu. A native menu can't show grey icons that take on
                        color when highlighted, or use custom row spacing. The comments in{' '}
                        <code>src/app.ts</code> explain the focus and Spaces handling this needs, and
                        are worth reading before changing it.
                    </p>

                    <h2>Scripts</h2>
                    <table>
                        <thead>
                            <tr>
                                <th>Script</th>
                                <th>Description</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td>
                                    <code>npm start</code>
                                </td>
                                <td>Compile and launch the app</td>
                            </tr>
                            <tr>
                                <td>
                                    <code>npm run dev</code>
                                </td>
                                <td>Relaunch the app on changes and run the website dev server</td>
                            </tr>
                            <tr>
                                <td>
                                    <code>npm run demo</code>
                                </td>
                                <td>Run the app with the sample accounts in scripts/demo-data.txt</td>
                            </tr>
                            <tr>
                                <td>
                                    <code>npm run pack</code>
                                </td>
                                <td>Build an unpacked .app for testing</td>
                            </tr>
                            <tr>
                                <td>
                                    <code>npm run build</code>
                                </td>
                                <td>Build a distributable .dmg</td>
                            </tr>
                            <tr>
                                <td>
                                    <code>npm run make-icons</code>
                                </td>
                                <td>Generate build/icon.icns from assets/icon.svg</td>
                            </tr>
                            <tr>
                                <td>
                                    <code>npm run release</code>
                                </td>
                                <td>Bump the patch version and push a release tag</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                <p class="sub">
                    <a class="back" href="./">
                        Back to home
                    </a>
                </p>
            </div>
        </>
    );
}
