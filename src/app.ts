import { app, Tray, Menu, nativeImage, dialog, safeStorage, Notification } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { getTimeBasedOTP } from './otp-service';
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

const onAccountClick = (a: Account) => () => {
    console.log(`Clicked on account: ${accountLabel(a)}`);
    // tray?.popUpContextMenu(contextMenu());
    lastClickedAccount = a;
    setTimeout(() => {
        lastClickedAccount = null;
        tray?.popUpContextMenu(contextMenu());
    }, 60 * 1000);

    // In onAccountClick:
    new Notification({
        title: 'OTP Copied',
        body: `Copied code for `,
        silent: true,
    }).show();

    // copy to clipboard
    execSync(`printf '%s' "${getTimeBasedOTP(a.secret)}" | pbcopy`);
};

let accounts = readData() || [];

console.log(accounts);

function accountLabel(a: Account) {
    return decodeURIComponent(`${a.issuer}: ${a.account}`);
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
            console.log(parsedData);
            return parsedData;
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

type role =
    | 'undo'
    | 'redo'
    | 'cut'
    | 'copy'
    | 'paste'
    | 'pasteAndMatchStyle'
    | 'delete'
    | 'selectAll'
    | 'reload'
    | 'forceReload'
    | 'toggleDevTools'
    | 'resetZoom'
    | 'zoomIn'
    | 'zoomOut'
    | 'toggleSpellChecker'
    | 'togglefullscreen'
    | 'window'
    | 'minimize'
    | 'close'
    | 'help'
    | 'about'
    | 'services'
    | 'hide'
    | 'hideOthers'
    | 'unhide'
    | 'quit'
    | 'startSpeaking'
    | 'stopSpeaking'
    | 'zoom'
    | 'front'
    | 'appMenu'
    | 'fileMenu'
    | 'editMenu'
    | 'viewMenu'
    | 'shareMenu'
    | 'recentDocuments'
    | 'toggleTabBar'
    | 'selectNextTab'
    | 'selectPreviousTab'
    | 'showAllTabs'
    | 'mergeAllWindows'
    | 'clearRecentDocuments'
    | 'moveTabToNewWindow'
    | 'windowMenu';

let contextMenu: () => Menu = () => {
    const updatedLessThanOneMinuteAgo = Date.now() - lastUpdated < 60 * 1000;

    console.log({ lastClickedAccount });

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

app.whenReady().then(() => {
    tray = new Tray(
        nativeImage
            .createFromPath(path.join(app.getAppPath(), 'assets/icon.png'))
            .resize({ width: 16, height: 16 }),
    );

    // Set the context menu for the tray icon
    tray.setContextMenu(contextMenu());

    // Set a tooltip
    tray.setToolTip('My menu bar app');

    // Handle clicks to show/hide a window (optional, can be done with the menu items instead)
    tray.on('click', () => {});
});

// Ensure the app quits when all windows are closed (except on macOS where they usually stay open until explicitly quit)
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

console.log('App is ready. Tray icon should be visible.');

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

                // merge the new data with the existing data, overwriting any existing accounts with the same name
                accounts = accounts
                    .concat(newAccounts)
                    .filter(
                        (account, index, self) =>
                            index ===
                            self.findIndex((a) => a.account + a.issuer === account.account + account.issuer),
                    );

                writeData(accounts);
                tray?.popUpContextMenu(contextMenu());
                lastUpdated = Date.now();
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
