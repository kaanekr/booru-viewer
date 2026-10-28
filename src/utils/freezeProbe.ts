// Dev only: no native file access, media URLs are never recorded.
// FPS or an open TCP connection alone is not proof of JS liveness.
const state = {
  build: 'ios-player-lifecycle-v3-sexcomdiag',
  tick: 0,
  lastTickAt: 0,
  maxDelayMs: 0,
  appState: 'unknown',
  locked: false,
  route: 'unknown',
  source: '',
  feedCount: 0,
  gridPlayers: 0,
  playerMounts: 0,
  touchStarts: 0,
  touchEnds: 0,
  events: [] as string[],
};

export function updateFreezeProbe(values: Partial<Omit<typeof state, 'events'>>): void {
  if (__DEV__) Object.assign(state, values);
}

export function recordFreezeEvent(event: string): void {
  if (!__DEV__) return;
  state.events.push(`${new Date().toISOString()} ${event}`);
  if (state.events.length > 30) state.events.shift();
}

export function trackGridPlayer(): () => void {
  if (!__DEV__) return () => {};
  state.gridPlayers++;
  state.playerMounts++;
  return () => { state.gridPlayers--; };
}

export function recordRootTouch(kind: 'start' | 'end'): void {
  if (!__DEV__) return;
  if (kind === 'start') state.touchStarts++;
  else state.touchEnds++;
}

export function startFreezeProbe(): () => void {
  if (!__DEV__) return () => {};
  const globals = globalThis as typeof globalThis & { __freezeProbe?: () => unknown };
  const snapshot = () => ({ ...state, events: [...state.events] });
  globals.__freezeProbe = snapshot;
  let previous = Date.now();
  console.log(`[FreezeProbe] ${state.build}`);
  const timer = setInterval(() => {
    const now = Date.now();
    if (state.appState === 'active') state.maxDelayMs = Math.max(state.maxDelayMs, now - previous - 1000);
    previous = now;
    state.lastTickAt = now;
    state.tick++;
    if (state.tick % 15 === 0) {
      console.log(`[FreezeProbe] tick=${state.tick} state=${state.appState} route=${state.route} src=${state.source} n=${state.feedCount} players=${state.gridPlayers} touch=${state.touchStarts}/${state.touchEnds} delay=${state.maxDelayMs}ms`);
    }
  }, 1000);
  return () => {
    clearInterval(timer);
    if (globals.__freezeProbe === snapshot) delete globals.__freezeProbe;
  };
}
