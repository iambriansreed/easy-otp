import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import fs from 'node:fs';

function start(): ChildProcess {
    return spawn('npm', ['run', 'start'], {
        stdio: 'inherit',
        shell: true,
        detached: true,
    });
}

// start the app
let child = start();
let isRestarting = false;

fs.watch('./src', { recursive: true }, (eventType, filename) => {
    if (isRestarting) return;
    isRestarting = true;

    // Kill the entire process group (npm + shell + electron)
    if (child.pid) {
        try {
            process.kill(-child.pid, 'SIGTERM');
        } catch {}
    }

    setTimeout(() => {
        child = start();
        isRestarting = false;
    }, 1000);
});
