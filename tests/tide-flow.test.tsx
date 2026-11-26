import { expect, mock, test } from 'claude-code/testing'

// Runs the real frame clock through the end of a tide full round: glitch → crash → reboot (ERROR : SIMULATION v1.N
// FAILED, RESTARTING v1.N+1…, 2-row matrix rain that ends) → scanner, no transition. The band shrinks from 2 rows to 1.
// The engine refuses a frame of another size than the mounted Raster; that used to drop the band and
// restart the scanner from the left partway through its first lap.
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
function decode(s: string): number[] {
  const bytes: number[] = []
  for (let i = 0; i < s.length; i += 4) {
    const n = (B64.indexOf(s[i]!) << 18) | (B64.indexOf(s[i + 1]!) << 12) | ((s[i + 2] === '=' ? 0 : B64.indexOf(s[i + 2]!)) << 6) | (s[i + 3] === '=' ? 0 : B64.indexOf(s[i + 3]!))
    bytes.push((n >> 16) & 255)
    if (s[i + 2] !== '=') bytes.push((n >> 8) & 255)
    if (s[i + 3] !== '=') bytes.push(n & 255)
  }
  const words: number[] = []
  for (let i = 0; i + 3 < bytes.length; i += 4) words.push((bytes[i]! | (bytes[i + 1]! << 8) | (bytes[i + 2]! << 16) | (bytes[i + 3]! << 24)) >>> 0)
  return words
}

// The simulation plays its POST at every load and every start. Runs the clock through it, keeping the test's
// idea of the mounted height up to date, until the saved band (or the round's first) is on.
async function throughPost($: any, clock: any, ui: any, rows: (n: number) => void): Promise<void> {
  for (let f = 0; f < 800; f++) {
    const r = ((await ui.find({ type: 'Raster' })) as any)?.props.rows
    if (r) rows(r)
    const label = /^Now: (\w+)/.exec((await $.command.run({ command: 'neontide', args: '' })).text ?? '')?.[1]
    if (label !== 'post') return
    await clock.advance(90)
  }
}

test('glitch crashes into the reboot, its rain ends, and then a clean scanner starts and keeps its lap', { timeoutMs: 120000 }, async ($, on) => {
  const W = 60
  const store = new Map<string, unknown>([
    ['v2.tide', true],
    ['v2.tideFull', true],
    ['v2.tidePos', { full: true, cat: 11, variant: '', left: [], recent: {} }],
  ])
  on('store.get', (_: unknown, e: any) => ({ value: store.get(e.key) }))
  on('store.set', (_: unknown, e: any) => (store.set(e.key, e.value), { value: undefined }))
  on('command.register', (_: unknown, e: any) => ({ value: { command: e.name } }))
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('turn.start', (_: unknown, e: any) => ({ turnId: e.turnId }))
  let mountedRows = 0
  let shown: number[] = []
  on('ui.blit', (_: unknown, e: any) => {
    // the engine takes a frame only at the size the Raster is drawn at; a redraw asked for in this frame
    // lands after this frame's blit, so the size it checks against is the one drawn by the previous frame
    const cells = decode(e.cells)
    if (cells.length / 3 !== W * mountedRows) return { value: { deny: 'another size' } }
    shown = cells
    return { value: {} }
  })
  const clock = mock.clock(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: '', turnId: 't1' } as any)
  const site = { plugin: 'neontide', component: 'AbovePrompt', requestId: 'band', surface: 'terminal', props: { hasSurvey: false, isCollapsed: false, isWorking: true, maxRows: 12, bodyColumns: W, scroll: { offset: 0, bodyRows: 11 }, view: {} } } as const
  const ui = await $.ui.mount(site)
  await throughPost($, clock, ui, n => (mountedRows = n))
  const row = (y: number): string => Array.from({ length: W }, (_, i) => String.fromCodePoint(shown[(y * W + i) * 3] ?? 32)).join('')
  const frames: { band: string; rows: number; top: string; bottom: string; lit: number }[] = []
  for (let f = 0; f < 420; f++) {
    await clock.advance(90)
    mountedRows = ((await ui.find({ type: 'Raster' })) as any)?.props.rows ?? mountedRows
    const band = /^Now: (\w+)/.exec((await $.command.run({ command: 'neontide', args: '' })).text ?? '')?.[1] ?? ''
    if (shown.length !== W * mountedRows * 3) continue
    frames.push({ band, rows: mountedRows, top: row(0), bottom: row(mountedRows - 1), lit: Array.from({ length: W }, (_, i) => shown[((mountedRows - 1) * W + i) * 3 + 1]).filter(c => c === 0x00ff41).length })
  }
  await ui.unmount()

  // the reboot: 2 rows; ERROR blinks (shown, hidden, shown again), then RESTARTING gains a dot a second
  // while the bar under it fills, then rain
  const reboot = frames.filter(f => f.band === 'reboot' && f.rows === 2)
  const error = reboot.map(f => f.top.includes('ERROR : SIMULATION v1.0 FAILED'))
  const firstError = error.indexOf(true)
  expect(firstError).toBeGreaterThanOrEqual(0)
  const hidden = error.indexOf(false, firstError)
  expect(hidden).toBeGreaterThan(firstError)
  expect(error.indexOf(true, hidden)).toBeGreaterThan(hidden)
  // the failed version is v1.0 (a fresh store) and the restart is v1.1; the next round's version is saved
  const dots = reboot.map(f => /RESTARTING v1\.1(\.*)/.exec(f.top)?.[1]?.length ?? -1).filter(n => n > 0)
  expect(dots.length).toBeGreaterThan(20)
  expect(dots[0]).toBe(1)
  expect(dots[dots.length - 1]).toBe(3)
  for (let i = 1; i < dots.length; i++) expect(dots[i]!).toBeGreaterThanOrEqual(dots[i - 1]!)
  const bar = reboot.filter(f => f.top.includes('RESTARTING')).map(f => f.lit)
  expect(bar[bar.length - 1]!).toBeGreaterThan(bar[0]!)
  expect(bar[bar.length - 1]!).toBeLessThan(W / 2)
  const rain = reboot.filter(f => !f.top.includes('ERROR') && !f.top.includes('RESTARTING') && f.bottom.trim() !== '')
  expect(rain.length).toBeGreaterThan(20)
  // the rain ends: the top row empties first, then the bottom row, and the band ends empty
  expect(rain[rain.length - 1]!.top.trim()).toBe('')
  const last = reboot[reboot.length - 1]!
  expect(last.top.trim() + last.bottom.trim()).toBe('')

  // the scanner: one row, the beam starts at the left and moves on without starting again, with no
  // rain left ahead of it
  const scan = frames.filter(f => f.band === 'scanner' && f.rows === 1)
  const beam = scan.map(f => f.top.indexOf('█')).filter(x => x >= 0)
  expect(beam.length).toBeGreaterThan(20)
  expect(beam[0]!).toBeLessThan(10)
  const out = beam.findIndex(x => x === W - 1)
  expect(out).toBeGreaterThan(0)
  for (let i = 1; i <= out; i++) expect(beam[i]! - beam[i - 1]!).toBeGreaterThanOrEqual(0)
  expect(scan.slice(0, 10).every(f => f.top.slice(f.top.indexOf('█') + 2).trim() === '')).toBe(true)
  // the crash made the next loop of this session's simulation: v1.1, saved under its session id
  expect((store.get('v2.sim') as any).sessions.local.loops).toBe(1)
})

