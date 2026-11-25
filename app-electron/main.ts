import { app, BrowserWindow, dialog, ipcMain, shell, screen } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { parseCli } from './cli';
import { FileProfileStore } from '../adapters/electron/file-store';
import { SimConnectSource } from '../adapters/electron/simconnect-source';
import { ReplaySource, parseTraceJsonl } from '../adapters/simulated/replay-source';
import type { DataSource, HostInfo, SimSample } from '../core/sim';
import type { CockpitState } from '../core/cockpit';
import type { Profile, Settings } from '../core/types';
import { PanelRuntime } from './panel-runtime';
import { SimulatedSource } from '../adapters/simulated/simulated-source';
import { startPanelServer } from './panel-server';
import { installCockpitPanel } from './panel-install';

function windowIcon(): string | undefined {
  const packed = path.join(process.resourcesPath, 'icon.ico');
  const dev = path.join(__dirname, '..', 'build', 'icon.ico');
  if (fs.existsSync(packed)) return packed;
  if (fs.existsSync(dev)) return dev;
  return undefined;
}

const cli = parseCli(process.argv.slice(1));
const APP_NAME = 'Flap Happy';

// Profile library lives in %APPDATA%/FlapHappy (profiles/*.json + settings.json).
app.setName('FlapHappy');
app.setPath('userData', cli.userData ?? path.join(app.getPath('appData'), 'FlapHappy'));

let store: FileProfileStore;
let win: BrowserWindow | null = null;
let source: DataSource | null = null;
let recorder: fs.WriteStream | null = null;
let boundsTimer: ReturnType<typeof setTimeout> | null = null;
let quitting = false;
let cockpitState: CockpitState | null = null;
let panelRuntime: PanelRuntime | null = null;
let initialized = false;
let showPending = false;
let openingWindow: Promise<void> | null = null;

function info(): HostInfo {
  return { source: cli.source, dev: cli.dev && !cli.panelOnly, panelOnly: cli.panelOnly, version: app.getVersion(), platform: process.platform };
}

function send(channel: string, payload: unknown): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function startSource(): void {
  stopSource();
  if (cli.source === 'simulated') {
    if (!cli.panelOnly) return;
    source = new SimulatedSource();
  } else if (cli.source === 'replay') {
    if (!cli.trace) {
      send('source:log', 'Replay needs --trace=<file.jsonl>');
      return;
    }
    const samples = parseTraceJsonl(fs.readFileSync(cli.trace, 'utf8'));
    source = new ReplaySource(samples, { speed: cli.speed, loop: cli.loop });
  } else {
    source = new SimConnectSource({ protocol: cli.protocol, log: (m) => send('source:log', m) });
  }
  if (cli.record && !recorder) recorder = fs.createWriteStream(cli.record, { flags: 'a' });
  source.start((s: SimSample) => {
    if (recorder && s.connected) recorder.write(JSON.stringify(s) + '\n');
    if (panelRuntime) panelRuntime.sample(s, cli.source === 'replay' ? Date.now() : s.t);
    send('sample', s);
  });
  if (panelRuntime) source.setLvarName?.(panelRuntime.getState().profile?.current_flap.lvar_name ?? null);
}

function stopSource(): void {
  if (source) source.stop();
  source = null;
}

function saveBoundsSoon(): void {
  if (boundsTimer) clearTimeout(boundsTimer);
  boundsTimer = setTimeout(() => {
    if (win && !win.isDestroyed() && !win.isMinimized()) store.setWindowBounds(win.getBounds());
  }, 400);
}

