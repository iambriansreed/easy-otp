import fs from 'node:fs';
import path from 'node:path';
import { runDevWatcher } from './dev-runner';

// npm always runs scripts with cwd set to the package root, not wherever the
// user typed `npm run demo`; INIT_CWD is where they actually ran it from, which
// is what a user-supplied relative path should resolve against. The no-arg
// default stays relative to the package root, since scripts/demo-data.txt is
// meaningful there regardless of where `npm run demo` was invoked.
const arg = process.argv[2];
const demoFile = arg
    ? path.resolve(process.env.INIT_CWD || process.cwd(), arg)
    : path.resolve('scripts/demo-data.txt');
if (!fs.existsSync(demoFile)) {
    console.error(`Demo file not found: ${demoFile}`);
    process.exit(1);
}

/**
 * Same start/stop/watch shape as dev.ts, so demo mode rebuilds on `src/` changes
 * the same way `npm run dev` does. The only difference is EASY_OTP_DEMO_FILE:
 * app.ts reads it before requestSingleInstanceLock() and before touching
 * userData, and redirects both to a throwaway directory so this can never read
 * or overwrite the real Keychain-backed accounts store.
 */
runDevWatcher({ env: { EASY_OTP_DEMO_FILE: demoFile } });
