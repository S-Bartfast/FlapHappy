import type { DataSource, SimSample } from '../../core/sim';

export function parseTraceJsonl(text: string): SimSample[] {
  const out: SimSample[] = [];
  for (const line of text.split(/\r?\n/)) {
    const l = line.trim();
    if (!l) continue;
    try {
      const o = JSON.parse(l) as SimSample;
      if (o && typeof o === 'object' && typeof o.t === 'number') out.push(o);
    } catch {
      // Skip a torn last line from a recording that was cut off.
    }
  }
  return out;
}

/** Plays a recorded `trace.jsonl` back with the original timing (scaled by `speed`). */
export class ReplaySource implements DataSource {
  kind = 'replay';
  private timer: ReturnType<typeof setTimeout> | null = null;
  private i = 0;

  constructor(
    private samples: SimSample[],
    private opts: { speed?: number; loop?: boolean } = {},
  ) {}

  start(cb: (s: SimSample) => void): void {
    this.stop();
    this.i = 0;
    const speed = this.opts.speed && this.opts.speed > 0 ? this.opts.speed : 1;
    const step = () => {
      if (this.i >= this.samples.length) {
        if (!this.opts.loop || !this.samples.length) return;
        this.i = 0;
      }
      const cur = this.samples[this.i];
      cb(cur);
      const nxt = this.samples[this.i + 1];
      this.i++;
      const wait = nxt ? Math.max(0, (nxt.t - cur.t) / speed) : 500 / speed;
      this.timer = setTimeout(step, wait);
    };
    step();
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
