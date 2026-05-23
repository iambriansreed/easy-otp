# Easy OTP

A macOS menu bar app for managing TOTP (Time-based One-Time Password) accounts. Click an account to copy its current OTP code to the clipboard.

## Download

![Latest Release](https://img.shields.io/github/v/release/iambriansreed/easy-otp?label=latest)

[Download Easy OTP.dmg](https://github.com/iambriansreed/easy-otp/releases/latest)

Requires macOS. Since the app is unsigned, right-click → Open on first launch to bypass Gatekeeper.

## Development

### Prerequisites

- macOS
- Node.js 22+

## Setup

```sh
npm install
```

## Icon

A default `build/icon.icns` is included — no action needed to get started.

If you want to use your own icon, replace `assets/icon.svg` and run:

```sh
npm run make-icons
```

This regenerates `build/icon.icns` from your SVG (requires macOS and `npm install`).

## Development

```sh
npm start
```

Compiles TypeScript and launches the app via Electron. The tray icon will appear in your menu bar.

## Build

```sh
npm run pack   # builds a local .app (no installer, fastest for testing)
npm run dist   # builds a distributable .dmg
```

Output goes to `dist/`.

## Accounts

Accounts are stored encrypted on disk using Electron's `safeStorage`. You manage them through the app itself.

### Adding accounts

From the menu bar → **Easy OTP Settings...** → Add Account. Two options:

- **From URL** — paste an `otpauth://totp/...` URI (e.g. from a QR code scanner)
- **Manual** — enter Issuer, Account, and Secret directly
- **Import File** — select a `.txt` file with one `otpauth://` URL per line

Importing merges with existing accounts. Accounts with the same `issuer` + `account` combination are updated in place.

### Editing & removing accounts

Open **Easy OTP Settings...** → click **Edit** on any account to update its fields, or **×** to delete it. Drag the handle on the left to reorder.

### Copying an OTP

Click any account in the menu bar to copy its current 6-digit TOTP code to the clipboard. A notification will confirm the copy.

## Scripts

| Script               | Description                                                      |
| -------------------- | ---------------------------------------------------------------- |
| `npm start`          | Run in development mode                                          |
| `npm run pack`       | Build a local `.app` for testing                                 |
| `npm run dist`       | Build a distributable `.dmg`                                     |
| `npm run make-icons` | _(Optional)_ Regenerate `build/icon.icns` from `assets/icon.svg` |
