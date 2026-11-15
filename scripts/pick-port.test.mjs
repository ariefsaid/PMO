import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { pickPort } from './lib/pick-port.mjs';

const hold = (port = 0) =>
  new Promise((resolve) => {
    const s = net.createServer();
    s.listen(port, () => resolve(s));
  });

test('pickPort keeps the preferred port when it is free', async () => {
  const probe = await hold();
  const free = probe.address().port;
  await new Promise((r) => probe.close(r));
  assert.equal(await pickPort(free), free);
});

test('pickPort moves to another free port when the preferred one is busy', async () => {
  const busy = await hold();
  try {
    const got = await pickPort(busy.address().port);
    assert.notEqual(got, busy.address().port);
    assert.ok(got > 0 && got < 65536);
  } finally {
    busy.close();
  }
});

test('pickPort never returns an avoided port', async () => {
  const probe = await hold();
  const free = probe.address().port;
  await new Promise((r) => probe.close(r));
  assert.notEqual(await pickPort(free, [free]), free);
});
