import { copyFileSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/** Copy the cockpit panel into the MSFS Community folder and write a matching layout.json. */
export function installCockpitPanel(packageDir: string): string {
  const community = findCommunity();
  if (!community) return 'Could not find the MSFS Community folder. Set InstalledPackagesPath in UserCfg.opt, then try again.';
  if (!statSync(packageDir, { throwIfNoEntry: false })?.isDirectory()) return 'Cockpit panel files are missing from this build.';
  const dest = join(community, 'flaphappy-ingamepanel');
  copyTree(packageDir, dest);
  const spb = join(dest, 'InGamePanels', 'FlapHappy.spb');
  const hasSpb = !!statSync(spb, { throwIfNoEntry: false });
  writeLayout(dest);
  if (!hasSpb) {
    return 'Copied the panel to ' + dest + '. The toolbar icon still needs InGamePanels/FlapHappy.spb, compiled from panel/FlapHappy.xml with the MSFS SDK. Until that file is there, the sim will not list Flap Happy.';
  }
  return 'Installed the cockpit panel in ' + dest + '. Restart MSFS, then press Tab and open Flap Happy.';
}

function findCommunity(): string | null {
  const appData = process.env.APPDATA || '';
  const local = process.env.LOCALAPPDATA || '';
  const cfgs = [
    join(appData, 'Microsoft Flight Simulator 2024', 'UserCfg.opt'),
    join(appData, 'Microsoft Flight Simulator', 'UserCfg.opt'),
    join(local, 'Packages', 'Microsoft.Limitless_8wekyb3d8bbwe', 'LocalCache', 'UserCfg.opt'),
    join(local, 'Packages', 'Microsoft.FlightSimulator_8wekyb3d8bbwe', 'LocalCache', 'UserCfg.opt'),
  ];
  for (let i = 0; i < cfgs.length; i++) {
    let text = '';
    try {
      text = readFileSync(cfgs[i], 'utf8');
    } catch {
      continue;
    }
    const m = /InstalledPackagesPath\s+"([^"]+)"/.exec(text);
    if (!m) continue;
    const community = join(m[1], 'Community');
    if (statSync(community, { throwIfNoEntry: false })?.isDirectory()) return community;
  }
  return null;
}

function copyTree(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  const names = readdirSync(src);
  for (let i = 0; i < names.length; i++) {
    if (names[i] === 'layout.json') continue;
    const from = join(src, names[i]);
    const to = join(dest, names[i]);
    if (statSync(from).isDirectory()) copyTree(from, to);
    else {
      mkdirSync(dest, { recursive: true });
      copyFileSync(from, to);
    }
  }
}

function writeLayout(root: string): void {
  const files: string[] = [];
  walk(root, files);
  const content = files.map((file) => {
    const st = statSync(file);
    const ms = BigInt(Math.round(st.mtimeMs)) + 11644473600000n;
    return { path: relative(root, file).replace(/\\/g, '/'), size: st.size, date: (ms * 10000n).toString() };
  });
  let total = 0;
  for (let i = 0; i < content.length; i++) total += content[i].size;
  const rows = content.map((c) => `    { "path": ${JSON.stringify(c.path)}, "size": ${c.size}, "date": ${c.date} }`);
  writeFileSync(join(root, 'layout.json'), '{\n  "content": [\n' + rows.join(',\n') + '\n  ]\n}\n');
  const manifestPath = join(root, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { total_package_size?: string };
  manifest.total_package_size = String(total).padStart(20, '0');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}

function walk(dir: string, out: string[]): void {
  const names = readdirSync(dir);
  for (let i = 0; i < names.length; i++) {
    if (names[i] === 'layout.json' || names[i] === 'manifest.json') continue;
    const p = join(dir, names[i]);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
}