test('in the simulation the ember turns rainbow at its end and trippy floods up out of it', { timeoutMs: 120000 }, async ($, on) => {
  const W = 60
  const store = new Map<string, unknown>([
    ['v2.tide', true],
    ['v2.tideFull', true],
    ['v2.tidePos', { full: true, cat: 9, variant: 'ember', left: [], recent: {} }],
  ])
  on('store.get', (_: unknown, e: any) => ({ value: store.get(e.key) }))
  on('store.set', (_: unknown, e: any) => (store.set(e.key, e.value), { value: undefined }))
  on('command.register', (_: unknown, e: any) => ({ value: { command: e.name } }))
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('turn.start', (_: unknown, e: any) => ({ turnId: e.turnId }))
  let shown: number[] = []
  on('ui.blit', (_: unknown, e: any) => ((shown = decode(e.cells)), { value: {} }))
  const clock = mock.clock(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: '', turnId: 't1' } as any)
  const site = { plugin: 'neontide', component: 'AbovePrompt', requestId: 'band', surface: 'terminal', props: { hasSurvey: false, isCollapsed: false, isWorking: true, maxRows: 12, bodyColumns: W, scroll: { offset: 0, bodyRows: 11 }, view: {} } } as const
  const ui = await $.ui.mount(site)
  await throughPost($, clock, ui, () => {})
  // a cell is "cool" when blue is its strongest channel or green beats red: ember's own colours never are
  const cool = (fg: number) => (fg & 255) > ((fg >> 16) & 255) || ((fg >> 8) & 255) > ((fg >> 16) & 255)
  const seen: { band: string; cool: number; full: number }[] = []
  for (let f = 0; f < 160; f++) {
    await clock.advance(90)
    const band = /^Now: (\w+)/.exec((await $.command.run({ command: 'neontide', args: '' })).text ?? '')?.[1] ?? ''
    let c = 0
    let full = 0
    for (let i = 0; i < shown.length; i += 3) {
      if (shown[i] === 32) continue
      full++
      if (shown[i + 1]! < 0x01000000 && cool(shown[i + 1]!)) c++
    }
    seen.push({ band, cool: c, full })
  }
  await ui.unmount()
  const ember = seen.filter(s => s.band === 'rain')
  expect(ember.length).toBeGreaterThan(80)
  // fire colours only until its last 2 seconds, rainbow by the end
  expect(ember.slice(0, 60).every(s => s.cool === 0)).toBe(true)
  expect(ember[ember.length - 1]!.cool).toBeGreaterThan(0)
  // then trippy fills the whole band
  const trippy = seen.filter(s => s.band === 'trippy')
  expect(trippy.length).toBeGreaterThan(22)
  expect(trippy[trippy.length - 1]!.full).toBe(W * 3)
})

