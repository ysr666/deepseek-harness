/**
 * Loader-level activation dependencies owned by the shipped Web composition.
 *
 * These are distinct from `dsh.client.inject`: a Loader row's `inject` is
 * merged into the Cordis fiber dependency map before activation, so the row
 * stays pending until the named service exists.
 */

import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { composeEntries, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'

const WEB_PATCH = fileURLToPath(new URL('../cordis.patch.yml', import.meta.url))

describe('web bundle activation dependencies', () => {
  it('holds client-modules behind the official webServer carrier', () => {
    const entries = composeEntries([loadOverlayPatches('web-app activation test', WEB_PATCH)])
    const modules = entries.find(entry => entry.id === 'modules')

    expect(modules?.name).toBe('@deepseek-ai/dsh-client-modules')
    expect(modules?.inject).toEqual(['webServer'])
  })
})
