#!/usr/bin/env node
// Stands in for tor in offline tests: prints tor's start-up log lines and
// serves a SOCKS5 port (any login, as tor with IsolateSOCKSAuth). With
// FAKE_TOR_FAIL=1 it fails the way tor does when it cannot start.
const { startSocks } = await import(new URL('../socks.ts', import.meta.url));
if (process.env.FAKE_TOR_FAIL === '1') {
  console.log('Sep 18 12:00:00.000 [err] Reading config failed--see warnings above.');
  process.exit(1);
}
const socks = await startSocks('127.0.0.1', { credentials: 'any' });
console.log('Sep 18 12:00:00.000 [notice] Tor 0.4.9.12 running on Darwin.');
console.log(`Sep 18 12:00:00.100 [notice] Opened Socks listener connection (ready) on 127.0.0.1:${socks.port}`);
console.log('Sep 18 12:00:00.200 [notice] Bootstrapped 5% (conn): Connecting to a relay');
setTimeout(() => console.log('Sep 18 12:00:00.300 [notice] Bootstrapped 45% (requesting_descriptors): Asking for relay descriptors'), 100);
setTimeout(() => console.log('Sep 18 12:00:00.400 [notice] Bootstrapped 100% (done): Done'), 250);
process.on('SIGTERM', async () => { await socks.close(); process.exit(0); });
