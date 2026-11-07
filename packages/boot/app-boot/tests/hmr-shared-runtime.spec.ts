/** Keep unaffected sibling Loader entries active while a shared plugin's other Fiber is rebuilt. */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { boot, recomposeProfile } from '../src/index.ts'

it('preserves an unchanged sibling when two entries share one plugin Runtime', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-806-shared-runtime-'))
  const file = (name: string, data: string) => writeFileSync(join(dir, name), data)
  const stable = 'stableFor806Shared'
  const ephemeral = 'ephemeralFor806Shared'
  const stats = { started: 0, active: 0, disposed: 0 }
  const statsKey = '__dsh806SharedRuntimeLifecycle'
  ;(globalThis as unknown as Record<string, unknown>)[statsKey] = stats
  file('stable.mjs', "export const name='stable';export function apply(ctx){ctx.provide('stableFor806Shared',{ok:true})}\n")
  file('ready.mjs', "export const name='ready';export function apply(ctx){ctx.provide('ephemeralFor806Shared',{ok:true})}\n")
  file('consumer.mjs', "export const name='shared-consumer';export const inject=['stableFor806Shared'];export function apply(ctx){const s=globalThis.__dsh806SharedRuntimeLifecycle;s.started++;ctx.effect(()=>{s.active++;return()=>{s.disposed++;s.active--}})}\n")
  file('cordis.yml', [
    '- id: stable', '  name: ./stable.mjs',
    '- id: changing', '  name: ./consumer.mjs',
    '  inject: [' + stable + ']',
    '- id: sibling', '  name: ./consumer.mjs',
    '  inject: [' + stable + ']', '',
  ].join('\n'))
  const originalProfile = readFileSync(join(dir, 'cordis.yml'), 'utf8')
  const overlay = [
    { insert: [{ id: 'ready', name: './ready.mjs' }] },
    { id: 'changing', name: './consumer.mjs', inject: [stable, ephemeral] },
  ]
  let ctx: Awaited<ReturnType<typeof boot>> | undefined
  try {
    ctx = await boot('dsh-test-bin', join(dir, 'cordis.yml'), overlay)
    const current = ctx
    const entry = (id: string) => [...current.loader.entries()].find(row => row.options.id === id)
    const sibling = entry('sibling')?.fiber
    const runtime = sibling?.runtime
    if (!sibling || !runtime) throw new Error('shared Runtime fixture failed to mount sibling')
    expect(entry('changing')?.fiber?.runtime).toBe(runtime)
    expect(runtime.fibers).toHaveLength(2)
    expect(stats.active).toBe(2)
    for (let index = 0; index < 8; index++) {
      const previousChanging = entry('changing')?.fiber
      await recomposeProfile(current, [], 'dsh-test-bin')
      await current.loader.await()
      expect(entry('changing')?.options.inject).toEqual([stable])
      expect(Object.keys(entry('changing')?.fiber?.inject ?? {})).toEqual([stable])
      expect(entry('changing')?.fiber).not.toBe(previousChanging)
      expect(entry('sibling')?.fiber).toBe(sibling)
      expect(sibling.state).toBe(2)
      expect(runtime.fibers).toHaveLength(2)
      expect(current.registry.has(runtime.callback)).toBe(true)
      expect(stats.active).toBe(2)

      const changedUid = entry('changing')?.fiber?.uid
      await recomposeProfile(current, overlay, 'dsh-test-bin')
      await current.loader.await()
      expect(entry('changing')?.options.inject).toEqual([stable, ephemeral])
      expect(Object.keys(entry('changing')?.fiber?.inject ?? {})).toEqual([stable, ephemeral])
      expect(entry('changing')?.fiber?.uid).not.toBe(changedUid)
      expect(entry('changing')?.fiber?.runtime).toBe(runtime)
      expect(entry('sibling')?.fiber).toBe(sibling)
      expect(runtime.fibers).toHaveLength(2)
      expect(stats.started).toBe(stats.disposed + 2)
      expect(stats.active).toBe(2)
      expect(entry('changing')?.options.disabled).toBeUndefined()
      expect(entry('sibling')?.options.disabled).toBeUndefined()
      expect(readFileSync(join(dir, 'cordis.yml'), 'utf8')).toBe(originalProfile)
    }
  } finally {
    await ctx?.fiber.dispose()
    expect(stats.active).toBe(0)
    expect(stats.started).toBe(stats.disposed)
    delete (globalThis as unknown as Record<string, unknown>)[statsKey]
    rmSync(dir, { recursive: true, force: true })
  }
})