test('aurora to warp: the auroras run 2.5 s each, the last burns out into dots, the pac-man appears, and the band grows to the maze it eats through', { timeoutMs: 120000 }, async ($, on) => {
  const W = 60
  const store = new Map<string, unknown>([
    ['v2.tide', true],
    ['v2.tideFull', true],
    ['v2.tidePos', { full: true, cat: 2, variant: 'ocean', left: ['ice', 'ghost'], recent: {} }],
  ])
  on('store.get', (_: unknown, e: any) => ({ value: store.get(e.key) }))
  on('store.set', (_: unknown, e: any) => (store.set(e.key, e.value), { value: undefined }))
  on('command.register', (_: unknown, e: any) => ({ value: { command: e.name } }))
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('turn.start', (_: unknown, e: any) => ({ turnId: e.turnId }))
  let mountedRows = 0
  let shown: number[] = []
  on('ui.blit', (_: unknown, e: any) => {
    const cells = decode(e.cells)
    if (cells.length / 3 !== W * mountedRows) return { value: { deny: 'another size' } }
    shown = cells
    return { value: {} }
  })
  const clock = mock.clock(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: '', turnId: 't1' } as any)
  const site = { plugin: 'neontide', component: 'AbovePrompt', requestId: 'band', surface: 'terminal', props: { hasSurvey: false, isCollapsed: false, isWorking: true, maxRows: 12, bodyColumns: W, scroll: { offset: 0, bodyRows: 11 }, view: {} } } as const
  const ui = await $.ui.mount(site)
  await throughPost($, clock, ui, n => (mountedRows = n))
  mountedRows = ((await ui.find({ type: 'Raster' })) as any).props.rows
  const rows: string[][] = []
  const labels: string[] = []
  for (let f = 0; f < 300; f++) {
    await clock.advance(90)
    mountedRows = ((await ui.find({ type: 'Raster' })) as any)?.props.rows ?? mountedRows
    labels.push((/^Now: ([\w ]+)/.exec((await $.command.run({ command: 'neontide', args: '' })).text ?? '')?.[1] ?? '').trim())
    if (shown.length !== W * mountedRows * 3) continue
    rows.push(Array.from({ length: mountedRows }, (_, y) => Array.from({ length: W }, (_, i) => String.fromCodePoint(shown[(y * W + i) * 3] ?? 32)).join('')))
  }
  await ui.unmount()
  // the auroras: ice and ghost each last AURORA_JOURNEY_FRAMES (28 frames, about 2.5 s)
  const firstIce = labels.indexOf('aurora ice')
  const firstGhost = labels.indexOf('aurora ghost')
  expect(firstIce).toBeGreaterThanOrEqual(0)
  expect(Math.abs(firstGhost - firstIce - 28)).toBeLessThanOrEqual(1)
  const one = rows.filter(r => r.length === 1).map(r => r[0]!)
  // burnout, no scanner: the aurora dims and goes out leaving bits, with no beam anywhere
  const aurora = /[░▒▓█]/
  expect(one.some(r => aurora.test(r) && r.includes('·'))).toBe(true)
  expect(one.some(r => !aurora.test(r) && r.includes('·'))).toBe(true)
  // turn: the pac-man at the left edge, dots on every even column from 2
  const turn = one.find(r => r[0] === 'C' || r[0] === 'O')
  expect(turn).toBeTruthy()
  expect(turn!.slice(2, 12)).toBe('. . . . . ')
  // the maze: 3 rows, walls above and below, the pac-man in the middle moving right 2 columns a frame,
  // eating the dots, ghosts behind it; he runs off the right edge and comes back in from the left once
  // (the tunnel), with the ghosts following
  const maze = rows.filter(r => r.length === 3 && r[0]!.trim().replace(/-/g, '') === '' && /[CO]/.test(r[1]!) && !r[1]!.includes('<'))
  expect(maze.length).toBeGreaterThan(10)
  const pac = maze.map(r => r[1]!.search(/[CO]/))
  const steps = pac.slice(1).map((p, i) => p - pac[i]!)
  // every step is 2 columns, except the one jump through the tunnel (negative) and standing still where he stops
  expect(steps.filter(d => d !== 2 && d !== 0).length).toBe(1)
  expect(steps.find(d => d !== 2 && d !== 0)!).toBeLessThan(0)
  const firstPass = maze.slice(0, steps.findIndex(d => d < 0) + 1)
  for (const r of firstPass) expect(r[1]!.slice(0, r[1]!.search(/[CO]/)).includes('.')).toBe(false)
  expect(maze.some(r => r[1]!.includes('ᗣ'))).toBe(true)
  // the ship builds round him a third of the way in (column 20 of 60): ╼◁◖{C}◗━━▶ with exhaust behind
  const ship = rows.filter(r => r.length === 3 && /╼◁◖\{[CO]\}◗━━▶/.test(r[1]!))
  expect(ship.length).toBeGreaterThan(20)
  for (const r of ship.slice(0, 10)) expect(r[1]!.search(/[CO]\}◗━━▶/)).toBe(20)
  expect(ship.some(r => r[1]!.includes('·∙≈╼'))).toBe(true)
  // then the walls stream away to the LEFT as streaks and warp takes over around the ship
  const launch = rows.indexOf(ship.find(r => r[0]!.includes('━'))!)
  expect(launch).toBeGreaterThan(0)
  const after = rows.slice(launch + 16)
  // the walls are gone (the stream's few short dashes near the core aside), and speedlines' streaks rush past
  for (const y of [0, 2]) expect(after[0]![y]!.split('-').length - 1).toBeLessThan(6)
  expect(after.slice(0, 10).some(r => r[1]!.includes('━'))).toBe(true)
  // through warp the ship stays put on the middle row
  expect(after.slice(0, 40).every(r => /╼◁◖\{[CO]\}◗━━▶/.test(r[1]!))).toBe(true)
})

