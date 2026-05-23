import { app, Tray, Menu, nativeImage, BrowserWindow, ipcMain, safeStorage, Notification } from 'electron';
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
let settingsWindow: BrowserWindow | null = null;
let lastUpdated = 0;
let lastClickedAccount: Account | null = null;

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

let accounts: Account[] = [];

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

function writeData(data: Account[]) {
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
                label: 'Easy OTP Settings...',
                click: openSettingsWindow,
            },
            { type: 'separator' },
            {
                label: 'Quit',
                accelerator: 'CommandOrControl+Q',
                click: () => app.quit(),
            },
        ]
            .flat()
            .filter(Boolean) as Electron.MenuItemConstructorOptions[],
    );
};

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
    accounts = readData() || [];

    tray = new Tray(
        nativeImage
            .createFromPath(path.join(app.getAppPath(), 'assets/icon.png'))
            .resize({ width: 16, height: 16 }),
    );

    tray.setContextMenu(mainMenu());
    tray.setToolTip('Easy OTP - Click to view accounts');
    tray.on('click', () => {});

    ipcMain.handle('get-accounts', () => accounts);

    ipcMain.handle('save-accounts', (_, newAccounts: Account[]) => {
        accounts = newAccounts;
        writeData(accounts);
        tray?.setContextMenu(mainMenu());
    });

    ipcMain.handle('open-notification-settings', () => {
        execSync('open "x-apple.systempreferences:com.apple.preference.notifications"');
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
