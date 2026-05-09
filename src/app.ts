import { app, Tray, Menu, nativeImage, dialog, safeStorage, Notification } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { getTimeBasedOTP } from './otp';
import { execSync } from 'node:child_process';

type Account = {
    account: string;
    secret: string;
    issuer: string;
};

const DATA_PATH = path.join(app.getPath('userData'), 'accounts.enc');

let tray: Tray | null = null;
let lastUpdated = 0;
let lastClickedAccount: Account | null = null;
const selectedForRemoval = new Set<string>();

function accountKey(a: Account) {
    return a.issuer + a.account;
}

const onAccountClick = (a: Account) => () => {
    lastClickedAccount = a;
    setTimeout(() => {
        lastClickedAccount = null;
        tray?.popUpContextMenu(mainMenu());
    }, 60 * 1000);

    new Notification({
        title: 'OTP Copied',
        body: `Copied code for ${accountLabel(a)}`,
        silent: true,
    }).show();

    execSync(`printf '%s' "${getTimeBasedOTP(a.secret)}" | pbcopy`);
};

const onAccountRemove = (a: Account) => () => {
    const key = accountKey(a);
    if (selectedForRemoval.has(key)) selectedForRemoval.delete(key);
    else selectedForRemoval.add(key);
    tray?.setContextMenu(removeAccountsMenu());
    setTimeout(() => tray?.popUpContextMenu(removeAccountsMenu()), 300);
};

let accounts = readData() || [];

function decode(s: string) {
    try {
        return decodeURIComponent(s);
    } catch {
        return s;
    }
}

