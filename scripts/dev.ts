import { spawn } from 'node:child_process';
import { runDevWatcher } from './dev-runner';

/**
 * Skrapa's dev server for the `web/` site. It watches `web/` and live-reloads on its
 * own, so it is started once and left running while the Electron app restarts
 * around it. Detached for the same reason as the app: so `stop` can take down
 * npm, the shell, and skrapa together.
 *
 * Runs skrapa through `npx` rather than `npm run dev` in `web/`: if `web/` has no
 * package.json, npm walks up to this repo's root, and `npm run dev` there re-runs this
 * very script, which spawns itself again without end. `npm exec` keeps `web/` as cwd.
 * `--yes` skips npx's install prompt, which a detached (background) group can't answer.
 *
 * Pinned to the version `web/package.json` installs: npx prefers a local install when
 * one is there, but falls back to whatever `latest` resolves to on the registry when it
 * isn't (e.g. `web/` never had `npm install` run). Skrapa's config format is not stable
 * across majors, so an unpinned fallback can silently start reading the wrong config.
 */
function startWeb() {
    return spawn('npx --yes skrapa@0.7.1 dev', {
        cwd: 'web',
        stdio: 'inherit',
        shell: true,
        detached: true,
    });
}

const web = startWeb();
runDevWatcher({ extraChildren: [web] });
