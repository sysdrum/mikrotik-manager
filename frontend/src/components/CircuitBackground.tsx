import { useEffect, useRef, useCallback } from 'react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Point { x: number; y: number }
interface Seg { from: Point; to: Point }
interface Trace { segs: Seg[]; bright: boolean }
interface Pulse {
  trace: Trace;
  segIdx: number;
  t: number;        // [0,1] within current segment
  speed: number;    // segments per second
  hue: number;      // HSL hue
  trail: Point[];
}

interface ThemePalette {
  bg: string;
  traceBright: string;
  traceDim: string;
  padBright: string;
  padDim: string;
  viaStroke: string;
  viaFill: string;
  pulseHues: number[];
  trailLightness: number;   // % lightness for trail hsla
  glowLightness: number;    // % lightness for glow center
  coreLightness: number;    // % lightness for core dot
  coreSaturation: number;   // % saturation for core dot
}

// ─── Theme palettes ───────────────────────────────────────────────────────────

const DARK_PALETTE: ThemePalette = {
  bg:           '#040c07',
  traceBright:  '#112b1a',
  traceDim:     '#0a1f10',
  padBright:    '#183322',
  padDim:       '#0f2219',
  viaStroke:    '#1a3d25',
  viaFill:      '#0d2218',
  pulseHues:    [140, 150, 155, 160, 165, 170, 175, 180, 185],
  trailLightness: 65,
  glowLightness:  80,
  coreLightness:  96,
  coreSaturation: 60,
};

const LIGHT_PALETTE: ThemePalette = {
  bg:           '#e8f2f7',
  traceBright:  '#7aafc8',
  traceDim:     '#9dc4d8',
  padBright:    '#689fbc',
  padDim:       '#88b8cc',
  viaStroke:    '#5590ac',
  viaFill:      '#c2dce8',
  pulseHues:    [185, 190, 195, 200, 205, 210, 215, 220, 170],
  trailLightness: 38,
  glowLightness:  28,
  coreLightness:  22,
  coreSaturation: 75,
};

// ─── Constants ───────────────────────────────────────────────────────────────

const CELL = 56;
const TRAIL = 28;
const PULSE_COUNT = 22;
const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function pt(c: number, r: number): Point {
  return { x: c * CELL, y: r * CELL };
}

function buildTraces(w: number, h: number): Trace[] {
  const cols = Math.floor(w / CELL) + 2;
  const rows = Math.floor(h / CELL) + 2;
  const count = 40 + Math.floor((w * h) / 40000);
  const traces: Trace[] = [];

  for (let i = 0; i < count; i++) {
    let c = Math.floor(Math.random() * cols);
    let r = Math.floor(Math.random() * rows);
    let dir = Math.floor(Math.random() * 4);
    const bright = Math.random() < 0.35;
    const maxLen = bright
      ? 6 + Math.floor(Math.random() * 14)
      : 3 + Math.floor(Math.random() * 8);
    const segs: Seg[] = [];

    for (let step = 0; step < maxLen; step++) {
      const nc = c + DX[dir];
      const nr = r + DY[dir];
      if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) break;
      segs.push({ from: pt(c, r), to: pt(nc, nr) });
      c = nc;
      r = nr;
      if (Math.random() < 0.28) {
        dir = (dir + (Math.random() < 0.5 ? 1 : 3)) % 4;
      }
      if (step >= 2 && Math.random() < 0.06) break;
    }

    if (segs.length >= 2) traces.push({ segs, bright });
  }

  return traces;
}

function buildPulses(traces: Trace[], palette: ThemePalette): Pulse[] {
  const candidates = traces.filter((t) => t.segs.length >= 3 && t.bright);
  const pool = candidates.length > 0 ? candidates : traces.filter((t) => t.segs.length >= 3);
  const pulses: Pulse[] = [];

  for (let i = 0; i < PULSE_COUNT; i++) {
    const trace = pool[Math.floor(Math.random() * pool.length)];
    if (!trace) continue;
    pulses.push({
      trace,
      segIdx: Math.floor(Math.random() * trace.segs.length),
      t: Math.random(),
      speed: 0.45 + Math.random() * 0.85,
      hue: palette.pulseHues[Math.floor(Math.random() * palette.pulseHues.length)],
      trail: [],
    });
  }
  return pulses;
}