test('the simulation starts with the POST: cursor, title, boot lines loading unevenly to 100%, stability WARN, then rain and the code scanner', { timeoutMs: 120000 }, async ($, on) => {
  const W = 60
  const store = new Map<string, unknown>()
  on('store.get', (_: unknown, e: any) => ({ value: store.get(e.key) }))
  on('store.set', (_: unknown, e: any) => (store.set(e.key, e.value), { value: undefined }))
  on('command.register', (_: unknown, e: any) => ({ value: { command: e.name } }))
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('turn.start', (_: unknown, e: any) => ({ turnId: e.turnId }))
  let mountedRows = 0
  let shown: number[] = []
  on('ui.blit', (_: unknown, e: any) => {
    const cells = decode(e.cells)
    if (cells.length / 3 !== W * mountedRows) return { value: { deny: 'another size' } }
    shown = cells
    return { value: {} }
  })
  const clock = mock.clock(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: '', turnId: 't1' } as any)
  // on by default: a new install starts with the boot
  expect((await $.command.run({ command: 'neontide', args: '' })).text).toContain('post, then scanner code')
  const site = { plugin: 'neontide', component: 'AbovePrompt', requestId: 'band', surface: 'terminal', props: { hasSurvey: false, isCollapsed: false, isWorking: true, maxRows: 12, bodyColumns: W, scroll: { offset: 0, bodyRows: 11 }, view: {} } } as const
  const ui = await $.ui.mount(site)
  mountedRows = ((await ui.find({ type: 'Raster' })) as any).props.rows
  const frames: { band: string; rows: string[]; lit: number }[] = []
  for (let f = 0; f < 520; f++) {
    await clock.advance(90)
    mountedRows = ((await ui.find({ type: 'Raster' })) as any)?.props.rows ?? mountedRows
    const band = /^Now: (\w+)/.exec((await $.command.run({ command: 'neontide', args: '' })).text ?? '')?.[1] ?? ''
    if (shown.length !== W * mountedRows * 3) continue
    const rows = Array.from({ length: mountedRows }, (_, y) => Array.from({ length: W }, (_, i) => String.fromCodePoint(shown[(y * W + i) * 3] ?? 32)).join(''))
    const lit = Array.from({ length: W }, (_, i) => shown[((mountedRows - 1) * W + i) * 3 + 1]).filter(c => c === 0x00ff41).length
    frames.push({ band, rows, lit })
  }
  await ui.unmount()
  const post = frames.filter(f => f.band === 'post')
  expect(post[0]!.rows.length).toBe(2)
  expect(post[0]!.rows[0]!.trim()).toBe('▌')
  expect(post.some(f => f.rows[0]!.includes('SIMULATION v1.0'))).toBe(true)
  // each ok line loads 1 → 100%, unevenly: it stalls (the same percent twice) and jumps (more than 1)
  for (const line of ['loading signal', 'generating sky', 'seeding life', 'building space', 'forming weather', 'igniting fire']) {
    const pct = post.map(f => f.rows[0]!).filter(r => r.includes(line)).map(r => /(\d+)%/.exec(r)?.[1]).filter(Boolean).map(Number)
    expect(pct.length).toBeGreaterThan(25)
    for (let i = 1; i < pct.length; i++) expect(pct[i]!).toBeGreaterThanOrEqual(pct[i - 1]!)
    expect(pct[pct.length - 1]).toBe(100)
    expect(pct.some((p, i) => i > 0 && p === pct[i - 1])).toBe(true)
    expect(pct.some((p, i) => i > 0 && p - pct[i - 1]! > 1)).toBe(true)
  }
  // the stability check stops short and shows WARN
  const stab = post.map(f => f.rows[0]!).filter(r => r.includes('stability check'))
  expect(Math.max(...stab.map(r => Number(/(\d+)%/.exec(r)?.[1] ?? 0)))).toBeLessThan(100)
  expect(stab.some(r => r.includes('WARN'))).toBe(true)
  expect(post.some(f => f.rows[0]!.includes('> entering simulation...'))).toBe(true)
  // the thin bar under it fills over the boot
  expect(post[post.length - 1]!.lit === 0 || post.some(f => f.lit > 10)).toBe(true)
  // then the rain, which ends, then the code scanner on 1 row
  const after = frames.slice(frames.indexOf(post[post.length - 1]!) + 1)
  expect(after[0]!.band).toBe('scanner')
  expect(after.some(f => f.rows.length === 1 && f.rows[0]!.includes('█'))).toBe(true)
  // the simulation's scanners are quick (2 columns a frame): by now code may have handed over to rainbow
  expect((await $.command.run({ command: 'neontide', args: '' })).text).toMatch(/Now: scanner (code|rainbow)/)
})

