import { expect, mock, test } from 'claude-code/testing'

const band = (isWorking: boolean) =>
  ({
    plugin: 'neontide',
    component: 'AbovePrompt',
    requestId: 'band',
    surface: 'terminal',
    props: { hasSurvey: false, isCollapsed: false, isWorking, maxRows: 12, bodyColumns: 40, scroll: { offset: 0, bodyRows: 11 }, view: {} },
  }) as const

function engine(on: any, store: Map<string, unknown>) {
  on('store.get', (_: unknown, e: any) => ({ value: store.get(e.key) }))
  on('store.set', (_: unknown, e: any) => (store.set(e.key, e.value), { value: undefined }))
  on('command.register', (_: unknown, e: any) => ({ value: { command: e.name } }))
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('clock.every', () => ({ value: {} }))
  on('ui.blit', () => ({ value: {} }))
}

test('a new install: the simulation is on, boots first, and shows only while Claude works', async ($, on) => {
  const store = new Map<string, unknown>()
  engine(on, store)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const status = (await $.command.run({ command: 'neontide', args: '' })).text ?? ''
  expect(status).toContain('Now: post, then scanner code')
  expect(status).toContain('The simulation is on')

  let ui = await $.ui.mount(band(true))
  expect(await ui.find({ type: 'Raster' })).toBeTruthy()
  await ui.unmount()
  ui = await $.ui.mount(band(false))
  expect(await ui.find({ type: 'Raster' })).toBeFalsy()
  await ui.unmount()
})

test('/neontide off and on', async ($, on) => {
  const store = new Map<string, unknown>()
  engine(on, store)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  expect((await $.command.run({ command: 'neontide', args: 'on' })).text).toBe('The simulation is already on.')
  expect((await $.command.run({ command: 'neontide', args: 'off' })).text).toBe('Simulation off')
  expect(store.get('v2.on')).toBe(false)
  expect((await $.command.run({ command: 'neontide', args: 'off' })).text).toBe('The simulation is already off.')
  expect((await $.command.run({ command: 'neontide', args: '' })).text).toBe('The simulation is off. /neontide on starts it.')
  let ui = await $.ui.mount(band(true))
  expect(await ui.find({ type: 'Raster' })).toBeFalsy()
  await ui.unmount()

  expect((await $.command.run({ command: 'neontide', args: 'ON' })).text).toBe('Simulation on: it boots the next time Claude works.')
  expect(store.get('v2.on')).toBe(true)
  expect((await $.command.run({ command: 'neontide', args: '' })).text).toContain('Now: post, then scanner code')
  ui = await $.ui.mount(band(true))
  expect(await ui.find({ type: 'Raster' })).toBeTruthy()
  await ui.unmount()

  expect((await $.command.run({ command: 'neontide', args: 'maybe' })).text).toBe('Usage: /neontide on|off')
})

test('off stays off at the next load', async ($, on) => {
  engine(on, new Map<string, unknown>([['v2.on', false]]))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect((await $.command.run({ command: 'neontide', args: '' })).text).toContain('is off')
  const ui = await $.ui.mount(band(true))
  expect(await ui.find({ type: 'Raster' })).toBeFalsy()
  await ui.unmount()
})

test('the simulation carries on from the saved position at the next load, after its POST', { timeoutMs: 60000 }, async ($, on) => {
  const store = new Map<string, unknown>([['v2.tidePos', { full: true, cat: 2, variant: 'gold', left: ['sunset', 'lava', 'nope'], recent: {} }]])
  on('store.get', (_: unknown, e: any) => ({ value: store.get(e.key) }))
  on('store.set', (_: unknown, e: any) => (store.set(e.key, e.value), { value: undefined }))
  on('command.register', (_: unknown, e: any) => ({ value: { command: e.name } }))
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('turn.start', (_: unknown, e: any) => ({ turnId: e.turnId }))
  let mountedRows = 0
  on('ui.blit', (_: unknown, e: any) => (e.cells.length > 0 && mountedRows > 0 ? { value: {} } : { value: { deny: 'not drawn' } }))
  const clock = mock.clock(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect((await $.command.run({ command: 'neontide', args: '' })).text).toContain('Now: post, then aurora gold')
  await $.turn.start({ text: '', turnId: 't1' } as any)
  const ui = await $.ui.mount(band(true))
  mountedRows = ((await ui.find({ type: 'Raster' })) as any).props.rows
  const labels: string[] = []
  for (let f = 0; f < 1500 && labels[labels.length - 1] !== 'warp speedlines'; f++) {
    await clock.advance(90)
    mountedRows = ((await ui.find({ type: 'Raster' })) as any)?.props.rows ?? mountedRows
    const label = (/^Now: (.+)$/m.exec((await $.command.run({ command: 'neontide', args: '' })).text ?? '')?.[1] ?? '').trim()
    if (labels[labels.length - 1] !== label) labels.push(label)
  }
  await ui.unmount()
  // the POST plays first at a load, then the variants still to come (unknown names dropped), then the next category
  expect(labels.join(',')).toBe('post, then aurora gold,aurora gold,aurora sunset,aurora lava,warp speedlines')
  // and the new position is saved
  await clock.advance(1000)
  expect((store.get('v2.tidePos') as { cat: number }).cat).toBe(3)
})

test('/neontide demo answers only where NEONTIDE_DEMO is 1, and then plays while Claude is idle', async ($, on) => {
  const env = new Map<string, string>()
  engine(on, new Map<string, unknown>())
  on('env.get', (_: unknown, e: any) => ({ value: env.get(e.name) }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  expect((await $.command.run({ command: 'neontide', args: 'demo' })).text).toBe('Usage: /neontide on|off')
  let ui = await $.ui.mount(band(false))
  expect(await ui.find({ type: 'Raster' })).toBeFalsy()
  await ui.unmount()

  env.set('NEONTIDE_DEMO', '1')
  expect((await $.command.run({ command: 'neontide', args: 'demo' })).text).toBe('Simulation demo: one round while Claude is idle.')
  ui = await $.ui.mount(band(false))
  expect(await ui.find({ type: 'Raster' })).toBeTruthy()
  await ui.unmount()
})

test('a saved position that no longer fits starts the round again', async ($, on) => {
  engine(on, new Map<string, unknown>([['v2.tidePos', { full: true, cat: 3, variant: 'inward', left: [], recent: {} }]]))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect((await $.command.run({ command: 'neontide', args: '' })).text).toContain('Now: post, then scanner code')
})
