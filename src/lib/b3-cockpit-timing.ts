// Browser-only diagnostics when called; no financial writes or data contents.
export async function timedCockpitRead<T>(name: string, read: () => Promise<T>): Promise<T> {
  const start = performance.now();
  try { return await read(); }
  finally { console.info("[cockpit-tempo]", JSON.stringify({ chamada: name, ms: Math.round((performance.now() - start) * 100) / 100 })); }
}
export function cockpitRenderTiming(id: string, phase: string, actualDuration: number, baseDuration: number) {
  console.info("[cockpit-render]", JSON.stringify({ id, phase, ms: Math.round(actualDuration * 100) / 100, base_ms: Math.round(baseDuration * 100) / 100 }));
}