test('the journey: from the last aurora through pac-man, warp, the space act, the dive and the storm to the strike and the fire', { timeoutMs: 300000 }, async ($, on) => {
  const W = 60
  const store = new Map<string, unknown>([
    ['v2.tide', true],
    ['v2.tideFull', true],
    ['v2.tidePos', { full: true, cat: 2, variant: 'ghost', left: [], recent: {} }],
  ])
  on('store.get', (_: unknown, e: any) => ({ value: store.get(e.key) }))
  on('store.set', (_: unknown, e: any) => (store.set(e.key, e.value), { value: undefined }))
  on('command.register', (_: unknown, e: any) => ({ value: { command: e.name } }))
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('turn.start', (_: unknown, e: any) => ({ turnId: e.turnId }))
  let mountedRows = 0
  let shown: number[] = []
  on('ui.blit', (_: unknown, e: any) => {
    const cells = decode(e.cells)
    if (cells.length / 3 !== W * mountedRows) return { value: { deny: 'another size' } }
    shown = cells
    return { value: {} }
  })
  const clock = mock.clock(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: '', turnId: 't1' } as any)
  const site = { plugin: 'neontide', component: 'AbovePrompt', requestId: 'band', surface: 'terminal', props: { hasSurvey: false, isCollapsed: false, isWorking: true, maxRows: 12, bodyColumns: W, scroll: { offset: 0, bodyRows: 11 }, view: {} } } as const
  let ui = await $.ui.mount(site)
  await throughPost($, clock, ui, n => (mountedRows = n))
  mountedRows = ((await ui.find({ type: 'Raster' })) as any).props.rows
  const frames: { label: string; rows: string[]; mid: number[] }[] = []
  let ended = -1
  for (let f = 0; f < 5000 && ended < 0; f++) {
    await clock.advance(90)
    const r = (await ui.find({ type: 'Raster' })) as any
    mountedRows = r.props.rows
    const label = (/^Now: ([\w ,]+?)(?: \(|$)/m.exec((await $.command.run({ command: 'neontide', args: '' })).text ?? '')?.[1] ?? '').trim()
    if (label === 'trippy') {
      ended = f
      break
    }
    if (shown.length !== W * mountedRows * 3) continue
    frames.push({ label, rows: Array.from({ length: mountedRows }, (_, y) => Array.from({ length: W }, (_, i) => String.fromCodePoint(shown[(y * W + i) * 3] ?? 32)).join('')), mid: Array.from({ length: W }, (_, i) => shown[(W + i) * 3 + 1] ?? 0) })
    // a fresh mount now and then picks up the band's new size
    if (f % 50 === 0) {
      await ui.unmount()
      ui = await $.ui.mount(site)
      mountedRows = ((await ui.find({ type: 'Raster' })) as any)?.props.rows ?? mountedRows
    }
  }
  await ui.unmount()
  const order: string[] = []
  for (const fr of frames) if (order[order.length - 1] !== fr.label) order.push(fr.label)
  expect(order.join(',')).toBe('aurora ghost,warp speedlines,warp dense,warp twin,warp gold,warp neon,warp hyper,warp jump,nebula,constellations,stars,comet,planet,rain drizzle,rain downpour,rain gale,rain neon,rain glints,rain ember')
  // then trippy floods up out of the fire
  expect(ended).toBeGreaterThan(0)
  const ship = /◖\{[CO]\}◗━━▶/
  const failed: number[] = []
  const chk = (line: number, ok: boolean) => { if (!ok) failed.push(line) }
  const of = (l: string) => frames.filter(f => f.label === l && f.rows.length === 3)
  // the ship flies through every space chapter, a third of the way in on the middle row
  for (const l of ['nebula', 'constellations', 'stars', 'comet', 'planet']) {
    const fs = of(l)
    // the planet only rises and the dive starts (about 5 s); the others are 20 s
    expect(fs.length).toBeGreaterThan(l === 'planet' ? 40 : 100)
    if (l === 'planet') expect(fs.length).toBeLessThan(70)
    expect(fs.filter(f => ship.test(f.rows[1]!)).length).toBeGreaterThan(fs.length * 0.9)
  }
  // one core per warp, in the centre; speedlines streams across the whole width (right half too)
  for (const f of frames.filter(f => f.label.startsWith('warp') && f.rows.length === 3)) expect(f.rows[1]!.split('✶').length - 1).toBeLessThanOrEqual(1)
  expect(of('warp speedlines').filter(f => /━/.test(f.rows[0]!.slice(36) + f.rows[2]!.slice(36))).length).toBeGreaterThan(of('warp speedlines').length * 0.5)
  // the ship moves: held forward through hyper, lunging into the jump, floating in the cruise (its spot is column 20)
  const pos = (f: { rows: string[] }) => f.rows[1]!.search(/[CO]}◗/)
  chk(901, of('warp hyper').slice(-10).every(f => pos(f) >= 22))
  chk(902, of('warp jump').some(f => pos(f) >= 23))
  const cruise = of('constellations').map(pos).filter(x => x >= 0)
  chk(903, cruise.every(x => x >= 19 && x <= 21) && new Set(cruise).size > 1)
  // the radial warps have a glowing core; the streams (speedlines, hyper) don't
  for (const v of ['speedlines', 'hyper']) expect(of('warp ' + v).slice(20).some(f => f.rows[1]!.includes('✶'))).toBe(false)
  for (const v of ['dense', 'twin', 'gold', 'neon', 'jump']) chk(62, of('warp ' + v).some(f => f.rows[1]!.includes('✶')))
  // the flame: orange through the first warps, the afterburner's shock diamonds at the end of neon,
  // blue through hyper, then a long tight white-blue jet in the jump (no diamonds); the ship's nozzle is at column 16 (shipX 20 − 4)
  const isBlue = (fg: number) => (fg & 255) > ((fg >> 16) & 255)
  chk(66, of('warp speedlines').filter(f => f.rows[1]![15] === '≈').every(f => !isBlue(f.mid[15]!)))
  chk(67, of('warp neon').some(f => f.rows[1]!.includes('◆')))
  const hyper = of('warp hyper').filter(f => f.rows[1]![13] === '≈')
  expect(hyper.length).toBeGreaterThan(20)
  chk(70, hyper.every(f => isBlue(f.mid[13]!)))
  expect(of('warp jump').some(f => f.rows[1]!.includes('◆'))).toBe(false)
  chk(72, of('warp jump').some(f => /≈{12}╼◁◖\{[CO]\}/.test(f.rows[1]!)))
  // the jump: lines from the core stretching out (long ━ runs on the outer rows), then the white blooms
  // out from the core (░▒▓█ at its front) to a solid white band, the ship a dark silhouette in it
  chk(75, of('warp jump').some(f => /━{6}/.test(f.rows[0]!) && /━{6}/.test(f.rows[2]!)))
  chk(76, of('warp jump').some(f => /[░▒▓]█+[▓▒░]/.test(f.rows[0]!) && !f.rows[0]!.startsWith('█')))
  const white = frames.filter(f => f.rows.length === 3 && f.rows[0] === '█'.repeat(W))
  expect(white.length).toBeGreaterThan(0)
  chk(79, white.every(f => /█╼◁◖\{[CO]\}◗━━▶█/.test(f.rows[1]!)))
  // the drop-out: the white fades down (▓▒░) into the nebula; the jet comes back as it fades
  chk(81, of('nebula').slice(0, 12).some(f => /[▓▒]{10}/.test(f.rows[0]!)))
  chk(82, of('nebula').slice(20, 40).every(f => /≈╼◁◖\{[CO]\}/.test(f.rows[1]!)))
  // the cruise after the jump: two ≈
  chk(84, of('constellations').every(f => !ship.test(f.rows[1]!) || /[^≈]≈≈╼◁◖\{[CO]\}/.test(f.rows[1]!)))
  // the comet streaks past under the ship, right to left
  const heads = of('comet').map(f => f.rows[2]!.indexOf('✸')).filter(x => x >= 0)
  expect(heads.length).toBeGreaterThan(20)
  chk(88, heads.slice(1, 8).every((x, i) => x <= heads[i]!))
  // only one comet in tide: the head only ever moves left
  chk(90, heads.slice(1).every((x, i) => x <= heads[i]!))
  // constellations: a blinking satellite crosses
  chk(92, of('constellations').some(f => f.rows.some(r => r.includes('◦'))))
  // the dive: the planet grows to fill the bottom row under the ship, then the ship is inside the cloud
  const dive = of('rain drizzle').slice(0, 78)
  chk(95, dive.some(f => /[▁▂▃▄▅▆▇█▓▒░]{50}/.test(f.rows[2]!) && ship.test(f.rows[1]!)))
  chk(96, dive.some(f => f.rows.every(r => /[█▓─]{15}/.test(r)) && ship.test(f.rows[1]!)))
  // the ship flies on through the storm (in gale it is buffeted a column either way)
  for (const l of ['rain drizzle', 'rain downpour', 'rain gale', 'rain neon', 'rain glints']) expect(of(l).filter(f => ship.test(f.rows[1]!)).length).toBeGreaterThan(of(l).length * 0.8)
  // the whole band lit like the cloud row (all rows ▀ but the ship): after the cloud row has flashed once or twice, and
  // about 2 s before the strike, at the end of glints (the lull after neon)
  const allLit = (f: { rows: string[] }) => /▀{40}/.test(f.rows[0]!) && /▀{20}/.test(f.rows[1]!) && /▀{40}/.test(f.rows[2]!)
  const early = of('rain downpour').concat(of('rain gale'))
  const firstAll = early.findIndex(allLit)
  expect(firstAll).toBeGreaterThan(0)
  // the cloud row alone flashes first
  chk(106, early.slice(0, firstAll).some(f => /▀{40}/.test(f.rows[0]!) && !allLit(f)))
  const acidFrames = of('rain glints')
  chk(108, acidFrames.slice(-30, -12).some(allLit))
  chk(109, acidFrames.slice(-30, -12).filter(allLit).every(f => ship.test(f.rows[1]!)))
  // lightning: sheet lightning (the top row lit ▀, no bolt) in downpour/gale, forked bolts (┗━┓, heavy, all
  // three rows) with the sky lit (░) in neon
  chk(112, of('rain downpour').concat(of('rain gale')).some(f => /▀{40}/.test(f.rows[0]!) && !f.rows.some(r => /[┗┛┏┓]/.test(r))))
  chk(113, of('rain neon').some(f => /[┗┛┏┓]━+[┗┛┏┓]/.test(f.rows[0]!) && f.rows.join('').split('░').length > 12))
  // the strike: the bolt, the explosion, the pac-man tumbling away, then no ship in the fire
  const ember = of('rain ember')
  chk(116, ember.slice(0, 40).some(f => /┗━+┓/.test(f.rows[0]!)))
  chk(117, ember.slice(0, 40).some(f => f.rows.some(r => /[✺*+]/.test(r))))
  chk(118, ember.slice(0, 40).some(f => f.rows.some(r => /[∪Ɔ∩]/.test(r))))
  expect(ember.slice(50).some(f => ship.test(f.rows[1]!))).toBe(false)
  // he tumbles for about 3 s
  expect(ember.slice(0, 50).filter(f => f.rows.some(r => /[C∪Ɔ∩]/.test(r))).length).toBeGreaterThanOrEqual(28)

  expect(failed.join(",")).toBe("")
})

