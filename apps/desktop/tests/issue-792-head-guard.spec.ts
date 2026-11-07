/** Protect Desktop's boot source from author CSS that makes <head> visible. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { serveWebDocument } from '../src/web-document.ts'

it('keeps the Desktop bootstrap head explicitly hidden before third-party CSS loads', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-792-head-guard-'))
  try {
    await writeFile(join(root, 'index.html'),
      '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root">ready</div></body></html>')
    for (const pathname of ['/', '/index.html']) {
      const response = await serveWebDocument(new Request('dsh-app://app' + pathname), root)
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')
      const html = await response.text()
      const head = html.indexOf('<head style="display: none !important">')
      const bootstrap = html.indexOf('globalThis.__DSH_BOOT_READY__ = Promise.withResolvers()')
      const body = html.indexOf('<body>')
      expect(head).toBeGreaterThanOrEqual(0)
      expect(bootstrap).toBeGreaterThan(head)
      expect(bootstrap).toBeLessThan(body)
      expect(html).toContain('<div id="root">ready</div>')
      expect(html).toMatch(/<head style="display: none !important"><script>/)
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