async function createWindow(compact: boolean): Promise<void> {
  const settings = await store.getSettings();
  const saved = settings.window;
  const display = screen.getPrimaryDisplay().workArea;
  const fits =
    saved && saved.x < display.x + display.width - 50 && saved.y < display.y + display.height - 50 && saved.x + saved.width > display.x + 50 && saved.y + saved.height > display.y;
  const w = new BrowserWindow({
    title: APP_NAME,
    width: saved ? saved.width : compact ? 640 : 720,
    height: saved ? saved.height : compact ? 200 : cli.dev ? 760 : 420,
    x: fits && saved ? saved.x : undefined,
    y: fits && saved ? saved.y : undefined,
    minWidth: 320,
    minHeight: 120,
    frame: !compact,
    backgroundColor: '#0b0e13',
    icon: windowIcon(),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  w.setMenuBarVisibility(false);
  const prev = win;
  win = w;
  if (settings.ui.always_on_top) w.setAlwaysOnTop(true, 'screen-saver');
  w.setOpacity(settings.ui.opacity);
  w.once('ready-to-show', () => w.show());
  w.on('resize', saveBoundsSoon);
  w.on('move', saveBoundsSoon);
  w.on('closed', () => {
    if (win === w) win = null;
    if (!quitting && !prev) return;
  });
  w.webContents.on('page-title-updated', (e) => e.preventDefault());
  await w.loadFile(path.join(__dirname, 'renderer', 'index.html'), { query: { compact: compact ? '1' : '0' } });
  if (prev && !prev.isDestroyed()) prev.destroy();
}

async function showDesktop(): Promise<void> {
  if (!initialized) { showPending = true; return; }
  if (openingWindow) { await openingWindow; return; }
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    return;
  }
  if (!openingWindow) {
    openingWindow = createWindow(true).finally(() => { openingWindow = null; });
  }
  await openingWindow;
}

function registerIpc(): void {
  ipcMain.handle('store:list', () => store.list());
  ipcMain.handle('store:load', (_e, id: string) => store.load(id));
  ipcMain.handle('store:save', async (_e, p: Profile) => { await store.save(p); await panelRuntime?.refresh(); });
  ipcMain.handle('store:remove', async (_e, id: string) => { await store.remove(id); await panelRuntime?.refresh(); });
  ipcMain.handle('store:getSettings', () => panelRuntime ? panelRuntime.settings() : store.getSettings());
  ipcMain.handle('store:setSettings', (_e, s: Settings) => panelRuntime ? panelRuntime.updateSettings(s) : store.setSettings(s));

  ipcMain.handle('host:info', () => info());
  ipcMain.handle('host:openJson', async () => {
    const r = await dialog.showOpenDialog(win ?? undefined!, {
      title: 'Open profile',
      defaultPath: store.profilesDir,
      properties: ['openFile'],
      filters: [{ name: 'Flap Happy profile', extensions: ['json'] }],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    return fs.readFileSync(r.filePaths[0], 'utf8');
  });
  ipcMain.handle('host:saveJson', async (_e, name: string, text: string) => {
    const fileName = path.basename(name);
    const r = await dialog.showSaveDialog(win ?? undefined!, {
      title: 'Save profile as',
      defaultPath: path.join(store.profilesDir, fileName),
      filters: [{ name: 'Flap Happy profile', extensions: ['json'] }],
    });
    if (r.canceled || !r.filePath) return false;
    fs.writeFileSync(r.filePath, text, 'utf8');
    return true;
  });
  ipcMain.handle('host:setAlwaysOnTop', (_e, on: boolean) => {
    // A high z-order level keeps the window above a windowed or borderless sim.
    if (win) win.setAlwaysOnTop(!!on, on ? 'screen-saver' : 'normal');
  });
  ipcMain.handle('host:setOpacity', (_e, o: number) => {
    if (win) win.setOpacity(Math.max(0.3, Math.min(1, o)));
  });
  ipcMain.handle('host:setCompact', async (_e, on: boolean) => {
    await createWindow(!!on);
  });
  ipcMain.handle('host:openProfilesFolder', () => shell.openPath(store.profilesDir));
  ipcMain.handle('host:quit', () => { if (cli.panelOnly) win?.close(); else app.quit(); });
  ipcMain.handle('host:installPanel', () => installCockpitPanel(path.join(__dirname, 'panel', 'flaphappy-ingamepanel')));
  ipcMain.handle('panel:state', (_e, state: CockpitState) => {
    if (!cli.panelOnly) cockpitState = state;
  });
  ipcMain.handle('panel:setBallast', (_e, profileId: string, f: number) => quitting ? false : panelRuntime?.setBallast(f, profileId));

  ipcMain.handle('source:start', () => {
    if (!cli.panelOnly) startSource();
    else if (panelRuntime?.getState().sample) send('sample', panelRuntime.getState().sample);
  });
  ipcMain.handle('source:stop', () => { if (!cli.panelOnly) stopSource(); });
  ipcMain.handle('source:setLvar', (_e, name: string | null) => {
    if (!cli.panelOnly && source && source.setLvarName) source.setLvarName(name);
  });
}

async function smokeAndCapture(): Promise<void> {
  if (!win) return;
  const w = win;
  await new Promise((r) => setTimeout(r, cli.smoke ? 2500 : 3500));
  if (cli.screenshot) {
    const img = await w.webContents.capturePage();
    fs.writeFileSync(cli.screenshot, img.toPNG());
  }
  if (cli.smoke) {
    const result = (await w.webContents.executeJavaScript(
      `({ title: document.title, cells: document.querySelectorAll('.fh-cell').length, ticks: document.querySelectorAll('.fh-tick').length, profile: window.__flapHappy ? window.__flapHappy.profileId() : null })`,
    )) as { title: string; cells: number; ticks: number; profile: string | null };
    const metas = await store.list();
    console.log('SMOKE_RESULT ' + JSON.stringify({ ...result, library: metas.map((m) => m.id), userData: app.getPath('userData') }));
    app.exit(result.cells > 0 && result.title === APP_NAME ? 0 : 1);
    return;
  }
  app.quit();
}

const haveLock = app.requestSingleInstanceLock();
if (!haveLock || cli.quit) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const requested = parseCli(argv);
    if (requested.quit) { app.quit(); return; }
    if (quitting || requested.panelOnly) return;
    void showDesktop().catch(e => console.error('Could not open Flap Happy', e));
  });
  app.whenReady().then(async () => {
    store = new FileProfileStore(app.getPath('userData'));
    await store.getSettings();
    registerIpc();
    if (cli.panelOnly) {
      panelRuntime = new PanelRuntime(store, (name) => source?.setLvarName?.(name), (profileId, f) => send('panel:ballast', { profileId, f }));
      await panelRuntime.initialize();
    }
    try {
      await startPanelServer({
        root: path.join(__dirname, 'renderer'),
        version: app.getVersion(),
        getState: () => panelRuntime ? panelRuntime.getState() : cockpitState,
        onBallast: async (f) => {
          if (quitting) return false;
          if (panelRuntime) return panelRuntime.setBallast(f);
          send('panel:ballast', f);
        },
      });
    } catch (e) {
      console.error('Cockpit panel server did not start', e);
      if (cli.panelOnly) { app.exit(1); return; }
    }
    initialized = true;
    if (cli.panelOnly) {
      startSource();
      if (showPending) await showDesktop();
    } else {
      await showDesktop();
      if (cli.smoke || cli.screenshot) void smokeAndCapture();
    }
  });
  app.on('window-all-closed', () => { if (!cli.panelOnly) app.quit(); });
  app.on('before-quit', (event) => {
    if (panelRuntime && !quitting) {
      // Drain queued preference writes before a panel-only session exits.
      event.preventDefault();
      quitting = true;
      stopSource();
      void panelRuntime.flush().finally(() => app.quit());
      return;
    }
    quitting = true;
    stopSource();
    if (recorder) recorder.end();
  });
}