test('a scanner hands over to the next at the left wall without a jump: the trail folds through the turn while the colours slide', { timeoutMs: 120000 }, async ($, on) => {
  const W = 40
  const store = new Map<string, unknown>()
  on('store.get', (_: unknown, e: any) => ({ value: store.get(e.key) }))
  on('store.set', (_: unknown, e: any) => (store.set(e.key, e.value), { value: undefined }))
  on('command.register', (_: unknown, e: any) => ({ value: { command: e.name } }))
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('turn.start', (_: unknown, e: any) => ({ turnId: e.turnId }))
  let mountedRows = 0
  let shown: number[] = []
  on('ui.blit', (_: unknown, e: any) => {
    const cells = decode(e.cells)
    if (cells.length / 3 !== W * mountedRows) return { value: { deny: 'another size' } }
    shown = cells
    return { value: {} }
  })
  const clock = mock.clock(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: '', turnId: 't1' } as any)
  // on by default: a new install starts with the boot
  const site = { plugin: 'neontide', component: 'AbovePrompt', requestId: 'band', surface: 'terminal', props: { hasSurvey: false, isCollapsed: false, isWorking: true, maxRows: 12, bodyColumns: W, scroll: { offset: 0, bodyRows: 11 }, view: {} } } as const
  const ui = await $.ui.mount(site)
  await throughPost($, clock, ui, n => (mountedRows = n))
  mountedRows = ((await ui.find({ type: 'Raster' })) as any).props.rows
  const frames: { label: string; row: string; fg: number[] }[] = []
  for (let f = 0; f < 2 * W + 20; f++) {
    await clock.advance(90)
    const label = (/^Now: ([\w ]+?)(?: \(|$)/m.exec((await $.command.run({ command: 'neontide', args: '' })).text ?? '')?.[1] ?? '').trim()
    if (shown.length !== W * 3) continue
    frames.push({ label, row: Array.from({ length: W }, (_, i) => String.fromCodePoint(shown[i * 3] ?? 32)).join(''), fg: Array.from({ length: W }, (_, i) => shown[i * 3 + 1] ?? 0) })
  }
  await ui.unmount()
  const at = frames.findIndex(f => f.label !== 'scanner code')
  // the simulation's beam moves 2 columns a frame, so a lap is about W frames
  expect(at).toBeGreaterThan(W / 2)
  // the turn: the last code frames and the first frames of the next scanner all have a trail by the wall
  // (it folds back off the wall instead of vanishing)
  for (const f of frames.slice(at - 1, at + 4)) expect(f.row.slice(0, 8).replace(/ /g, '').length).toBeGreaterThanOrEqual(4)
  // the head moves on two columns a frame through the hand-over, never jumping
  const head = frames.slice(at - 3, at + 4).map(f => f.row.indexOf('█'))
  for (let i = 1; i < head.length; i++) expect(Math.abs(head[i]! - head[i - 1]!)).toBeLessThanOrEqual(2)
  // the colours slide: the first frame of the new scanner still has the code scanner's green head
  const g = frames[at]!.fg[frames[at]!.row.indexOf('█')]!
  expect(((g >> 8) & 255) > ((g >> 16) & 255) && ((g >> 8) & 255) > (g & 255)).toBe(true)
})