function accountLabel(a: Account) {
    return `${decode(a.issuer)}: ${decode(a.account)}`;
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

function writeData(data: any) {
    fs.writeFileSync(DATA_PATH, safeStorage.encryptString(JSON.stringify(data)), 'utf-8');
}

let mainMenu: () => Menu = () => {
    const updatedLessThanOneMinuteAgo = Date.now() - lastUpdated < 60 * 1000;

    return Menu.buildFromTemplate(
        [
            lastClickedAccount
                ? {
                      label: `Last clicked: ${lastClickedAccount.issuer}: ${lastClickedAccount.account}`,
                      enabled: false,
                      type: 'header',
                  }
                : [],
            // if updated is less 1 minute ago, show "Updated just now", otherwise show "Updated X seconds ago"
            updatedLessThanOneMinuteAgo
                ? [
                      {
                          label: `Update Successful`,
                          enabled: false,
                          type: 'normal',
                          role: 'fileMenu',
                      },

                      { type: 'separator' },
                  ]
                : [],

            ...accounts.map((a) => {
                const label = accountLabel(a);
                const isLastClicked =
                    lastClickedAccount &&
                    lastClickedAccount.account === a.account &&
                    lastClickedAccount.issuer === a.issuer;
                return {
                    label: isLastClicked ? `${label} ✅ ` : label,
                    type: 'normal',
                    click: onAccountClick(a),
                };
            }),
            { type: 'separator' },
            {
                label: 'Remove account...',
                click: () => {
                    tray?.setContextMenu(removeAccountsMenu());
                    setTimeout(() => tray?.popUpContextMenu(removeAccountsMenu()), 300);
                },
            },
            {
                label: 'Update accounts...',
                click: updateAccounts,
                icon: nativeImage
                    .createFromPath(path.join(app.getAppPath(), 'assets/update.png'))
                    .resize({ width: 16, height: 16 }),
                type: 'normal',
                sublabel: 'Select a JSON file',
            },
            { type: 'separator' },
            {
                label: 'Notification Settings',
                click: () => {
                    execSync('open "x-apple.systempreferences:com.apple.preference.notifications"');
                },
            },
            { type: 'separator' },
            {
                label: 'Quit',
                accelerator: 'CommandOrControl+Q',
                click: () => {
                    app.quit();
                },
            },
        ]
            .flat()
            .filter(Boolean) as Electron.MenuItemConstructorOptions[],
    );
};

const removeAccountsMenu = (): Menu => {
    const count = selectedForRemoval.size;
    return Menu.buildFromTemplate([
        { label: 'Select accounts to remove:', enabled: false },
        { type: 'separator' },
        ...accounts.map((a) => ({
            label: accountLabel(a),
            type: 'checkbox' as const,
            checked: selectedForRemoval.has(accountKey(a)),
            click: onAccountRemove(a),
        })),
        { type: 'separator' },
        {
            label: count > 0 ? `Remove ${count} selected...` : 'Remove selected...',
            enabled: count > 0,
            click: () => {
                tray?.setContextMenu(removeAccountConfirmMenu());
                setTimeout(() => tray?.popUpContextMenu(removeAccountConfirmMenu()), 300);
            },
        },
        {
            label: 'Cancel',
            click: () => {
                selectedForRemoval.clear();
                tray?.setContextMenu(mainMenu());
                setTimeout(() => tray?.popUpContextMenu(mainMenu()), 300);
            },
        },
    ]);
};

const removeAccountConfirmMenu = (): Menu => {
    const toRemove = accounts.filter((a) => selectedForRemoval.has(accountKey(a)));
    return Menu.buildFromTemplate([
        { label: `Remove ${toRemove.length} account${toRemove.length !== 1 ? 's' : ''}?`, enabled: false },
        { type: 'separator' },
        ...toRemove.map((a) => ({ label: `  ${accountLabel(a)}`, enabled: false })),
        { type: 'separator' },
        {
            label: 'Confirm',
            click: () => {
                accounts = accounts.filter((a) => !selectedForRemoval.has(accountKey(a)));
                selectedForRemoval.clear();
                writeData(accounts);
                tray?.setContextMenu(mainMenu());
                new Notification({
                    title: `${toRemove.length} Account${toRemove.length !== 1 ? 's' : ''} Removed`,
                    body: toRemove.map(accountLabel).join(', '),
                    silent: true,
                }).show();
            },
        },
        {
            label: 'Cancel',
            click: () => {
                selectedForRemoval.clear();
                tray?.setContextMenu(mainMenu());
                setTimeout(() => tray?.popUpContextMenu(mainMenu()), 300);
            },
        },
    ]);
};

app.whenReady().then(() => {
    tray = new Tray(
        nativeImage
            .createFromPath(path.join(app.getAppPath(), 'assets/icon.png'))
            .resize({ width: 16, height: 16 }),
    );

    // Set the context menu for the tray icon
    tray.setContextMenu(mainMenu());

    // Set a tooltip
    tray.setToolTip('Easy OTP - Click to view accounts');

    // Handle clicks to show/hide a window (optional, can be done with the menu items instead)
    tray.on('click', () => {});
});

// Ensure the app quits when all windows are closed (except on macOS where they usually stay open until explicitly quit)
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

function updateAccounts() {
    // Bring app to foreground so the dialog is visible (macOS tray-only apps need this)
    app.focus({ steal: true });

    dialog
        .showOpenDialog({
            title: 'Select accounts file',
            properties: ['openFile'],
            filters: [{ name: 'JSON Files', extensions: ['json'] }],
        })
        .then((result) => {
            if (result.canceled) return;

            const filePath = result.filePaths[0]!;

            if (fs.existsSync(filePath) === false) {
                dialog.showErrorBox(
                    'Error',
                    'The selected file does not exist. Please select a valid JSON file.',
                );
                return;
            }

            try {
                const fileContent = fs.readFileSync(filePath, 'utf-8');
                const newAccounts = JSON.parse(fileContent);

                // validate the data is an array of accounts with the correct shape
                if (!Array.isArray(newAccounts)) {
                    throw new Error('Data must be an array of accounts');
                }

                for (const account of newAccounts) {
                    if (typeof account !== 'object' || account === null) {
                        throw new Error('Each account must be an object');
                    }

                    if (
                        !(
                            'account' in account &&
                            'secret' in account &&
                            'issuer' in account &&
                            typeof account.account === 'string' &&
                            typeof account.secret === 'string' &&
                            typeof account.issuer === 'string'
                        )
                    ) {
                        throw new Error(
                            'Each account must have an account, secret, and issuer. Found: ' +
                                JSON.stringify(account),
                        );
                    }
                }

                const decodedAccounts: Account[] = newAccounts.map((a: Account) => ({
                    ...a,
                    issuer: decode(a.issuer),
                    account: decode(a.account),
                }));

                const existingKeys = new Set(accounts.map((a) => a.account + a.issuer));
                const added = decodedAccounts.filter((a: Account) => !existingKeys.has(a.account + a.issuer));
                const updated = decodedAccounts.filter((a: Account) =>
                    existingKeys.has(a.account + a.issuer),
                );

                accounts = accounts
                    .concat(decodedAccounts)
                    .filter(
                        (account, index, self) =>
                            index ===
                            self.findIndex((a) => a.account + a.issuer === account.account + account.issuer),
                    );

                writeData(accounts);
                tray?.popUpContextMenu(mainMenu());
                lastUpdated = Date.now();

                const parts = [];
                if (added.length) parts.push(`${added.length} added`);
                if (updated.length) parts.push(`${updated.length} already existed`);
                new Notification({
                    title: 'Accounts Updated',
                    body: parts.join(', ') || 'No changes',
                    silent: true,
                }).show();
            } catch (err) {
                dialog.showErrorBox(
                    'Error',
                    `Failed to read the selected file. Please make sure it is a valid JSON file. ${err}`,
                );
                return;
            }
        })
        .catch((err) => {
            console.error(err);
        });
}
