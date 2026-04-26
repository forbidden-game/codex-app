# AGENTS.md

## Repository Context
- This repository is a local Linux packaging and patching repo for Codex Desktop.
- The upstream project is `git@github.com:am-will/codex-app.git`.
- The user's fork is `https://github.com/forbidden-game/codex-app.git`.
- Keep `main` as a clean tracking branch for `upstream/main`.
- Keep user-maintained Linux patches on `codex/linux-global-dictation`.

## Current Linux Dictation Patch
- The branch `codex/linux-global-dictation` contains the user's Linux global dictation work.
- Important commits:
  - `f4aceba Add Linux global dictation hotkey support`
  - `902284a Show Linux dictation transcript notifications`
- The Linux behavior is intentionally clipboard-only: after dictation completes, copy the transcript to the clipboard and do not auto-paste into the focused app.
- Linux dictation completion should also show a system notification containing the transcript preview.
- The global hotkey path is Hyprland/Wayland-oriented and uses the desktop portal global shortcuts flow plus a runtime Hyprland global bind.
- Do not replace this with an X11-only global keyboard hook.

## Key Files
- `desktop/scripts/assemble-codex-runtime.mjs` patches the recovered Codex main bundle and stages Linux helpers.
- `desktop/scripts/linux-global-shortcuts-portal.js` is the Electron-side Linux global shortcut helper.
- `desktop/scripts/linux-global-shortcuts-portal.py` is the persistent D-Bus portal helper.
- `desktop/recovered/app-asar-extracted/.vite/build/main-DCRKtMoS.js` is the tracked recovered bundle that currently carries the patched behavior.
- `desktop/tests/linux/recovered-bundle.red.test.ts` and `desktop/tests/linux/codex-runtime-assembly.test.js` guard the Linux patch contract.
- `desktop/forge.config.ts` must keep the Python helper unpacked from `app.asar`.

## Local Install Layout
- The user's active local launcher is `~/.local/bin/codex-desktop`.
- It executes `~/.local/opt/codex-app/current/Codex.AppImage`.
- The current patched install points at:
  - `~/.local/opt/codex-app/26.422.21647-global-dictation`
- The older install directory is intentionally preserved:
  - `~/.local/opt/codex-app/26.422.21647`
- Do not delete old install directories unless the user explicitly asks.
- Do not kill the currently running Codex Desktop process during normal handoff; the current agent session may be running inside it. Replace the on-disk `current` symlink and let the user restart the app.

## Build And Validation
- Run commands from `desktop/` unless noted otherwise.
- Preferred validation:
  - `npm test -- --runInBand tests/linux/recovered-bundle.red.test.ts`
  - `npm run test:linux`
  - `npm run package`
- The usable local package artifact is usually:
  - `desktop/out/Codex-linux-x64/Codex`
- Full AppImage maker output may fail in this repo; the package directory is enough for the current local install flow.

## Git And LFS Notes
- `desktop/resources/bin/linux-x64/codex` is a Git LFS object.
- If local packaging requires the real binary, it may be temporarily copied from `desktop/out/Codex-linux-x64/resources/codex`.
- Before staging or committing, restore `desktop/resources/bin/linux-x64/codex` to the LFS pointer:
  - `version https://git-lfs.github.com/spec/v1`
  - `oid sha256:12b824507ca65d8141e1d054af56217a1e329137274e8cd81c17e7f9fa756156`
  - `size 203288904`
- The local `.git` directory may be read-only under sandboxed commands. For status/diff, use:
  - `git -c filter.lfs.clean=cat -c filter.lfs.process= -c filter.lfs.required=false status --short --branch`
- Do not commit the untracked `.codex` file.

## Upstream Maintenance Flow
Use this flow when upstream changes and the user wants to keep the Linux dictation patch:

```bash
git fetch upstream
git switch main
git merge --ff-only upstream/main

git switch codex/linux-global-dictation
git rebase main
git push --force-with-lease
```

Resolve conflicts in the patch files listed above, then rerun the Linux validation commands.