test('one whole round of the simulation, in its story order, from the POST back round to the scanner', { timeoutMs: 300000 }, async ($, on) => {
  const W = 30
  const store = new Map<string, unknown>()
  on('store.get', (_: unknown, e: any) => ({ value: store.get(e.key) }))
  on('store.set', (_: unknown, e: any) => (store.set(e.key, e.value), { value: undefined }))
  on('command.register', (_: unknown, e: any) => ({ value: { command: e.name } }))
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('turn.start', (_: unknown, e: any) => ({ turnId: e.turnId }))
  let shown: number[] = []
  on('ui.blit', (_: unknown, e: any) => ((shown = decode(e.cells)), { value: {} }))
  const clock = mock.clock(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: '', turnId: 't1' } as any)
  // on by default: a new install starts with the boot
  const site = { plugin: 'neontide', component: 'AbovePrompt', requestId: 'band', surface: 'terminal', props: { hasSurvey: false, isCollapsed: false, isWorking: true, maxRows: 12, bodyColumns: W, scroll: { offset: 0, bodyRows: 11 }, view: {} } } as const
  const ui = await $.ui.mount(site)
  const order: string[] = []
  const split: string[] = []
  for (let f = 0; f < 8000; f++) {
    await clock.advance(90)
    await ui.find({ type: 'Raster' })
    const label = (/^Now: ([\w ,]+?)(?: \(|$)/m.exec((await $.command.run({ command: 'neontide', args: '' })).text ?? '')?.[1] ?? '').trim()
    if (order[order.length - 1] !== label) order.push(label)
    if (label === 'eq center' && split.length < 12) split.push(Array.from({ length: W }, (_, i) => String.fromCodePoint(shown[i * 3] ?? 32)).join(''))
    if (label === 'scanner rainbow' && order.includes('reboot')) break
  }
  await ui.unmount()
  expect(order.join(' > ')).toBe(
    [
      'post, then scanner code',
      ...['code', 'rainbow', 'fire', 'wide', 'mirror', 'dual', 'matrix'].map(v => `scanner ${v}`),
      ...['center', 'spectrum', 'beat', 'dotbars', 'braille'].map(v => `eq ${v}`),
      ...['rainbow', 'borealis', 'toxic', 'gold', 'sunset', 'lava', 'sakura', 'neon', 'australis', 'ocean', 'ice', 'ghost'].map(v => `aurora ${v}`),
      ...['speedlines', 'dense', 'twin', 'gold', 'neon', 'hyper', 'jump'].map(v => `warp ${v}`),
      'nebula', 'constellations', 'stars', 'comet', 'planet',
      ...['drizzle', 'downpour', 'gale', 'neon', 'glints', 'ember'].map(v => `rain ${v}`),
      'trippy', 'glitch', 'reboot',
      // the next round: no POST between loops, straight to the scanner
      'scanner code', 'scanner rainbow',
    ].join(' > '),
  )
  // the matrix beam splits in the middle into two that race to both edges, the fire eq rising behind them
  const kana = /[ｱ-ｽ01]/
  expect(split.some(r => kana.test(r.slice(0, W / 2 - 2)) && kana.test(r.slice(W / 2 + 2)) && /[▁▂▃]/.test(r))).toBe(true)
  // the crash made the next version
  await clock.advance(1000)
  expect((store.get('v2.sim') as any).sessions.local.loops).toBe(1)
})

