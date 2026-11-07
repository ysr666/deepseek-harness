/** Regression: profile bundle HMR must not strand old Fiber injections. */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { boot, recomposeProfile } from '../src/index.ts'

it('recreates a consumer Fiber when an injected bundle service is removed', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-stale-fiber-inject-'))
  const file = (name: string, body: string): void => { writeFileSync(join(dir, name), body) }
  const stable = 'stableFor806'
  const ephemeral = 'ephemeralFor806'
  file('stable.mjs', "export const name='stable'; export function apply(ctx){ctx.provide('stableFor806', {ok:true})}\n")
  file('ready.mjs', "export const name='ready'; export function apply(ctx){ctx.provide('ephemeralFor806', {ok:true})}\n")
  file('consumer.mjs', "export const name='consumer'; export const inject=['stableFor806']; export function apply(ctx){ctx.provide('consumerFor806', {ok:true})}\n")
  file('cordis.yml', [
    '- id: stable',
    '  name: ./stable.mjs',
    '- id: consumer',
    '  name: ./consumer.mjs',
    `  inject: [${stable}]`,
    '',
  ].join('\n'))
  const overlay = [
    { insert: [{ id: 'ready', name: './ready.mjs' }] },
    { id: 'consumer', name: './consumer.mjs', inject: [stable, ephemeral] },
  ]
  let ctx: Awaited<ReturnType<typeof boot>> | undefined
  try {
    ctx = await boot('dsh-test-bin', join(dir, 'cordis.yml'), overlay)
    const current = ctx
    const entry = (id: string) => [...current.loader.entries()].find(row => row.options.id === id)
    const first = entry('consumer')
    expect(first?.options.inject).toEqual([stable, ephemeral])
    expect(Object.keys(first?.fiber?.inject ?? {})).toContain(ephemeral)
    const initialState = first?.fiber?.state

    await recomposeProfile(current, [], 'dsh-test-bin')
    await current.loader.await()
    const restored = entry('consumer')
    expect(restored?.options.inject).toEqual([stable])
    expect(Object.keys(restored?.fiber?.inject ?? {})).toEqual([stable])
    expect(restored?.fiber?.state).toBe(initialState)

    await recomposeProfile(current, overlay, 'dsh-test-bin')
    await current.loader.await()
    const reenabled = entry('consumer')
    expect(reenabled?.options.inject).toEqual([stable, ephemeral])
    expect(Object.keys(reenabled?.fiber?.inject ?? {})).toEqual([stable, ephemeral])
    expect(reenabled?.fiber?.state).toBe(initialState)

    const beforeNoop = reenabled?.fiber?.uid
    await recomposeProfile(current, overlay, 'dsh-test-bin')
    await current.loader.await()
    expect(entry('consumer')?.fiber?.uid).toBe(beforeNoop)
  } finally {
    await ctx?.fiber.dispose()
    rmSync(dir, { recursive: true, force: true })
  }
})
