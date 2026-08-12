// SSRF guard unit tests (plan §17.2). IP-literal and protocol branches need no
// DNS, so they run offline. isPrivateIp is pure.
import { test } from 'node:test'
import assert from 'node:assert/strict'

const { isPrivateIp, assertPublicUrl } = await import('../dist/net/safeHttp.js')

test('isPrivateIp flags private/link-local/loopback ranges', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.1', '172.16.5.5', '172.31.9.9', '169.254.169.254', '0.0.0.0', '::1', 'fc00::1', 'fe80::1']) {
    assert.equal(isPrivateIp(ip), true, ip)
  }
  for (const ip of ['8.8.8.8', '1.1.1.1', '172.15.0.1', '172.32.0.1', '2606:4700:4700::1111']) {
    assert.equal(isPrivateIp(ip), false, ip)
  }
})

test('assertPublicUrl rejects non-http, localhost and private IPs', async () => {
  await assert.rejects(assertPublicUrl('ftp://example.com'))
  await assert.rejects(assertPublicUrl('file:///etc/passwd'))
  await assert.rejects(assertPublicUrl('not a url'))
  await assert.rejects(assertPublicUrl('http://localhost/x'))
  await assert.rejects(assertPublicUrl('http://127.0.0.1/x'))
  await assert.rejects(assertPublicUrl('http://10.0.0.1/x'))
  await assert.rejects(assertPublicUrl('http://169.254.169.254/latest/meta-data'))
  await assert.rejects(assertPublicUrl('http://something.internal/x'))
})

test('assertPublicUrl allows a public IP literal (no DNS needed)', async () => {
  const url = await assertPublicUrl('https://8.8.8.8/')
  assert.equal(url.hostname, '8.8.8.8')
})
