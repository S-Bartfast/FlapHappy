// Generates tests/fixtures/sample-trace.jsonl: the same shape the app records with --record.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures', 'sample-trace.jsonl');
const lines = [];
let t = 1_700_000_000_000;
const angleByIndex = { 0: -2, 1: 0, 2: 3, 3: 6, 4: 12, 5: 20 };
for (let i = 0; i < 120; i++) {
  const phase = i / 120;
  const ias = 45 + 110 * Math.sin(Math.PI * phase);
  const idx = Math.min(5, Math.floor(phase * 6));
  lines.push(JSON.stringify({
    connected: true, inFlight: true, iasKt: Math.round(ias * 10) / 10, onGround: false,
    flapIndex: idx, flapCount: 8, flapPercent: idx / 7,
    flapAngleLeftDeg: angleByIndex[idx], flapAngleRightDeg: angleByIndex[idx],
    lvar: null, aircraftTitle: 'Simulated glider', t,
  }));
  t += 100;
}
writeFileSync(out, lines.join('\n') + '\n');
console.log('wrote', out);
