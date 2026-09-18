import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import fs from 'node:fs';

/**
 * Signal the whole child group (npm + shell + electron) rather than just npm,
 * which would leave electron behind.
 *
 * `detached` is what makes that possible, but it also takes the child out of the
 * terminal's process group — so Ctrl+C reaches this watcher and nothing else.
 * Without the handlers at the bottom, quitting would orphan electron, and the
 * next run would start, fail to take the single-instance lock, and exit while
 * the stale copy kept running the old build. An orphaned skrapa would likewise
 * hold the port and make the next dev server fail to start.
 */
function stop(child: ChildProcess, signal: NodeJS.Signals) {
    if (!child.pid) return;
    try {
        process.kill(-child.pid, signal);
    } catch {
        /* already gone */
    }
}

/**
 * Shared shape behind `npm run dev` and `npm run demo`: spawn `npm run start`, watch
 * `src/` and restart it on change, and take the whole process group down together on
 * exit. Pulled out once both scripts needed it, so the signal handling above — easy to
 * get subtly wrong — has one place to be fixed instead of two.
 * @param env - Extra env vars for the `npm run start` child, e.g. EASY_OTP_DEMO_FILE.
 * @param extraChildren - Other detached children (e.g. Skrapa's dev server) already
 *   running, stopped alongside the app instead of managed here.
 */
export function runDevWatcher({
    env,
    extraChildren = [],
}: {
    env?: NodeJS.ProcessEnv;
    extraChildren?: ChildProcess[];
}): void {
    function start(): ChildProcess {
        // One command string, not ('npm', [...args]): Node 24 deprecates args combined
        // with `shell: true` (DEP0190), since they are concatenated rather than escaped.
        return spawn('npm run start', {
            stdio: 'inherit',
            shell: true,
            detached: true,
            env: env ? { ...process.env, ...env } : process.env,
        });
    }

    let child = start();
    let isRestarting = false;

    fs.watch('./src', { recursive: true }, () => {
        if (isRestarting) return;
        isRestarting = true;

        const dying = child;
        stop(dying, 'SIGTERM');

        setTimeout(() => {
            // Whatever ignored SIGTERM goes down hard before the next start, so the
            // rebuilt app is never the one that loses the lock.
            stop(dying, 'SIGKILL');
            child = start();
            isRestarting = false;
        }, 1000);
    });

    let exiting = false;

    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
        process.on(signal, () => {
            if (exiting) return;
            exiting = true;

            stop(child, 'SIGTERM');
            extraChildren.forEach((c) => stop(c, 'SIGTERM'));
            setTimeout(() => {
                stop(child, 'SIGKILL');
                extraChildren.forEach((c) => stop(c, 'SIGKILL'));
                process.exit(0);
            }, 300);
        });
    }

    // Backstop for any exit path that skipped the handlers above
    process.on('exit', () => {
        stop(child, 'SIGKILL');
        extraChildren.forEach((c) => stop(c, 'SIGKILL'));
    });
}