test('the version: a new session takes the next session number, a reload keeps its own number and loops', { timeoutMs: 120000 }, async ($, on) => {
  const W = 40
  const store = new Map<string, unknown>([
    ['v2.tide', true],
    ['v2.tideFull', true],
    // five sessions ran the simulation before; the last one looped three times
    ['v2.sim', { count: 5, sessions: { a: { major: 4, loops: 1, at: 1 }, b: { major: 5, loops: 3, at: 2 } } }],
  ])
  on('store.get', (_: unknown, e: any) => ({ value: store.get(e.key) }))
  on('store.set', (_: unknown, e: any) => (store.set(e.key, e.value), { value: undefined }))
  on('command.register', (_: unknown, e: any) => ({ value: { command: e.name } }))
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'today-1' }))
  on('turn.start', (_: unknown, e: any) => ({ turnId: e.turnId }))
  let shown: number[] = []
  on('ui.blit', (_: unknown, e: any) => ((shown = decode(e.cells)), { value: {} }))
  const clock = mock.clock(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: '', turnId: 't1' } as any)
  const site = { plugin: 'neontide', component: 'AbovePrompt', requestId: 'band', surface: 'terminal', props: { hasSurvey: false, isCollapsed: false, isWorking: true, maxRows: 12, bodyColumns: W, scroll: { offset: 0, bodyRows: 11 }, view: {} } } as const
  const ui = await $.ui.mount(site)
  let top = ''
  // the cursor blinks for about 1 s, then the title types out
  for (let f = 0; f < 60 && !/SIMULATION v\d+\.\d+/.test(top); f++) {
    await clock.advance(90)
    await ui.find({ type: 'Raster' })
    top = Array.from({ length: W }, (_, i) => String.fromCodePoint(shown[i * 3] ?? 32)).join('')
  }
  await ui.unmount()
  // the sixth session: v6.0
  expect(top).toContain('SIMULATION v6.0')
  await clock.advance(1000)
  const book = store.get('v2.sim') as any
  expect(book.count).toBe(6)
  expect(book.sessions['today-1']).toEqual(expect.objectContaining({ major: 6, loops: 0 }))
  // the earlier sessions are kept
  expect(book.sessions.b.loops).toBe(3)
})

test('the version after a reload: the same session finds its own number and loops again', { timeoutMs: 120000 }, async ($, on) => {
  const W = 40
  const store = new Map<string, unknown>([
    ['v2.tide', true],
    ['v2.tideFull', true],
    ['v2.sim', { count: 7, sessions: { mine: { major: 3, loops: 2, at: 5 } } }],
  ])
  on('store.get', (_: unknown, e: any) => ({ value: store.get(e.key) }))
  on('store.set', (_: unknown, e: any) => (store.set(e.key, e.value), { value: undefined }))
  on('command.register', (_: unknown, e: any) => ({ value: { command: e.name } }))
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'mine' }))
  on('turn.start', (_: unknown, e: any) => ({ turnId: e.turnId }))
  let shown: number[] = []
  on('ui.blit', (_: unknown, e: any) => ((shown = decode(e.cells)), { value: {} }))
  const clock = mock.clock(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: '', turnId: 't1' } as any)
  const site = { plugin: 'neontide', component: 'AbovePrompt', requestId: 'band', surface: 'terminal', props: { hasSurvey: false, isCollapsed: false, isWorking: true, maxRows: 12, bodyColumns: W, scroll: { offset: 0, bodyRows: 11 }, view: {} } } as const
  const ui = await $.ui.mount(site)
  let top = ''
  // the cursor blinks for about 1 s, then the title types out
  for (let f = 0; f < 60 && !/SIMULATION v\d+\.\d+/.test(top); f++) {
    await clock.advance(90)
    await ui.find({ type: 'Raster' })
    top = Array.from({ length: W }, (_, i) => String.fromCodePoint(shown[i * 3] ?? 32)).join('')
  }
  await ui.unmount()
  // its own number and loops, and no new session number taken
  expect(top).toContain('SIMULATION v3.2')
  await clock.advance(1000)
  expect(((store.get('v2.sim') as any) ?? { count: 7 }).count).toBe(7)
})
