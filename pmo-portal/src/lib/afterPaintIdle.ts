/** Two animation frames put speculative work after the committed frame's paint. */
export function afterPaintIdle(work: () => void): () => void {
  let cancelled = false;
  let idle: number | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let frame = requestAnimationFrame(() => {
    frame = requestAnimationFrame(() => {
      const run = () => { if (!cancelled) work(); };
      if (typeof requestIdleCallback === 'function') idle = requestIdleCallback(run);
      else timer = setTimeout(run, 0);
    });
  });
  return () => {
    cancelled = true;
    cancelAnimationFrame(frame);
    if (idle !== undefined) cancelIdleCallback(idle);
    if (timer !== undefined) clearTimeout(timer);
  };
}
