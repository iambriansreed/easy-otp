import { GitHubLink } from './components/github-link';

const RELEASE_URL = 'https://github.com/iambriansreed/easy-otp/releases/latest';
const BUILD_COMMAND =
    'git clone https://github.com/iambriansreed/easy-otp.git && cd easy-otp && npm install && npm run make-icons && npm run build';

export function Page(): Skrapa.Page {
    return (
        <>
            <header class="nav">
                <a href="./" class="brand">
                    <img src="logo.png" alt="" width="28" height="28" />
                    Easy OTP
                </a>
                <nav>
                    <a href="development/">Development</a>
                    <GitHubLink />
                </nav>
            </header>

            <section class="hero">
                <div class="logo" role="img" aria-label="Easy OTP logo"></div>
                <h1>Easy OTP</h1>
                <p class="tagline">
                    Two-factor codes in your Mac's menu bar. Click an account and its current code is
                    copied to the clipboard.
                </p>
                <div class="cta-row">
                    <a class="btn btn-primary" href={RELEASE_URL}>
                        Download for macOS
                    </a>
                    <a class="btn btn-secondary" href="#download">
                        Install instructions
                    </a>
                </div>
                <img
                    class="badge"
                    src="https://img.shields.io/github/v/release/iambriansreed/easy-otp?label=latest"
                    alt="Latest release"
                    width="105"
                    height="20"
                />
                <img
                    class="screenshot screenshot-hero"
                    src="screenshot-menu.png"
                    alt="The Easy OTP menu listing accounts with their service icons, with GitHub highlighted"
                    width="354"
                    height="369"
                />
            </section>

            <section class="download" id="download">
                <h2>Download and install</h2>
                <p class="lede">Requires macOS.</p>
                <div class="cta-row">
                    <a class="btn btn-primary" href={RELEASE_URL}>
                        Download Easy OTP.dmg
                    </a>
                    <img
                        class="badge"
                        src="https://img.shields.io/github/v/release/iambriansreed/easy-otp?label=latest"
                        alt="Latest release"
                        width="105"
                        height="20"
                    />
                </div>
                <div class="prose">
                    <ol>
                        <li>
                            Open the downloaded <code>.dmg</code> and drag Easy OTP into Applications.
                        </li>
                        <li>
                            The app isn't signed, so macOS may block it. Try these approaches:
                            <ul>
                                <li>
                                    <strong>Right-click method:</strong> In Applications, right-click Easy
                                    OTP, choose <strong>Open</strong>, then click <strong>Open</strong> in
                                    the dialog.
                                </li>
                                <li>
                                    <strong>Terminal method (macOS 15+):</strong> Run this and open the app
                                    again:
                                    <div class="code-block">
                                        <pre>
                                            <code>xattr -dr com.apple.quarantine "/Applications/Easy OTP.app"</code>
                                        </pre>
                                        <button class="copy-btn" type="button">
                                            Copy
                                        </button>
                                    </div>
                                </li>
                                <li>
                                    <strong>Settings method:</strong> Check System Settings → Privacy &
                                    Security → App Management for any blocked app notification and allow it.
                                </li>
                            </ul>
                        </li>
                        <li>
                            Click the Easy OTP icon in the menu bar and choose{' '}
                            <strong>Easy OTP Settings...</strong> to add your first account.
                        </li>
                    </ol>
                </div>
            </section>

            <section class="build-locally">
                <h2>Build from source</h2>
                <p class="lede">Requires macOS and Node.js 22 or later.</p>
                <div class="code-block">
                    <pre>
                        <code>{BUILD_COMMAND}</code>
                    </pre>
                    <button class="copy-btn" type="button">
                        Copy
                    </button>
                </div>
                <p class="sub">
                    The installer is written to <code>easy-otp/dist/Easy OTP-&lt;version&gt;-arm64.dmg</code>
                    . The <a href="development/">development guide</a> covers the other scripts.
                </p>
            </section>

            <section class="usage" id="guide">
                <h2>Using Easy OTP</h2>
                <div class="usage-layout">
                    <div class="prose">
                        <h3>Adding accounts</h3>
                        <p>
                            Click the Easy OTP icon in the menu bar and choose{' '}
                            <strong>Easy OTP Settings...</strong>. The <strong>Add Account</strong>{' '}
                            section has three tabs:
                        </p>
                        <ul>
                            <li>
                                <strong>From URL</strong>: paste an <code>otpauth://totp/</code> URL,
                                like the one encoded in a setup QR code.
                            </li>
                            <li>
                                <strong>Manual</strong>: enter the issuer, account name, and secret,
                                and optionally choose a favicon or an emoji.
                            </li>
                            <li>
                                <strong>Import File</strong>: click or drop a <code>.txt</code> file
                                with one <code>otpauth://</code> URL per line. Easy OTP reports how
                                many accounts were added, updated, and skipped.
                            </li>
                        </ul>
                        <p>
                            Accounts are matched by issuer and account name, so adding one you already
                            have updates it instead of creating a copy. Imports keep any icon you
                            already chose.
                        </p>

                        <h3>Copying a code</h3>
                        <p>
                            Click an account in the menu. Its code is copied to the clipboard, and the
                            menu shows the issuer and code in large type until you click somewhere
                            else. For the next minute, the top of the menu shows which account you
                            copied last.
                        </p>
                        <img
                            class="screenshot"
                            src="screenshot-copied.png"
                            alt="The copy confirmation showing GitHub, the word Copied, and a six-digit code"
                            width="311"
                            height="58"
                            loading="lazy"
                            decoding="async"
                        />
                        <p>
                            With the menu open, <kbd>Up Arrow</kbd> and <kbd>Down Arrow</kbd> move the
                            highlight, <kbd>Return</kbd> or <kbd>Space</kbd> copies, and <kbd>Esc</kbd>{' '}
                            closes it. <kbd>Command-Q</kbd> quits, or use the <strong>Quit Easy OTP</strong>{' '}
                            item at the bottom of the menu.
                        </p>

                        <h3>Icons</h3>
                        <p>
                            If you add an account without an emoji, Easy OTP guesses the service's
                            website from the issuer name and fetches its icon. Any account still
                            missing an icon is filled in the next time the app starts, or right away
                            with <strong>Find Missing Icons</strong>, which appears in Settings whenever
                            an account has no icon.
                        </p>
                        <p>
                            To fix a wrong or missing icon, click <strong>Edit</strong> on the account.
                            With <strong>Favicon</strong> selected, type the service's website and the
                            icon is looked up as you type. Choose <strong>Emoji</strong> to open the
                            macOS emoji picker instead.
                        </p>
                        <img
                            class="screenshot"
                            src="screenshot-edit.png"
                            alt="An account open for editing, with its issuer, account name, secret, and favicon website fields"
                            width="464"
                            height="193"
                            loading="lazy"
                            decoding="async"
                        />
                        <p>
                            In the menu, icons stay grey until you point at an account, then show in
                            full color.
                        </p>

                        <h3>Organizing</h3>
                        <p>
                            Drag the handle on the left of an account to change its position in the
                            menu. The eye button hides an account from the menu; it stays in Settings
                            marked <strong>Hidden</strong>. <strong>Edit</strong> changes an account's
                            details and <strong>×</strong> deletes it.
                        </p>

                        <h3>Privacy</h3>
                        <p>
                            Accounts are saved to one file on your Mac, encrypted with Electron's{' '}
                            <code>safeStorage</code>. The only network requests Easy OTP makes are icon
                            lookups, which send a website name to DuckDuckGo's icon service, and to
                            Google's only when DuckDuckGo has no icon for it. Secrets are never sent
                            anywhere.
                        </p>

                        <h3>Supported codes</h3>
                        <p>
                            Easy OTP generates standard TOTP codes: 6 digits, a new code every 30
                            seconds, using SHA-1. Accounts set up for 8 digits, a different interval,
                            another algorithm, or counter-based (HOTP) codes won't work.
                        </p>
                    </div>
                    <img
                        class="screenshot"
                        src="screenshot-settings.png"
                        alt="The Easy OTP Settings window listing accounts with icons, one marked Hidden, above the Add Account form"
                        width="480"
                        height="800"
                        loading="lazy"
                        decoding="async"
                    />
                </div>
            </section>

            <footer>
                <p>
                    <a href="https://github.com/iambriansreed/easy-otp" target="_blank" rel="noopener">
                        GitHub
                    </a>{' '}
                    · ISC License · Built with{' '}
                    <a href="https://skrapa.iambrian.com" target="_blank" rel="noopener">
                        Skrapa
                    </a>
                </p>
            </footer>
        </>
    );
}
