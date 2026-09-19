// The channel to the desktop app, when the server runs inside it (an Electron
// utility process). The app answers requests only it can serve, such as
// capturing a page in its own browser. Outside the app there is no channel,
// and callers fall back to what the server can do alone.

interface ParentPort {
  on(event: 'message', fn: (e: { data: unknown }) => void): void;
  postMessage(message: unknown): void;
}

export interface AppChannel {
  request<T>(type: string, payload: unknown, timeoutMs: number): Promise<T>;
}

let channel: AppChannel | null | undefined;

/** The channel to the app hosting this server, or null when it runs on its own. */
export function appChannel(): AppChannel | null {
  if (channel !== undefined) return channel;
  const port = (process as { parentPort?: ParentPort }).parentPort;
  if (!port) return (channel = null);
  const pending = new Map<number, { resolve(v: unknown): void; reject(e: Error): void; timer: NodeJS.Timeout }>();
  let next = 1;
  port.on('message', ({ data }) => {
    const m = data as { reply?: number; ok?: boolean; value?: unknown; error?: string };
    if (typeof m?.reply !== 'number') return;
    const p = pending.get(m.reply);
    if (!p) return;
    pending.delete(m.reply);
    clearTimeout(p.timer);
    if (m.ok) p.resolve(m.value); else p.reject(Error(m.error || 'The app could not do this'));
  });
  return (channel = {
    request<T>(type: string, payload: unknown, timeoutMs: number) {
      return new Promise<T>((resolve, reject) => {
        const id = next++;
        const timer = setTimeout(() => { pending.delete(id); reject(Error(`The app did not answer (${type})`)); }, timeoutMs);
        pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
        port.postMessage({ request: id, type, payload });
      });
    },
  });
}