function lerp(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

// ─── Component ───────────────────────────────────────────────────────────────

interface Props {
  theme?: 'dark' | 'light';
}

export default function CircuitBackground({ theme = 'dark' }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<{ traces: Trace[]; pulses: Pulse[]; raf: number }>({
    traces: [], pulses: [], raf: 0,
  });

  const palette = theme === 'light' ? LIGHT_PALETTE : DARK_PALETTE;

  const init = useCallback((w: number, h: number) => {
    const traces = buildTraces(w, h);
    const pulses = buildPulses(traces, palette);
    stateRef.current.traces = traces;
    stateRef.current.pulses = pulses;
  }, [palette]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    if (!ctx) return;

    let lastTime = performance.now();

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      init(canvas.width, canvas.height);
    };

    resize();
    window.addEventListener('resize', resize);

    // ── Draw helpers ──────────────────────────────────────────────────────────

    function drawTraces(traces: Trace[]) {
      for (const trace of traces) {
        ctx.beginPath();
        ctx.strokeStyle = trace.bright ? palette.traceBright : palette.traceDim;
        ctx.lineWidth = trace.bright ? 1.5 : 1;
        ctx.lineCap = 'square';
        ctx.moveTo(trace.segs[0].from.x, trace.segs[0].from.y);
        for (const seg of trace.segs) {
          ctx.lineTo(seg.to.x, seg.to.y);
        }
        ctx.stroke();

        const padCol = trace.bright ? palette.padBright : palette.padDim;
        for (const seg of trace.segs) {
          ctx.fillStyle = padCol;
          ctx.beginPath();
          ctx.arc(seg.to.x, seg.to.y, 2.5, 0, Math.PI * 2);
          ctx.fill();
        }

        if (trace.bright && Math.random() < 0.4) {
          const last = trace.segs[trace.segs.length - 1].to;
          ctx.strokeStyle = palette.viaStroke;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(last.x, last.y, 5, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = palette.viaFill;
          ctx.fill();
        }
      }
    }

    function drawPulse(pulse: Pulse) {
      const len = pulse.trail.length;
      if (len < 2) return;

      const { trailLightness, glowLightness, coreLightness, coreSaturation } = palette;

      for (let i = 1; i < len; i++) {
        const alpha = Math.pow(i / len, 1.6) * 0.75;
        const width = (i / len) * 2.5;
        ctx.strokeStyle = `hsla(${pulse.hue}, 90%, ${trailLightness}%, ${alpha})`;
        ctx.lineWidth = width;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(pulse.trail[i - 1].x, pulse.trail[i - 1].y);
        ctx.lineTo(pulse.trail[i].x, pulse.trail[i].y);
        ctx.stroke();
      }

      const head = pulse.trail[len - 1];
      const glow = ctx.createRadialGradient(head.x, head.y, 0, head.x, head.y, 16);
      glow.addColorStop(0,    `hsla(${pulse.hue}, 90%, ${glowLightness}%, 0.7)`);
      glow.addColorStop(0.35, `hsla(${pulse.hue}, 90%, ${trailLightness}%, 0.25)`);
      glow.addColorStop(1,    `hsla(${pulse.hue}, 90%, ${trailLightness}%, 0)`);
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(head.x, head.y, 16, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = `hsl(${pulse.hue}, ${coreSaturation}%, ${coreLightness}%)`;
      ctx.beginPath();
      ctx.arc(head.x, head.y, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }

    // ── Animation loop ────────────────────────────────────────────────────────

    const animate = (now: number) => {
      const dt = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;

      const { traces, pulses } = stateRef.current;
      const w = canvas.width;
      const h = canvas.height;

      ctx.fillStyle = palette.bg;
      ctx.fillRect(0, 0, w, h);

      drawTraces(traces);

      for (const pulse of pulses) {
        pulse.t += pulse.speed * dt;
        while (pulse.t >= 1) {
          pulse.t -= 1;
          pulse.segIdx = (pulse.segIdx + 1) % pulse.trace.segs.length;
        }

        const seg = pulse.trace.segs[pulse.segIdx];
        const pos = lerp(seg.from, seg.to, pulse.t);
        pulse.trail.push(pos);
        if (pulse.trail.length > TRAIL) pulse.trail.shift();

        drawPulse(pulse);
      }

      stateRef.current.raf = requestAnimationFrame(animate);
    };

    stateRef.current.raf = requestAnimationFrame(animate);

    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(stateRef.current.raf);
    };
  }, [init, palette]);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none"
      style={{ zIndex: 0 }}
    />
  );
}
