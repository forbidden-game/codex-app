'use strict';

const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');

const LOG_PATH = process.env.CODEX_LINUX_GLOBAL_SHORTCUTS_LOG?.trim() || null;
const HELPER_PATH = path.join(__dirname, 'linux-global-shortcuts-portal.py');
const HYPRLAND_SHORTCUT_ID = 'Codex:codex-global-dictation';

function resolvePythonHelperPath() {
  const unpackedPath = HELPER_PATH.replace(
    `${path.sep}app.asar${path.sep}`,
    `${path.sep}app.asar.unpacked${path.sep}`,
  );
  if (unpackedPath !== HELPER_PATH && fs.existsSync(unpackedPath)) {
    return unpackedPath;
  }
  return HELPER_PATH;
}

function logPortal(event, details = {}) {
  if (LOG_PATH == null) {
    return;
  }
  try {
    fs.appendFileSync(
      LOG_PATH,
      `${new Date().toISOString()} ${event} ${JSON.stringify(details)}\n`,
    );
  } catch {
    // Logging must never break dictation registration.
  }
}

function registerLinuxGlobalShortcutPortal(hotkey, callbacks) {
  if (process.platform !== 'linux') {
    return null;
  }

  const trigger = toPortalTrigger(hotkey);
  const helperPath = resolvePythonHelperPath();
  logPortal('register_start', { hotkey, trigger, helper: helperPath });

  if (!fs.existsSync(helperPath)) {
    logPortal('helper_missing', { helper: helperPath });
    return null;
  }

  const child = childProcess.spawn(
    process.env.PYTHON ?? 'python',
    [helperPath, trigger],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  child.unref();
  logPortal('helper_spawned', { pid: child.pid });
  const hyprlandBind = registerHyprlandGlobalBind(trigger);

  let disposed = false;
  const rl = readline.createInterface({ input: child.stdout });

  rl.on('line', (line) => {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      logPortal('helper_stdout', { line });
      return;
    }

    logPortal('helper_event', event);
    switch (event.type) {
      case 'ready':
        break;
      case 'activated':
        callbacks.onPressed?.();
        break;
      case 'deactivated':
        callbacks.onReleased?.();
        break;
      case 'error':
        dispose();
        break;
    }
  });

  child.stderr.on('data', (chunk) => {
    logPortal('helper_stderr', { text: chunk.toString('utf8') });
  });
  child.once('error', (error) => {
    logPortal('helper_error', { error: error.message });
    dispose();
  });
  child.once('exit', (code, signal) => {
    logPortal('helper_exit', { code, signal });
  });

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    logPortal('dispose', { pid: child.pid });
    rl.close();
    hyprlandBind?.unregister();
    child.kill();
  };

  return {
    handlesRelease: true,
    unregister: dispose,
  };
}

function registerHyprlandGlobalBind(trigger) {
  if (!process.env.HYPRLAND_INSTANCE_SIGNATURE) {
    return null;
  }

  const bind = toHyprlandBind(trigger);
  if (bind == null) {
    logPortal('hyprland_bind_skipped', { reason: 'unsupported-trigger', trigger });
    return null;
  }

  if (hasHyprlandBindConflict(bind)) {
    logPortal('hyprland_bind_skipped', { reason: 'existing-bind', bind });
    return null;
  }

  const bindSpec = `${bind.mods},${bind.key},global,${HYPRLAND_SHORTCUT_ID}`;
  const result = childProcess.spawnSync('hyprctl', ['keyword', 'bind', bindSpec], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    logPortal('hyprland_bind_failed', {
      bindSpec,
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
      error: result.error?.message,
    });
    return null;
  }

  logPortal('hyprland_bind_ok', { bindSpec });
  return {
    unregister() {
      const unbindSpec = `${bind.mods},${bind.key}`;
      const unbindResult = childProcess.spawnSync('hyprctl', ['keyword', 'unbind', unbindSpec], {
        encoding: 'utf8',
      });
      logPortal('hyprland_unbind_done', {
        unbindSpec,
        status: unbindResult.status,
        stdout: unbindResult.stdout,
        stderr: unbindResult.stderr,
        error: unbindResult.error?.message,
      });
    },
  };
}

function hasHyprlandBindConflict(bind) {
  const result = childProcess.spawnSync('hyprctl', ['binds', '-j'], {
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.status !== 0 || !result.stdout.trim()) {
    logPortal('hyprland_binds_unavailable', {
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
      error: result.error?.message,
    });
    return false;
  }

  try {
    const bindings = JSON.parse(result.stdout);
    const requestedModmask = hyprlandModmask(bind.mods);
    return bindings.some((entry) =>
      entry?.key === bind.key &&
      Number(entry?.modmask) === requestedModmask &&
      !(entry?.dispatcher === 'global' && entry?.arg === HYPRLAND_SHORTCUT_ID),
    );
  } catch (error) {
    logPortal('hyprland_binds_parse_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

function toHyprlandBind(trigger) {
  const parts = trigger.split('+').map((part) => part.trim()).filter(Boolean);
  const key = parts.pop();
  if (!key) return null;

  const mods = parts.map((part) => {
    if (part === 'CTRL') return 'CTRL';
    if (part === 'ALT') return 'ALT';
    if (part === 'SHIFT') return 'SHIFT';
    if (part === 'META') return 'SUPER';
    return null;
  });
  if (mods.some((part) => part == null)) {
    return null;
  }

  return {
    mods: mods.join(' '),
    key: key === 'Space' ? 'SPACE' : key,
  };
}

function hyprlandModmask(mods) {
  return mods.split(/\s+/).filter(Boolean).reduce((mask, mod) => {
    if (mod === 'SHIFT') return mask | 1;
    if (mod === 'CAPS') return mask | 2;
    if (mod === 'CTRL') return mask | 4;
    if (mod === 'ALT') return mask | 8;
    if (mod === 'SUPER') return mask | 64;
    return mask;
  }, 0);
}

function toPortalTrigger(hotkey) {
  return hotkey
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const lower = part.toLowerCase();
      if (
        lower === 'ctrl' ||
        lower === 'control' ||
        lower === 'cmdorctrl' ||
        lower === 'commandorcontrol'
      ) {
        return 'CTRL';
      }
      if (lower === 'alt' || lower === 'option') return 'ALT';
      if (lower === 'shift') return 'SHIFT';
      if (lower === 'super' || lower === 'meta' || lower === 'cmd' || lower === 'command') return 'META';
      return part.length === 1 ? part.toUpperCase() : part;
    })
    .join('+');
}

module.exports = {
  registerLinuxGlobalShortcutPortal,
  toHyprlandBind,
  toPortalTrigger,
};
