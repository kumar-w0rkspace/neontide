import type { EngineInterface, Register } from 'claude-code'

type Dollar = EngineInterface

const DEFAULT = 0x01000000
const FRAME_MS = 90
const BAND_ROWS = 3

const MATRIX_OPTIONS = {
  style: ['hard', 'classic'],
  chars: ['mixed', 'binary', 'katakana', 'hex'],
  speed: ['slow', 'normal', 'fast'],
  density: ['sparse', 'normal', 'dense'],
} as const
type MatrixKey = keyof typeof MATRIX_OPTIONS
type MatrixOpts = { [K in MatrixKey]: (typeof MATRIX_OPTIONS)[K][number] }
const MATRIX_DEFAULTS: MatrixOpts = { style: 'hard', chars: 'mixed', speed: 'normal', density: 'normal' }
const MATRIX_CHARS: Record<MatrixOpts['chars'], string> = {
  mixed: 'ｦｱｳｴｵｶｷｹｺｻｼｽｾｿﾀﾂﾃﾅﾆﾇﾈﾊﾋﾎﾏﾐﾑﾒﾓﾔﾕﾗﾘﾜ0123456789Z:."=*+-<>¦|',
  binary: '01',
  katakana: 'ｦｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ',
  hex: '0123456789ABCDEF',
}
const MATRIX_SPEED: Record<MatrixOpts['speed'], number> = { slow: 0.5, normal: 1, fast: 1.8 }
const MATRIX_DENSITY: Record<MatrixOpts['density'], number> = { sparse: 0.45, normal: 1, dense: 1 }

const BANDS = ['off', 'matrix', 'chomp', 'stars', 'scanner', 'rain', 'warp', 'trippy', 'glitch', 'aurora', 'eq', 'nebula', 'comet', 'constellations', 'planet'] as const
// reboot is tide's own last step (after glitch, see makeReboot) and post its start page (makePost); they
// are not bands you can pick.
type Band = (typeof BANDS)[number] | 'reboot' | 'post'
// Bands that draw a single line get a shorter band instead of empty rows around it.
const BAND_HEIGHT: Partial<Record<Band, number>> = { scanner: 1, eq: 1, aurora: 1, glitch: 2, reboot: 2, post: 2 }

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function toBase64(bytes: Uint8Array): string {
  let out = ''
  let i = 0
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!
    out += B64.charAt((n >> 18) & 63) + B64.charAt((n >> 12) & 63) + B64.charAt((n >> 6) & 63) + B64.charAt(n & 63)
  }
  const rest = bytes.length - i
  if (rest === 1) {
    const n = bytes[i]! << 16
    out += B64.charAt((n >> 18) & 63) + B64.charAt((n >> 12) & 63) + '=='
  } else if (rest === 2) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8)
    out += B64.charAt((n >> 18) & 63) + B64.charAt((n >> 12) & 63) + B64.charAt((n >> 6) & 63) + '='
  }
  return out
}

const cp = (s: string): number => s.codePointAt(0) ?? 0x20
const pick = <T,>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)]!
const rnd = (n: number): number => Math.floor(Math.random() * n)

// age: frames stepped so far; pos: the frame number the effect draws next (family effects only; tide
// uses them to time bands and to carry an aurora on where it was)
type Effect = { w: number; h: number; codes: Uint32Array; fgs: Uint32Array; step: () => void; age?: number; pos?: number; last?: number; end?: number }

function blank(w: number, h: number): Pick<Effect, 'w' | 'h' | 'codes' | 'fgs'> {
  return { w, h, codes: new Uint32Array(w * h).fill(0x20), fgs: new Uint32Array(w * h).fill(DEFAULT) }
}

function put(e: Pick<Effect, 'w' | 'h' | 'codes' | 'fgs'>, x: number, y: number, glyph: number, fg: number) {
  if (x < 0 || y < 0 || x >= e.w || y >= e.h) return
  e.codes[y * e.w + x] = glyph
  e.fgs[y * e.w + x] = fg
}

function encode(e: Effect): string {
  const n = e.w * e.h
  const words = new Uint32Array(n * 3)
  for (let i = 0; i < n; i++) {
    words[i * 3] = e.codes[i]!
    words[i * 3 + 1] = e.fgs[i]!
    words[i * 3 + 2] = DEFAULT
  }
  return toBase64(new Uint8Array(words.buffer))
}

function green(level: number): number {
  const g = Math.round(60 + 195 * level)
  const r = Math.round(level > 0.85 ? 120 * level : 0)
  return (r << 16) | (g << 8) | Math.round(level > 0.85 ? 90 * level : 20 * level)
}

// opts: the matrix settings (MATRIX_DEFAULTS unless given; the reboot uses its own); burst: bright drops
// sent by matrixBurst (unused in the simulation).
function makeMatrix(w: number, h: number, opts: MatrixOpts = matrix, burst = true): Effect {
  const e = blank(w, h)
  const codes = Array.from(MATRIX_CHARS[opts.chars]).map(cp)
  const glyph = () => codes[rnd(codes.length)]!
  const speed = MATRIX_SPEED[opts.speed]
  const isDense = opts.density === 'dense'
  const isActive = () => Math.random() < MATRIX_DENSITY[opts.density]
  type Drop = { y: number; speed: number; length: number; isBright: boolean; isOn: boolean }
  const newDrop = (isBright = false): Drop => ({
    y: -Math.random() * h * (isDense ? 1 : 3),
    speed: (0.25 + Math.random() * 0.6) * speed,
    length: 2 + rnd(h + (isDense ? 5 : 2)),
    isBright,
    isOn: isBright || isActive(),
  })
  const drops = Array.from({ length: w }, () => newDrop())
  const glyphs = Array.from({ length: w * h }, glyph)
  return {
    ...e,
    step() {
      for (let x = 0; x < w; x++) {
        const d = drops[x]!
        d.y += d.speed
        if (d.y - d.length > h) drops[x] = newDrop()
      }
      while (burst && matrixBurst > 0) {
        matrixBurst--
        drops[rnd(w)] = { ...newDrop(true), y: 0, speed: (0.7 + Math.random() * 0.5) * speed }
      }
      for (let i = 0; i < Math.max(1, Math.floor(glyphs.length / 25)); i++) glyphs[rnd(glyphs.length)] = glyph()
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x
          const d = drops[x]!
          const behind = Math.floor(d.y) - y
          if (!d.isOn || behind < 0 || behind > d.length) {
            e.codes[i] = 0x20
            e.fgs[i] = DEFAULT
          } else if (opts.style === 'hard') {
            e.codes[i] = glyphs[i]!
            e.fgs[i] = 0x00ff00
          } else {
            e.codes[i] = glyphs[i]!
            e.fgs[i] = behind === 0 ? (d.isBright ? 0xffffff : 0xd8ffd8) : green(Math.max(0.05, 1 - behind / (d.length + 1)) * (d.isBright ? 1 : 0.8))
          }
        }
      }
    },
  }
}

function makeStars(w: number, h: number): Effect {
  const e = blank(w, h)
  const layers = [
    { glyph: cp('.'), fg: 0x606878, speed: 0.15 },
    { glyph: cp('+'), fg: 0xa0a8c0, speed: 0.4 },
    { glyph: cp('*'), fg: 0xffffff, speed: 0.9 },
  ]
  const stars = Array.from({ length: Math.max(4, Math.floor((w * h) / 9)) }, () => ({
    x: Math.random() * w,
    y: rnd(h),
    layer: layers[rnd(layers.length)]!,
  }))
  return {
    ...e,
    step() {
      e.codes.fill(0x20)
      e.fgs.fill(DEFAULT)
      for (const s of stars) {
        s.x -= s.layer.speed
        if (s.x < 0) {
          s.x = w - 1
          s.y = rnd(h)
        }
        put(e, Math.floor(s.x), s.y, s.layer.glyph, s.layer.fg)
      }
    },
  }
}

// The space chapters (nebula, comet, constellations, planet). All 3 rows (BAND_ROWS).

// A faint, slow background starfield the space bands share: a few dots that drift left and twinkle.
function spaceDust(w: number, h: number, density = 0.06, drift = 0) {
  const dots = Array.from({ length: Math.max(3, Math.round(w * h * density)) }, () => ({ x: Math.random() * w, y: rnd(h), tw: Math.random() * 6.28, sp: 0.02 + Math.random() * 0.05 }))
  return (e: Pick<Effect, 'w' | 'h' | 'codes' | 'fgs'>, F: number) => {
    for (const d of dots) {
      d.x -= d.sp + drift
      if (d.x < 0) d.x += w
      const b = 0.5 + 0.5 * Math.sin(F * 0.15 + d.tw)
      put(e, Math.floor(d.x), d.y, cp(b > 0.8 ? '·' : '.'), mixRgb(0x303848, 0x9098b0, b))
    }
  }
}

// Nebula: soft clouds of ░▒▓ in magenta, blue and teal, from a slowly drifting field of sines, with
// faint stars through them.
function makeNebula(w: number, h: number): Effect {
  const e = blank(w, h)
  const dust = spaceDust(w, h)
  const shades = Array.from('░▒▓').map(cp)
  // a wide palette, blended smoothly: pink, magenta, purple, blue, teal, green-teal, gold, orange
  const palette = [0xe86aa0, 0xc040c0, 0x7a4ad0, 0x3a6ad8, 0x30b0b0, 0x3ac08a, 0xd8b04a, 0xe8784a]
  let F = 0
  return {
    ...e,
    step() {
      F++
      e.codes.fill(0x20)
      e.fgs.fill(DEFAULT)
      dust(e, F)
      const t = F * 0.03
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const u = x / 9 + t
          const n = (Math.sin(u) + Math.sin(u * 0.53 + y * 0.9 - t * 0.7) + Math.sin(x / 23 - y * 0.6 + t * 0.4)) / 3
          if (n < 0.3) continue
          const k = n > 0.82 ? 2 : n > 0.55 ? 1 : 0
          // where along the palette this cell is: two slow waves, so neighbouring clouds differ in colour
          const m = ((Math.sin(x / 17 + t * 0.15 + y * 0.4) + Math.sin(x / 41 - t * 0.1)) / 2 + 1) / 2
          const at = m * (palette.length - 1)
          const c = mixRgb(palette[Math.floor(at)]!, palette[Math.min(palette.length - 1, Math.floor(at) + 1)]!, at % 1)
          // dense cores glow brighter, almost white at the heart
          put(e, x, y, shades[k]!, k === 2 ? mixRgb(c, 0xfff0ff, 0.35) : mixRgb(0x000000, c, 0.55 + 0.25 * k))
        }
      }
    },
  }
}

// Comet (style A): a bright head ✸ crossing left to right on the bottom row, its tail slanting back up
// and to the left in a thin, flickering streak (╲ ⋱ · ˙), then a pause and the next one.
function makeComet(w: number, h: number): Effect {
  const e = blank(w, h)
  const dust = spaceDust(w, h)
  // the tail relative to the head: [dx, dy (rows up), glyphs to flicker between, brightness]
  const TAIL: [number, number, string, number][] = [
    [-2, 0, '╲⋱', 0.95], [-4, 0, '╲', 0.85], [-6, 0, '⋱╲', 0.75],
    [-8, 1, '╲', 0.65], [-10, 1, '⋱', 0.55], [-12, 1, '·˙', 0.45], [-14, 1, '˙', 0.35],
    [-17, 2, '.·', 0.28], [-19, 2, '˙', 0.2], [-22, 2, '.', 0.14],
  ]
  // in tide the ship flies right, so the comet comes from ahead (starting where the star flared, see the
  // flare fade) and streaks past under it, right to left, its tail trailing up and to the right
  const dir = tide ? -1 : 1
  const speed = tide ? 1.6 : 1.2
  const mirror: Record<string, string> = { '╲': '╱', '⋱': '⋰' }
  const start = () => (dir > 0 ? -2 : w + 2)
  let F = 0
  let x = dir > 0 ? -2 : Math.floor(w * 0.85) + speed
  let wait = 0
  const fx: Effect = {
    ...e,
    pos: -999,
    step() {
      F++
      e.codes.fill(0x20)
      e.fgs.fill(DEFAULT)
      dust(e, F)
      if (wait > 0) {
        wait--
        fx.pos = -999
        return
      }
      x += dir * speed
      const hx = Math.round(x)
      const hy = h - 1
      fx.pos = hx
      for (const [dx, dy, g, b] of TAIL) {
        if (Math.random() < 0.15) continue
        const glyph = g[rnd(g.length)]!
        put(e, hx + dir * dx, hy - Math.min(dy, h - 1), cp(dir > 0 ? glyph : (mirror[glyph] ?? glyph)), mixRgb(0x102040, 0xa8e8ff, b))
      }
      put(e, hx, hy, cp('✸'), 0xffffff)
      if (dir > 0 ? hx + TAIL[TAIL.length - 1]![0] > w : hx - TAIL[TAIL.length - 1]![0] < 0) {
        x = start()
        // in tide there is only the one comet; on its own the band sends the next after a pause
        wait = tide ? Infinity : 20 + rnd(40)
      }
    },
  }
  return fx
}

// Constellations: groups of 3–5 stars ✦ appear one by one, lines draw between them a cell at a time
// (─ ╱ ╲), hold and twinkle, then fade; each group on its own timer, so the sky keeps changing.
function makeConstellations(w: number, h: number): Effect {
  const e = blank(w, h)
  // the sky drifts left past the ship (DRIFT columns a frame), so new groups come in from the right
  const DRIFT = 0.3
  const dust = spaceDust(w, h, 0.04, DRIFT * 0.5)
  const slot = 32
  const PERIOD = 90 // about 8 s a group: stars, lines, hold, fade
  const world = (Math.ceil(w / slot) + 1) * slot
  type Group = { stars: [number, number][]; path: [number, number, string][]; offset: number; seed: number; x0: number }
  const groups: Group[] = []
  const build = (g: Group, s: number) => {
    const r = seeded(s)
    const n = 3 + Math.floor(r() * 3)
    const xs: number[] = []
    for (let tries = 0; xs.length < n && tries < 40; tries++) {
      const x = g.x0 + 3 + Math.floor(r() * (slot - 8))
      if (xs.every(o => Math.abs(o - x) >= 6)) xs.push(x)
    }
    xs.sort((a, b) => a - b)
    g.stars = xs.map(x => [x, Math.floor(r() * h)] as [number, number])
    g.path = []
    for (let i = 1; i < g.stars.length; i++) {
      const [ax, ay] = g.stars[i - 1]!
      const [bx, by] = g.stars[i]!
      let y = ay
      for (let x = ax + 1; x < bx; x++) {
        const want = Math.round(ay + ((by - ay) * (x - ax)) / Math.max(1, bx - ax))
        const glyph = want > y ? '╲' : want < y ? '╱' : '─'
        g.path.push([x, glyph === '╲' ? y : glyph === '╱' ? want : y, glyph])
        y = want
      }
    }
  }
  for (let i = 0; i * slot < world; i++) {
    const g: Group = { stars: [], path: [], offset: Math.floor((i * PERIOD) / 3) % PERIOD, seed: i * 977 + 13, x0: i * slot }
    groups.push(g)
    build(g, g.seed)
  }
  // a shooting star now and then, streaking left; a blinking satellite crossing slowly to the right
  let shoot: { x: number; y: number; life: number } | null = null
  const sat = { x: -2, y: 0, next: 30 }
  let F = 0
  return {
    ...e,
    step() {
      F++
      e.codes.fill(0x20)
      e.fgs.fill(DEFAULT)
      dust(e, F)
      const scroll = F * DRIFT
      const at = (x: number): number => (((Math.round(x - scroll) % world) + world) % world)
      for (const g of groups) {
        const t = (F + g.offset) % PERIOD
        if (t === 0) build(g, (g.seed += 7919))
        const fade = t < 64 ? 1 : t < 78 ? 1 - (t - 64) / 14 : 0
        if (fade <= 0) continue
        // lines: drawn a cell at a time from t 12 to 36
        const drawn = t < 12 ? 0 : Math.min(g.path.length, Math.floor(((t - 12) / 24) * g.path.length))
        for (let k = 0; k < drawn; k++) {
          const [x, y, glyph] = g.path[k]!
          const sx = at(x)
          if (sx < w) put(e, sx, y, cp(glyph), mixRgb(0x101828, 0x5878a8, fade))
        }
        // stars: one by one from t 0 to 12, twinkling
        g.stars.forEach(([x, y], k) => {
          if (t < (k * 12) / g.stars.length) return
          const sx = at(x)
          const tw = 0.75 + 0.25 * Math.sin(F * 0.3 + k * 2)
          if (sx < w) put(e, sx, y, cp('✦'), mixRgb(0x101828, 0xfff4d0, fade * tw))
        })
      }
      if (!shoot && Math.random() < 1 / 35) shoot = { x: w * 0.4 + Math.random() * w * 0.6, y: rnd(h), life: 0 }
      if (shoot) {
        shoot.x -= 2.5
        shoot.life++
        const b = Math.max(0, 1 - shoot.life / 14)
        const hx = Math.round(shoot.x)
        put(e, hx, shoot.y, cp('✦'), mixRgb(0x203040, 0xffffff, b))
        for (let j = 1; j <= 4; j++) put(e, hx + j, shoot.y, cp(j < 4 ? '─' : '·'), mixRgb(0x101828, 0xa8c8ff, b * (1 - j / 5)))
        if (shoot.life > 14 || hx < -5) shoot = null
      }
      if (F >= sat.next) {
        if (sat.x === -2) sat.y = rnd(h)
        sat.x += 0.5
        const sx = Math.round(sat.x)
        put(e, sx - 1, sat.y, cp('-'), 0x506070)
        put(e, sx, sat.y, cp('◦'), F % 10 < 5 ? 0xff4040 : 0xffffff)
        put(e, sx + 1, sat.y, cp('-'), 0x506070)
        if (sat.x > w + 2) {
          sat.x = -2
          sat.next = F + 120 + rnd(100)
        }
      }
    },
  }
}

// Planet: rises from below over about 4 s and stays, its top showing as a lit dome: ocean blue and land
// green bands turning slowly, lit from the upper left, with a soft top edge (▁…█) and a thin
// atmosphere glow, against faint stars.
// Earth's colours at a longitude (already turning) and height on the dome (ny: -1 at the top): an ice cap
// at the top, deep and shallow ocean, land in forest, grass, desert and mountain, and white clouds that
// drift a little faster than the ground.
function earthColour(lon: number, ny: number, F: number): number {
  if (ny < -0.6 + 0.08 * Math.sin(lon * 5)) return 0xe8f4ff // a thin polar ice crest
  const cloud = Math.sin(lon * 1.7 + F * 0.012 + ny * 4) + Math.sin(lon * 3.1 - F * 0.008 - ny * 2) * 0.6
  if (cloud > 1.25) return 0xf4f8ff
  const ground = Math.sin(lon * 2.1 + ny * 3) + Math.sin(lon * 0.7 - ny * 5)
  if (ground < 0.45) return ground > 0.25 ? 0x2a8cc8 : 0x14508c // shallow near the coast, deep further out
  const kind = Math.sin(lon * 4.3 + ny * 7) + Math.sin(lon * 1.3 - ny * 2)
  if (ground > 1.5) return 0x8a6a4a // mountains
  return kind > 0.9 ? 0xc8a868 : kind > 0 ? 0x3c8c3c : kind > -0.8 ? 0x6aa84a : 0x2a6a2a // desert, forest, grass, deep forest
}
function makePlanet(w: number, h: number): Effect {
  const e = blank(w, h)
  const dust = spaceDust(w, h, 0.05)
  // in tide it rises ahead of the ship (which is a third of the way in), so it sits right of centre.
  // zoom (0 → 1, set by the dive into the clouds): the planet grows as the ship nears it, until its
  // surface fills the band under the ship, with a nearly flat horizon and bigger land and clouds
  const R0 = Math.max(8, w * (tide ? 0.3 : 0.38)) // horizontal radius in columns
  const cx0 = tide ? w * 0.66 : (w - 1) / 2
  const RISE = Math.round(4000 / FRAME_MS)
  const edge = Array.from('▁▂▃▄▅▆▇█').map(cp)
  const shade = Array.from('░▒▓█').map(cp)
  const L = [-0.55, -0.55, 0.63] // light from the upper left, towards the viewer
  let F = 0
  let spin = 0
  const fx: Effect & { zoom?: number } = {
    ...e,
    zoom: 0,
    step() {
      F++
      e.codes.fill(0x20)
      e.fgs.fill(DEFAULT)
      dust(e, F)
      const z = fx.zoom ?? 0
      const ez = z * z * (3 - 2 * z)
      const R = R0 + (w * 8 - R0) * ez
      const Ry = R / 2 // a cell is about twice as tall as it is wide
      const cx = cx0 + ((w - 1) / 2 - cx0) * ez
      const endCy = Ry - 0.6 + 1.4 * ez // top of the dome just over the top row; lower as it fills the band
      const startCy = h + Ry + 0.5
      spin += 0.01 * (1 + 3 * ez)
      fx.pos = F
      const q = Math.min(1, F / RISE)
      const cy = startCy + (endCy - startCy) * (1 - (1 - q) ** 3)
      for (let x = 0; x < w; x++) {
        const nx = (x - cx) / R
        if (Math.abs(nx) >= 1) continue
        const top = cy - Ry * Math.sqrt(1 - nx * nx) // the dome's top edge in rows (fractional)
        for (let y = 0; y < h; y++) {
          const cover = Math.max(0, Math.min(1, y + 1 - top)) // how much of this cell is planet
          if (cover <= 0) {
            // atmosphere: a faint glow just above the edge
            if (top - (y + 1) < 0.6) put(e, x, y, cp('·'), 0x3a6a9a)
            continue
          }
          const ny = (y + 0.5 - cy) / Ry
          const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny))
          const lit = Math.max(0.12, nx * L[0]! + ny * L[1]! + nz * L[2]!)
          const lon = Math.asin(Math.max(-1, Math.min(1, nx))) * 3 * (R / (R0 * (1 + 2 * ez))) + spin
          const glyph = cover < 1 ? edge[Math.max(0, Math.min(7, Math.round(cover * 8) - 1))]! : shade[Math.min(3, Math.floor(lit * 4))]!
          // the visible face is only the top of the globe, so spread its height over the map (0 at the crest)
          const face = (y + 0.5 - top) / Math.max(1, h) - 0.65
          put(e, x, y, glyph, mixRgb(0x000000, earthColour(lon, face, F), Math.min(1, 0.3 + 0.75 * lit)))
        }
      }
    },
  }
  return fx
}

function makeChomp(w: number, h: number): Effect {
  const e = blank(w, h)
  const mid = Math.floor(h / 2)
  let pos = 0
  let tick = 0
  return {
    ...e,
    step() {
      tick++
      pos += 0.5
      if (pos > w + 2) pos = 0
      e.codes.fill(0x20)
      e.fgs.fill(DEFAULT)
      if (h >= 3) {
        for (let x = 0; x < w; x++) {
          put(e, x, mid - 1, cp('-'), 0x2040c0)
          put(e, x, mid + 1, cp('-'), 0x2040c0)
        }
      }
      for (let x = Math.floor(pos) + 2; x < w; x += 2) put(e, x, mid, cp('.'), 0xffd0a0)
      put(e, Math.floor(pos), mid, tick % 4 < 2 ? cp('C') : cp('O'), 0xffe000)
    },
  }
}

// Stable per-column randomness: the same column always gets the same speed, period and phase.
// Seeded generator (mulberry32): the same seed always gives the same sequence in [0, 1).
function seeded(seed: number): () => number {
  let s = (seed + 1) >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// xterm-256 colour code (16-255) to 0xRRGGBB.
function x256(code: number): number {
  if (code >= 232) {
    const g = 8 + 10 * (code - 232)
    return (g << 16) | (g << 8) | g
  }
  const c = Math.max(0, code - 16)
  const lv = [0, 95, 135, 175, 215, 255]
  return (lv[Math.floor(c / 36) % 6]! << 16) | (lv[Math.floor(c / 6) % 6]! << 8) | lv[c % 6]!
}

// HSV to an xterm-256 colour code, as in the status-line spec.
function hsv(h: number, s = 1, v = 1): number {
  h = ((h % 1) + 1) % 1
  const i = Math.floor(h * 6)
  const f = h * 6 - i
  const p = v * (1 - s)
  const q = v * (1 - f * s)
  const t = v * (1 - (1 - f) * s)
  const [r, g, b] = ([[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]] as const)[i % 6]!
  return 16 + 36 * Math.floor(r * 5 + 0.5) + 6 * Math.floor(g * 5 + 0.5) + Math.floor(b * 5 + 0.5)
}

// The status-line spec steps every 0.5 s; bands step every FRAME_MS, so smooth effects use this as F.
const specFrame = (frame: number) => (frame * FRAME_MS) / 500

function colParams(i: number, loSpeed = 1, hiSpeed = 3, loPeriod = 8, hiPeriod = 16): [number, number, number] {
  const next = seeded(i * 7919)
  const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1))
  return [int(loSpeed, hiSpeed), int(loPeriod, hiPeriod), int(0, 1000)]
}

// Families of one-row effects (rain, scanner, warp), 8 variants each. Each variant is built for a
// width W and returns F => W cells; a cell is null (blank) or [glyph, xterm-256 colour code].
type Cell = [string, number] | null
type RowFx = (F: number) => Cell[]
type Variant = (W: number, y: number, h: number) => RowFx

const rainFx =
  (shades: number[] | ((i: number) => number[]), glyphs: string[], ls: number, hs: number, lp: number, hp: number, rev = false): Variant =>
  (W, y, h) => {
    const params = Array.from({ length: W }, (_, i) => colParams(i, ls, hs, lp + h - 1, hp + h - 1))
    return F =>
      Array.from({ length: W }, (_, i): Cell => {
        const [s, p, ph] = params[i]!
        const pos = rev ? (((-F * s + ph) % p) + p) % p : (F * s + ph) % p
        const sh = typeof shades === 'function' ? shades(i) : shades
        const k = pos - y
        return k >= 0 && k < sh.length ? [glyphs[k] ?? '.', sh[k]!] : null
      })
  }

const glintBase = rainFx([159, 117, 75, 33, 27, 24], ['|', '¦', '╎', ':', '.', '.'], 1, 2, 10, 20)

const RAIN: Record<string, Variant> = {
  downpour: rainFx([231, 159, 117, 75, 33, 27], ['|', '¦', '╎', ':', '.', '.'], 2, 3, 5, 9),
  drizzle: rainFx([117, 75, 33], ['.', '·', '.'], 1, 1, 18, 34),
  neon: rainFx(i => (i % 2 ? [201, 165, 129, 93, 57, 54] : [51, 45, 39, 33, 27, 24]), ['┃', '│', '╎', '╎', ':', '.'], 1, 3, 6, 12),
  ember: rainFx([226, 220, 214, 208, 202, 196, 124], ['✦', '*', '+', '·', '·', '.', '.'], 1, 2, 8, 16, true),
  acid: rainFx([190, 154, 118, 82, 46, 34], ['!', '|', '¦', '╎', ':', '.'], 1, 3, 7, 14),
  gale: rainFx([255, 252, 117, 75, 33, 27], ['╲', '\\', '╲', "'", '·', '.'], 2, 3, 4, 8),
  splash: (W, y) => F => {
    const cells: Cell[] = Array(W).fill(null)
    for (let n = 0; n < 4; n++) {
      const per = 14
      const off = n * 5 + y * 4
      const ev = Math.floor((F + off) / per)
      const a = (F + off) % per
      const c0 = Math.floor(seeded(ev * 31 + n * 7 + y * 1013)() * W)
      const ch = a < 2 ? '●' : a < 5 ? '○' : a < 8 ? '∘' : '·'
      const col = a < 2 ? 231 : a < 5 ? 117 : a < 8 ? 75 : 33
      if (a < 11) {
        for (const d of [-1, 1]) {
          const i = c0 + d * Math.floor(a / 1.5)
          if (i >= 0 && i < W) cells[i] = [ch, col]
        }
      }
    }
    return cells
  },
  glints: (W, y, h) => {
    const baseFx = glintBase(W, y, h)
    const params = Array.from({ length: W }, (_, i) => colParams(i, 1, 2, 10 + h - 1, 20 + h - 1))
    return F => {
      const base = baseFx(F)
      for (let i = 0; i < W; i++) {
        const [s, p, ph] = params[i]!
        if ((F * s + ph) % p === y) {
          for (const j of [i - 1, i + 1]) if (j >= 0 && j < W && !base[j]) base[j] = ['·', 244]
          base[i] = ['●', 231]
        }
      }
      return base
    }
  },
}

const bounce = (F: number, n: number): [number, number] => {
  n = Math.max(2, n)
  const span = n * 2 - 2
  const t = F % span
  return t < n ? [t, 1] : [span - t, -1]
}
const scanGlyph = (k: number) => (k === 0 ? '█' : k < 3 ? '▓' : k < 5 ? '▒' : '░')
// The trail behind the head: where the beam was in the frames before. At a wall it folds back (reflects)
// instead of being cut off, so the beam turns smoothly: the trail compresses into the wall and stretches
// out behind the head again. F (the beam's own frame, when given) leaves out frames before it started.
function scanTrail(W: number, cells: Cell[], p: number, d: number, cols: number[], glyph: (k: number) => string = scanGlyph, F = Infinity): Cell[] {
  cols.forEach((c, k) => {
    if (k > F) return
    let i = p - d * k
    if (i < 0) i = -i
    else if (i > W - 1) i = 2 * (W - 1) - i
    if (i >= 0 && i < W && !cells[i]) cells[i] = [glyph(k), c]
  })
  return cells
}
const RED = [196, 160, 124, 88, 52]
const MATRIX_KANA = Array.from('ｱｲｳｴｵｶｷｸｹｺｻｼｽ01')

const SCANNER: Record<string, Variant> = {
  dual: W => F => {
    const [p, d] = bounce(F, W)
    const c: Cell[] = Array(W).fill(null)
    scanTrail(W, c, p, d, RED)
    return scanTrail(W, c, W - 1 - p, -d, [51, 45, 39, 33, 27])
  },
  rainbow: W => F => {
    const [p, d] = bounce(F, W)
    return scanTrail(W, Array(W).fill(null), p, d, Array.from({ length: 8 }, (_, k) => hsv(F / 20 - k * 0.04, 1, 1 - k * 0.08)), scanGlyph, F)
  },
  ice: W => F => {
    const [p, d] = bounce(F, W)
    return scanTrail(W, Array(W).fill(null), p, d, [231, 159, 117, 75, 33, 27, 24], scanGlyph, F)
  },
  mirror: W => F => {
    const h = Math.max(2, Math.floor(W / 2))
    const mid = Math.floor(W / 2)
    const [q, d] = bounce(F, h)
    const c: Cell[] = Array(W).fill(null)
    scanTrail(W, c, mid + q, d, RED)
    return scanTrail(W, c, mid - 1 - q, -d, RED)
  },
  ease: W => F => {
    const a = (Math.PI * F) / (W * 0.9)
    const p = Math.round(((W - 1) * (1 - Math.cos(a))) / 2)
    const d = Math.sin(a) >= 0 ? 1 : -1
    return scanTrail(W, Array(W).fill(null), Math.max(0, Math.min(W - 1, p)), d, [214, 208, 172, 130, 94, 58])
  },
  matrix: W => F => {
    const [p, d] = bounce(F, W)
    return scanTrail(W, Array(W).fill(null), p, d, [231, 46, 40, 34, 28, 22], j => MATRIX_KANA[Math.floor(seeded(F * 7 + j)() * MATRIX_KANA.length)]!)
  },
  fire: W => F => {
    const [p, d] = bounce(F, W)
    return scanTrail(W, Array(W).fill(null), p, d, [226, 220, 214, 208, 202, 196, 124], scanGlyph, F)
  },
  wide: W => F => {
    const [p, d] = bounce(F, W)
    const c = scanTrail(W, Array(W).fill(null), p, d, RED, scanGlyph, F)
    const a = p + d
    const b = p + 2 * d
    if (a >= 0 && a < W && !c[a]) c[a] = ['▒', 160]
    if (b >= 0 && b < W && !c[b]) c[b] = ['░', 88]
    return c
  },
  // the matrix theme, for the scanner that starts tide's round after the reboot: a hard green head
  // (#00FF00) and a trail fading from green to white
  code: W => F => {
    const [p, d] = bounce(F, W)
    return scanTrail(W, Array(W).fill(null), p, d, [46, 83, 120, 157, 194, 231], scanGlyph, F)
  },
}

type WarpOpts = {
  n?: number
  mode?: 'out' | 'in' | 'right' | 'left'
  origins?: number[]
  col?: (t: number, sp: number) => number
  glyph?: (t: number, sp: number) => string
  len?: (t: number, sp: number) => number
  tc?: (j: number, L: number, t: number, sp: number) => number
  sync?: boolean
  // speed: a multiplier on WARP_CELLS (columns a frame); perCol: particles per column, if more than n
  speed?: number
  // even: every particle moves this many columns a frame (left/right modes), for a steady stream
  even?: number
  perCol?: number
  // core: the colour (xterm-256) of the glowing core at frame F
  core?: (F: number) => number
}
// A radial star moves WARP_CELLS × its own speed (1 to 3) × the variant's speed columns a frame, at any
// band width. (It used to be scaled by the width, so a wide terminal made warp crawl.) A star faster
// than one column a frame gets a trail at least as long as its jump, so it doesn't break into dots.
const WARP_CELLS = 0.3
function warpFx(o: WarpOpts): Variant {
  const n0 = o.n || 14
  const col = o.col || (t => [240, 245, 250, 255][Math.min(3, Math.floor(t * 4))]!)
  const glyph = o.glyph || (t => (t < 0.25 ? '·' : t < 0.55 ? '-' : '━'))
  const len = o.len || (t => (t > 0.35 ? 1 : 0))
  const tc = o.tc || ((j, L) => 232 + Math.floor(18 * (1 - j / (L + 1))))
  const speed = o.speed ?? 1
  const core = o.core || (F => [250, 253, 255, 231][Math.floor(2 + 1.99 * Math.sin(F * 0.35))]!)
  return (W, y, h) => {
    // in tide the ship flies right: speedlines stream past it to the left. Every warp has one core, in the
    // centre; the radial stars come out of it
    const mode = tide && o.mode === 'right' ? 'left' : o.mode || 'out'
    const origins = [0.5]
    const coreRow = Math.floor((h || 1) / 2)
    return (F: number) => {
    const cells: Cell[] = Array(W).fill(null)
    const n = o.perCol ? Math.max(n0, Math.round(W * o.perCol)) : n0
    let jump = 0
    for (let k = 0; k < n; k++) {
      const r = seeded(k * 97 + 5 + y * 1009)
      const sp = o.even ? o.even / 0.6 : 1 + r() * 2
      const off = r()
      let t: number
      let i: number
      let m: number
      if (mode === 'right' || mode === 'left') {
        // a stream across the whole width, past the core
        const u = ((F * sp * 0.6 + off * W) % W) / W
        t = u
        m = mode === 'right' ? 1 : -1
        i = m > 0 ? Math.floor(u * (W - 1)) : W - 1 - Math.floor(u * (W - 1))
      } else {
        const mid = Math.floor(W * origins[k % origins.length]!)
        const half = Math.max(2, Math.floor(Math.min(mid, W - mid)))
        const side = k % 2 ? 1 : -1
        const cpf = WARP_CELLS * sp * speed
        jump = o.sync ? 0 : Math.floor(cpf)
        const u = o.sync ? ((F % 18) / 18) * (0.45 + r() * 0.55) : ((F * cpf + off * half) % half) / half
        t = mode === 'in' ? 1 - u : u
        m = mode === 'in' ? -side : side
        i = mid + side * Math.floor(t * (half - 1))
      }
      let L = Math.max(len(t, sp), t > 0.3 ? jump : 0)
      let g = glyph(t, sp)
      let c = col(t, sp)
      // perspective in the radial warps: a faint dot just out of the core, a short dash, then the full streak
      if (mode !== 'right' && mode !== 'left' && !o.sync) {
        if (t < 0.08) [g, c, L] = ['·', 244, 0]
        else if (t < 0.2) [g, L] = ['-', Math.floor(L / 2)]
      }
      for (let j = 1; j <= L; j++) {
        const x = i - m * j
        if (x >= 0 && x < W && !cells[x]) cells[x] = ['─', tc(j, L, t, sp)]
      }
      if (i >= 0 && i < W) cells[i] = [g, c]
    }
    // the core: a pulsing ✶ where the stars come from, a faint glow either side and above and below it.
    // Only the radial warps have one; the streams (speedlines, hyper) just rush past
    if (mode !== 'right' && mode !== 'left') for (const [n, at] of origins.entries()) {
      const x = Math.floor(W * at)
      if (x < 0 || x >= W) continue
      const pulse = 0.5 + 0.5 * Math.sin(F * 0.35 + n * 2)
      if (y === coreRow) {
        cells[x] = ['✶', core(F + n * 5)]
        for (const dx of [-1, 1]) if (x + dx >= 0 && x + dx < W) cells[x + dx] = [pulse > 0.5 ? '∙' : '·', pulse > 0.5 ? 250 : 244]
      } else if (Math.abs(y - coreRow) === 1 && pulse > 0.6) cells[x] = ['·', 240]
    }
    return cells
    }
  }
}

// jump: the hyperjump, tide's last warp (after hyper). Stars scattered round the core become short lines
// that stretch outwards from it, thin and grey at first, then long, thick and white, until they fill the
// band; then one white flash, and the drop-out (warp → nebula) brings the ship out into the nebula. Its
// own frame F runs 0 → JUMP_FRAMES.
const JUMP_FRAMES = Math.round(3000 / FRAME_MS)
const JUMP_BLOOM = 3
const JUMP_BLOOM_AT = JUMP_FRAMES - JUMP_BLOOM - 1
const jumpFx: Variant = (W, y, h) => {
  const mid = Math.floor(W / 2)
  const half = Math.max(2, Math.min(mid, W - 1 - mid))
  const coreRow = Math.floor((h || 1) / 2)
  const r = seeded(y * 7919 + 17)
  const streaks = Array.from({ length: Math.max(6, Math.round(W / 5)) }, () => ({ side: r() < 0.5 ? -1 : 1, at: 0.06 + r() * 0.9, len: 0.5 + r() * 0.5, delay: r() * 0.25 }))
  return F => {
    const cells: Cell[] = Array(W).fill(null)
    // the white-out: from JUMP_BLOOM_AT the white blooms out from the core to the edges over JUMP_BLOOM
    // frames, softening at its front (█ ▓ ▒ ░), then the whole band is solid white (held while the
    // drop-out fades it into the nebula)
    if (F >= JUMP_BLOOM_AT + JUMP_BLOOM) return cells.map((): Cell => ['█', 231])
    const rad = F >= JUMP_BLOOM_AT ? ((F - JUMP_BLOOM_AT + 1) / JUMP_BLOOM) * (half + 3) : -1
    const q = Math.min(1, F / (JUMP_FRAMES * 0.75))
    for (const st of streaks) {
      const p = Math.max(0, Math.min(1, (q - st.delay) / (1 - st.delay)))
      const ease = p * p
      // the inner end draws in towards the core, the outer end races out to the edge
      const inner = st.at * 0.6 * (1 - ease * 0.8)
      const outer = Math.min(1, st.at * 0.6 + 0.02 + ease * st.len * 1.3)
      const a = Math.floor(inner * half)
      const b = Math.floor(outer * half)
      for (let d = a; d <= b; d++) {
        const x = mid + st.side * d
        if (x < 0 || x >= W) continue
        const frac = (d - a) / Math.max(1, b - a)
        const level = Math.min(1, 0.25 + 0.75 * ease * (0.4 + 0.6 * frac))
        cells[x] = [b === a ? '·' : ease > 0.3 && frac > 0.35 ? '━' : '─', 236 + Math.round(level * 19)]
      }
    }
    if (y === coreRow) cells[mid] = ['✶', 231]
    else if (Math.abs(y - coreRow) === 1 && F % 4 < 2) cells[mid] = ['·', 250]
    if (rad > 0) {
      for (let x = 0; x < W; x++) {
        const d = rad - Math.abs(x - mid)
        if (d > 2) cells[x] = ['█', 231]
        else if (d > 1) cells[x] = ['▓', 231]
        else if (d > 0) cells[x] = ['▒', 255]
        else if (d > -1) cells[x] = ['░', 252]
      }
    }
    return cells
  }
}
const WARP: Record<string, Variant> = {
  inward: warpFx({ mode: 'in' }),
  speedlines: warpFx({ mode: 'right', n: 16, len: (_t, s) => Math.round(s * 2.5), glyph: () => '━', col: () => 255 }),
  // speeds rise in tide's order: dense 1 → twin 1.3 → gold 1.6 → neon 2 → hyper 3
  // neon: rainbow stars growing out of the core like the others (· → - → ━), colour by speed and distance
  neon: warpFx({ n: 24, speed: 2, col: (t, s) => hsv(s / 4 + t * 0.5), len: t => (t > 0.35 ? 2 : 0), tc: j => hsv(0.9 - j * 0.1, 1, 0.5), core: F => hsv(F / 30) }),
  dense: warpFx({ n: 30 }),
  // twin: two streams of stars out of the one core, white and ice blue
  twin: warpFx({ n: 20, speed: 1.3, col: (t, s) => (s < 2 ? [240, 245, 250, 255] : [24, 31, 117, 159])[Math.min(3, Math.floor(t * 4))]!, tc: (j, L, _t, s) => (s < 2 ? 232 + Math.floor(18 * (1 - j / (L + 1))) : [117, 31, 24][Math.min(2, j - 1)]!) }),
  // hyper: top speed, held: long streaks all whizzing right to left at the same 3 columns a frame
  hyper: warpFx({ mode: 'left', n: 10, even: 3, len: () => 6, glyph: () => '━', col: () => 255 }),
  gold: warpFx({ n: 16, speed: 1.6, col: t => [94, 136, 178, 220, 229, 231][Math.min(5, Math.floor(t * 6))]!, tc: j => [229, 220, 178, 136, 94][Math.min(4, j - 1)]!, len: t => (t > 0.3 ? 2 : 0), core: F => [178, 220, 229, 230][Math.floor(2 + 1.99 * Math.sin(F * 0.35))]! }),
  jump: jumpFx,
  burst: warpFx({ n: 16, perCol: 1 / 3, sync: true, len: t => 1 + Math.floor(t * 3), glyph: t => (t < 0.3 ? '·' : '━'), col: t => (t < 0.3 ? 250 : 255) }),
}

// Equalizer bars (simulated audio). Each variant has its own seed so no two animate alike.
const eqR = (i: number, F: number, s = 0): number => seeded((i * 17 + F * 31 + s * 977) | 0)()
const eqSm = (i: number, F: number, s = 0): number => eqR(i, F, s) * 0.65 + eqR(i, F - 1, s) * 0.35
const eqDec = (i: number, F: number, rate = 0.78, K = 8, s = 0): number => {
  let m = 0
  for (let k = 0; k <= K; k++) m = Math.max(m, eqR(i, F - k, s) * Math.pow(rate, k))
  return m
}
const EQ_LV = Array.from('▁▂▃▄▅▆▇█')
const eqLv = (v: number, n = 8): number => Math.max(0, Math.min(n - 1, Math.floor(v * n)))
const EQ_GRN = [46, 82, 118, 154, 190, 226, 208, 196]
const EQ_COOL = [51, 45, 39, 33, 27, 63, 99, 129]
const EQ_FIRE = [52, 88, 124, 160, 196, 202, 208, 226]
const EQ_MONO = [238, 240, 242, 244, 246, 248, 250, 255]
const eqBar = (v: number, p: number[]): Cell => {
  const l = eqLv(v)
  return [EQ_LV[l]!, p[l]!]
}
const EQ_BR = ['⣀', '⣄', '⣤', '⣦', '⣶', '⣷', '⣿']
const EQ_DB = Array.from('⡀⡄⡆⡇⣇⣧⣷⣿')
const eqRow = (W: number, cell: (i: number) => Cell): Cell[] => Array.from({ length: W }, (_, i) => cell(i))
// tide full plays only the eqs that look different (TIDE_ORDER.eq) and lets their colour drift through
// the colour-only variants instead: s runs 0 → 1 over the whole eq section, fire → cool → rainbow (it
// opens in fire, calm, behind the split's green beams).
// The bar's level comes from its glyph.
const EQ_LADDERS = [EQ_LV, EQ_BR, EQ_DB]
function eqDrift(glyph: string, s: number, i: number, W: number, F: number): number {
  const lad = EQ_LADDERS.find(l => l.includes(glyph))
  const l = lad ? lad.indexOf(glyph) / (lad.length - 1) : 0.5
  const k = Math.round(l * 7)
  const stops = [x256(EQ_FIRE[k]!), x256(EQ_COOL[k]!), x256(hsv(i / W + F / 80, 1, 0.55 + 0.45 * l))]
  const at = Math.max(0, Math.min(1, s)) * (stops.length - 1)
  const a = Math.min(stops.length - 2, Math.floor(at))
  return mixRgb(stops[a]!, stops[a + 1]!, at - a)
}

const EQ: Record<string, Variant> = {
  classic: W => F => eqRow(W, i => eqBar(eqSm(i, F), EQ_GRN)),
  fire: W => F => eqRow(W, i => eqBar(eqSm(i, F, 2), EQ_FIRE)),
  mono: W => F => eqRow(W, i => eqBar(eqSm(i, F, 4), EQ_MONO)),
  rainbow: W => F =>
    eqRow(W, i => {
      const v = eqDec(i, F, 0.8, 8, 16)
      return [EQ_LV[eqLv(v)]!, hsv(i / W + F / 80, 1, 0.55 + 0.45 * v)]
    }),
  shade: W => F => eqRow(W, i => ['░▒▓█'[eqLv(eqSm(i, F, 6), 4)]!, hsv(0.5 + (i / W) * 0.4)]),
  spectrum: W => F => eqRow(W, i => eqBar(Math.min(1, eqSm(i, F, 7) * (1.35 - (0.85 * i) / W)), EQ_GRN)),
  center: W => F =>
    eqRow(W, i => {
      const x = Math.abs(i - (W - 1) / 2)
      const j = Math.floor(x)
      const d = x / (W / 2)
      return eqBar(Math.min(1, eqSm(j, F, 9) * (1.3 - d * 1.1)), EQ_FIRE)
    }),
  beat: W => F => {
    const e = Math.exp(-(((F % 8) + 8) % 8) / 2.2)
    return eqRow(W, i => eqBar(Math.min(1, 0.12 * eqR(i, F) + e * (0.55 + 0.45 * eqR(i, F >> 3, 5))), EQ_FIRE))
  },
  braille: W => F =>
    eqRow(W, i => {
      const l = Math.min(6, Math.floor(eqSm(i, F, 13) * 7))
      return [EQ_BR[l]!, EQ_GRN[Math.round((l / 6) * 7)]!]
    }),
  dotbars: W => F =>
    eqRow(W, i => {
      const l = eqLv(eqSm(i, F, 14))
      return [EQ_DB[l]!, EQ_COOL[l]!]
    }),
}

// Aurora: shimmering curtains of ░▒▓█; v (0..1) is the wave's strength at a cell, each row shifted a
// little from the one above. The variants share the motion and differ only in colour: color(v) gives an
// xterm-256 code (hsv() or the 232-255 grey ramp). speed < 1 slows the drift.
const AURORA_GLYPHS = Array.from('░▒▓█')
const auroraFx =
  (color: (v: number, i: number, W: number, F: number) => number, speed = 1): Variant =>
  (W, y) =>
  frame => {
    const F = specFrame(frame) * speed
    return Array.from({ length: W }, (_, i): Cell => {
      const v = (Math.sin(i / 6 + F / 5 + y / 2) + Math.sin(i / 3.3 - F / 7) + Math.sin(i / 11 + F / 3) + 3) / 6
      return [AURORA_GLYPHS[Math.min(3, Math.max(0, Math.floor(v * 4)))]!, color(v, i, W, F)]
    })
  }
const AURORA: Record<string, Variant> = {
  borealis: auroraFx(v => hsv(0.33 + 0.4 * v, 0.9, 0.45 + 0.55 * v)),
  australis: auroraFx(v => hsv(0.5 + 0.42 * v, 0.85, 0.45 + 0.55 * v)),
  sunset: auroraFx(v => hsv(0.16 * v, 1, 0.5 + 0.5 * v)),
  lava: auroraFx(v => hsv(0.09 * v, 1, 0.3 + 0.6 * v), 0.5),
  ocean: auroraFx(v => hsv(0.66 - 0.16 * v, 1 - 0.5 * v, 0.4 + 0.6 * v)),
  ice: auroraFx(v => hsv(0.58, 0.35 - 0.3 * v, 0.6 + 0.4 * v)),
  toxic: auroraFx(v => hsv(0.33 - 0.17 * v, 1, 0.35 + 0.65 * v)),
  sakura: auroraFx(v => hsv(0.97 - 0.14 * v, 0.35 + 0.5 * v, 0.85 + 0.15 * v)),
  neon: auroraFx(v => hsv(0.83 - 0.33 * v, 1, 0.75 + 0.25 * v)),
  gold: auroraFx(v => hsv(0.07 + 0.07 * v, 0.95 - 0.2 * v, 0.35 + 0.65 * v)),
  ghost: auroraFx(v => 236 + Math.round(v * 19)),
  rainbow: auroraFx((v, i, W, F) => hsv(0.3 * v + i / W + F / 40, 0.9, 0.5 + 0.5 * v)),
}

const FAMILIES = { rain: RAIN, scanner: SCANNER, warp: WARP, eq: EQ, aurora: AURORA } as const
type Family = keyof typeof FAMILIES
const isFamily = (name: string): name is Family => Object.prototype.hasOwnProperty.call(FAMILIES, name)
const VARIANT_DEFAULTS: Record<Family, string> = { rain: 'downpour', scanner: 'dual', warp: 'inward', eq: 'classic', aurora: 'borealis' }

// Draws a family variant: one instance per row, each row seeded differently (at 1 row it is the spec exactly).
// morph (aurora in tide): carry on from frame `start` of variant `from` and slide its colours into this
// variant's over `morph` frames. Aurora variants share their motion, so only the colours move.
// drift: false keeps an eq in its own colours (the simulation drifts them, see eqDrift)
type FamilyOpts = { start?: number; from?: string; morph?: number; drift?: boolean; nominal?: number }
const mixRgb = (a: number, b: number, t: number): number =>
  (Math.round(((a >> 16) & 255) * (1 - t) + ((b >> 16) & 255) * t) << 16) |
  (Math.round(((a >> 8) & 255) * (1 - t) + ((b >> 8) & 255) * t) << 8) |
  Math.round((a & 255) * (1 - t) + (b & 255) * t)
function makeFamily(family: Family, w: number, h: number, o: FamilyOpts = {}): Effect {
  const e = blank(w, h)
  const variant = FAMILIES[family][variants[family]] ?? FAMILIES[family][VARIANT_DEFAULTS[family]]!
  const rows = Array.from({ length: h }, (_, y) => variant(w, y, h))
  const fromVariant = o.from ? FAMILIES[family][o.from] : undefined
  const fromRows = fromVariant ? Array.from({ length: h }, (_, y) => fromVariant(w, y, h)) : []
  const morph = Math.max(1, o.morph ?? 1)
  // the simulation's scanners move SCAN_SPEED columns a frame (scanStep)
  const S = family === 'scanner' ? scanStep() : 1
  const scanV = variants.scanner
  // In tide, a scanner may start mid-lap so it carries on where the one before it left off.
  let F = o.start ?? (family === 'scanner' && tide ? scanStart(variants.scanner, w) : 0)
  // the simulation (tide full): the last rain (ember) turns rainbow over its last EMBER_RAINBOW_FRAMES, left
  // to right, so the flood into trippy's rainbow plasma follows on from it
  const tail = family === 'rain' && frameTimed() && variants.rain === TIDE_ORDER.rain?.at(-1) ? variantFrames('rain', variants.rain, w) - EMBER_RAINBOW_FRAMES : -1
  const rainbow = (i: number, fg: number): number => {
    const q = ((fx.age ?? 0) - tail) / EMBER_RAINBOW_FRAMES
    const t = Math.max(0, Math.min(1, (q * 1.6 - i / w) * 4))
    if (t === 0) return fg
    const v = Math.max((fg >> 16) & 255, (fg >> 8) & 255, fg & 255) / 255
    return mixRgb(fg, x256(hsv(i / w + F / 40, 0.9, Math.max(0.45, v))), t)
  }
  // tide full: an eq's colour drifts across the whole eq section (eqDrift)
  const eqOrder = TIDE_ORDER.eq ?? []
  const eqName = variants.eq
  // a simulation scanner ends where its lap (and split) does, counted from its nominal start (scanEnd)
  const end = family === 'scanner' ? (o.nominal ?? F) + scanFrames(scanV, w) : undefined
  const drift = o.drift ?? (family === 'eq' && tide && tideFull && eqOrder.includes(eqName))
  const fx: Effect = {
    ...e,
    age: 0,
    pos: F,
    end,
    step() {
      fx.age = (fx.age ?? 0) + 1
      const t = fromVariant ? Math.min(1, fx.age / morph) : 1
      const ds = drift ? (Math.max(0, eqOrder.indexOf(eqName)) + Math.min(1, fx.age / variantFrames('eq', eqName, w))) / eqOrder.length : 0
      e.codes.fill(0x20)
      e.fgs.fill(DEFAULT)
      for (let y = 0; y < h; y++) {
        const cells = rows[y]!(F)
        const old = t < 1 ? fromRows[y]!(F) : null
        for (let i = 0; i < w; i++) {
          const c = cells[i]
          const b = old?.[i]
          if (!c) continue
          const fg = drift ? eqDrift(c[0], ds, i, w, F) : b ? mixRgb(x256(b[1]), x256(c[1]), t) : x256(c[1])
          put(e, i, y, cp(c[0]), tail >= 0 && fx.age! > tail ? rainbow(i, fg) : fg)
        }
      }
      fx.last = F
      F = S > 1 ? scanAdvance(F, scanV, w, S) : F + 1
      fx.pos = F
    },
  }
  return fx
}

// Psychedelic plasma: a 2-D sine field coloured by a rotating hue.
function makeTrippy(w: number, h: number): Effect {
  const e = blank(w, h)
  const glyphs = Array.from('░▒▓█').map(cp)
  let frame = 0
  return {
    ...e,
    step() {
      const F = specFrame(frame++)
      for (let y = 0; y < h; y++) {
        for (let i = 0; i < w; i++) {
          const v = Math.sin(i / 3 + F / 2) + Math.sin(i / 5 - F / 3 + y / 2) + Math.sin((i + F + y * 3) / 7)
          const n = (v + 3) / 6
          put(e, i, y, glyphs[Math.min(3, Math.max(0, Math.floor(n * 4)))]!, x256(hsv(n + F / 20)))
        }
      }
    },
  }
}

// Cyan and magenta data corruption: scattered noise tiles plus burst strips. Each tile appears, holds for
// GLITCH_HOLD_MS, then vanishes; new ones appear at random moments, so the picture changes piece by piece.
// About 6% of cells carry noise and each row about half a burst at any time, as before.
const GLITCH_HOLD_MS = 1500
function makeGlitch(w: number, h: number): Effect {
  const e = blank(w, h)
  const palette = [51, 201, 231, 46].map(x256)
  const noise = Array.from('░▒▓█▌▐').map(cp)
  const burst = Array.from('▌▐░▒▓█▀▄').map(cp)
  const hold = Math.max(1, Math.round(GLITCH_HOLD_MS / FRAME_MS))
  const life = new Uint16Array(w * h)
  const tile = (x: number, y: number, glyphs: number[]) => {
    put(e, x, y, pick(glyphs), pick(palette))
    life[y * w + x] = hold
  }
  const effect: Effect = {
    ...e,
    step() {
      for (let k = 0; k < life.length; k++) {
        if (life[k] === 0) continue
        if (--life[k]! === 0) {
          e.codes[k] = 0x20
          e.fgs[k] = DEFAULT
        }
      }
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) if (Math.random() < 0.06 / hold) tile(x, y, noise)
        if (Math.random() < 0.5 / hold) {
          const start = rnd(w)
          const length = rnd(14) + 3
          for (let k = 0; k < length && start + k < w; k++) tile(start + k, y, burst)
        }
      }
    },
  }
  for (let k = 0; k < hold; k++) effect.step()
  return effect
}

// Tide's reboot, after glitch (which crashes into it, see the crash fade): ERROR : SIMULATION FAILED
// blinking once a second for 3 s, then RESTARTING with one more dot each second and a short progress bar
// under it for 3 s, then 5 s of 2-row matrix rain (classic, mixed, normal speed and density). In the rain's last second the rain ends, top row first, then the bottom row, column
// by column, so the band is empty when the 1-row scanner starts (no transition). The text is green and decodes from random
// characters into place. rebootAt keeps how far it got, so a band hidden while Claude is idle carries on.
// The simulation's version: v<session>.<loop>. Each Claude Code session that runs the simulation (or
// plain tide) takes the next session number the first time it does; each crash in it adds a loop. A
// reload or a resumed session keeps its own number and loops (looked up by its session id). The reboot
// says which version failed and which one is restarting, and the POST shows the current one. Saved as
// v2.sim on this machine, so it carries across sessions and days; the last SIM_KEEP sessions are kept.
type SimBook = { count: number; sessions: Record<string, { major: number; loops: number; at: number }> }
const SIM_KEEP = 50
let simBook: SimBook = { count: 0, sessions: {} }
let sessionId = 'local'
let simMajor = 0
let simLoops = 0
let simRunsDirty = false
// This session runs the simulation (it shows while Claude works): give it its number, once (a reload
// finds it again). Called from the AbovePrompt render and on a crash.
function simEnter(): void {
  if (simMajor) return
  const have = simBook.sessions[sessionId]
  if (have) {
    simMajor = have.major
    simLoops = have.loops
    return
  }
  simMajor = ++simBook.count
  simLoops = 0
  simBook.sessions[sessionId] = { major: simMajor, loops: 0, at: Date.now() }
  const ids = Object.keys(simBook.sessions).sort((a, b) => simBook.sessions[b]!.at - simBook.sessions[a]!.at)
  for (const id of ids.slice(SIM_KEEP)) delete simBook.sessions[id]
  simRunsDirty = true
}
// A crash: the next loop of this session's simulation.
function simCrash(): void {
  simEnter()
  simLoops++
  const mine = simBook.sessions[sessionId]
  if (mine) mine.loops = simLoops
  simRunsDirty = true
}
// The version shown. next: the version restarting after this crash.
// The version shown. The demo is not a real session: it always shows v1.0 (restarting v1.1) and never
// counts.
const simVersion = (next = false): string => (demoOn() ? `v1.${next ? 1 : 0}` : `v${simMajor || 1}.${simLoops + (next ? 1 : 0)}`)
const rebootText = (): string => `ERROR : SIMULATION ${simVersion()} FAILED`
const REBOOT_SHORT = 'ERROR'
const REBOOT_RESTART = 'RESTARTING'
const REBOOT_PHASE_MS = 3000
const REBOOT_RAIN_MS = 5000
const REBOOT_DRAIN_MS = 1000
const REBOOT_FRAMES = Math.round((2 * REBOOT_PHASE_MS + REBOOT_RAIN_MS) / FRAME_MS)
const REBOOT_MATRIX: MatrixOpts = { style: 'classic', chars: 'mixed', speed: 'normal', density: 'normal' }
const REBOOT_GREEN = 0x00ff41
let rebootAt = 0
function makeReboot(w: number, h: number, start = rebootAt, live = true): Effect {
  const e = blank(w, h)
  const rain = makeMatrix(w, h, REBOOT_MATRIX, false)
  const rainFrom = Math.round((2 * REBOOT_PHASE_MS) / FRAME_MS)
  for (let f = rainFrom; f < start; f++) rain.step()
  const glyphs = Array.from(MATRIX_CHARS.mixed).map(cp)
  const lock = Array.from({ length: 48 }, () => rnd(7))
  const drain = Float32Array.from({ length: w }, () => Math.random() * 0.7)
  // text s at (x0, y), f frames into its phase: each letter is a random character until its lock frame
  const text = (s: string, x0: number, y: number, f: number) => {
    for (let i = 0; i < s.length && x0 + i < w; i++) {
      if (s[i] === ' ') continue
      const isLocked = f >= lock[i]!
      put(e, x0 + i, y, isLocked ? cp(s[i]!) : glyphs[rnd(glyphs.length)]!, !isLocked ? green(0.3) : f === lock[i] ? 0xd8ffd8 : REBOOT_GREEN)
    }
  }
  const fx: Effect = {
    ...e,
    age: start,
    step() {
      const age = fx.age ?? 0
      fx.age = age + 1
      if (live) rebootAt = fx.age
      const ms = age * FRAME_MS
      e.codes.fill(0x20)
      e.fgs.fill(DEFAULT)
      if (ms < REBOOT_PHASE_MS) {
        const full = rebootText()
        const s = w >= full.length ? full : REBOOT_SHORT.slice(0, w)
        if (ms % 1000 < 600) text(s, Math.floor((w - s.length) / 2), 0, age)
        return
      }
      if (ms < 2 * REBOOT_PHASE_MS) {
        const t = ms - REBOOT_PHASE_MS
        const restart = w >= REBOOT_RESTART.length + 9 ? `${REBOOT_RESTART} ${simVersion(true)}` : REBOOT_RESTART
        const x0 = Math.max(0, Math.floor((w - restart.length - 3) / 2))
        text(restart + '.'.repeat(Math.min(3, Math.floor(t / 1000) + 1)), x0, 0, age - Math.round(REBOOT_PHASE_MS / FRAME_MS))
        if (h > 1) {
          const bw = Math.min(24, Math.max(4, Math.floor(w / 5)))
          const bx = Math.floor((w - bw) / 2)
          const n = Math.min(bw, Math.floor((t / REBOOT_PHASE_MS) * (bw + 1)))
          for (let i = 0; i < bw; i++) put(e, bx + i, h - 1, cp('▄'), i < n ? REBOOT_GREEN : 0x0f3d1a)
        }
        return
      }
      rain.step()
      e.codes.set(rain.codes)
      e.fgs.set(rain.fgs)
      const p = 1 - (REBOOT_FRAMES * FRAME_MS - ms) / REBOOT_DRAIN_MS
      if (p <= 0) return
      // the rain ends: the top row drains first, then the bottom row, each column at its own moment; by about
      // 0.75 s into the last second the band is empty, and stays empty briefly before the scanner starts
      for (let x = 0; x < w; x++) {
        if (p >= drain[x]! * 0.45) for (let y = 0; y < h - 1; y++) put(e, x, y, 0x20, DEFAULT)
        if (p >= 0.4 + drain[x]! * 0.5) put(e, x, h - 1, 0x20, DEFAULT)
      }
    },
  }
  return fx
}

// The POST: tide full's start page (2 rows), shown each time tide full starts (turned on by command, a new
// session or /reload-plugins), never between loops. A blinking cursor, then SIMULATION v1.0 typed out,
// then one boot line at a time on the top row, each typed out and then loading 1 → 100% over about
// 3 s with uneven jumps and stalls; the stability check stops partway and shows WARN, blinking. The
// bottom row is a thin ▄ bar for the whole boot. Then "> entering simulation...", and the same matrix
// rain as the reboot's (makeReboot from its rain), which ends before the loop starts. postAt keeps
// how far it got, like rebootAt.
// the title as typed (its time is set for up to three digits of the version)
const POST_TITLE = 'SIMULATION v1.000'
const postTitle = (): string => `SIMULATION ${simVersion()}`
const POST_LINES = ['loading signal', 'generating sky', 'seeding life', 'building space', 'forming weather', 'igniting fire', 'stability check']
// a boot line (label, dots, percent), and the progress bar under it, edge to edge: 7 boot lines × 5 cells
const POST_WIDTH = 35
const POST_CURSOR = Math.round(1000 / FRAME_MS) // the blinking cursor before the title
const POST_TYPE = 2 // characters typed a frame
const POST_LOAD = Math.round(3000 / FRAME_MS) // 1 → 100%
const POST_HOLD = Math.round(400 / FRAME_MS) // a finished line stays this long
const POST_WARN_AT = 87 // where the stability check stops
const POST_WARN_HOLD = Math.round(2000 / FRAME_MS)
const POST_ENTER = '> entering simulation...'
type PostStep = { text: string; type: number; load: number; hold: number; warn?: boolean }
const POST_STEPS: PostStep[] = [
  { text: POST_TITLE, type: Math.ceil(POST_TITLE.length / POST_TYPE), load: 0, hold: Math.round(1000 / FRAME_MS) },
  ...POST_LINES.map((l, i): PostStep => {
    const warn = i === POST_LINES.length - 1
    return { text: `> ${l} `, type: Math.ceil((l.length + 3) / POST_TYPE), load: POST_LOAD, hold: warn ? POST_WARN_HOLD : POST_HOLD, warn }
  }),
  { text: POST_ENTER, type: Math.ceil(POST_ENTER.length / POST_TYPE), load: 0, hold: Math.round(1200 / FRAME_MS) },
]
const POST_TEXT_FRAMES = POST_CURSOR + POST_STEPS.reduce((n, s) => n + s.type + s.load + s.hold, 0)
const REBOOT_RAIN_FROM = Math.round((2 * REBOOT_PHASE_MS) / FRAME_MS)
const POST_FRAMES = POST_TEXT_FRAMES + (REBOOT_FRAMES - REBOOT_RAIN_FROM)
// A loading run that looks real: seeded uneven steps, some frames stalled, ending exactly at `to`.
function postLoad(seed: number, frames: number, to: number): number[] {
  const r = seeded(seed)
  const w = Array.from({ length: frames }, () => {
    const x = r()
    return x < 0.3 ? 0 : x < 0.85 ? r() : 1.5 + r() * 3
  })
  const sum = w.reduce((s, x) => s + x, 0) || 1
  let acc = 0
  return w.map(x => {
    acc += x
    return Math.max(1, Math.min(to, Math.floor((acc / sum) * to)))
  })
}
let postAt = 0
function makePost(w: number, h: number, start = postAt, live = true): Effect {
  const e = blank(w, h)
  const rain = makeReboot(w, h, REBOOT_RAIN_FROM + Math.max(0, start - POST_TEXT_FRAMES), false)
  const runs = POST_STEPS.map((s, i) => (s.load ? postLoad(i * 131 + 7, s.load, s.warn ? POST_WARN_AT : 100) : []))
  const x0 = Math.max(0, Math.floor((w - POST_WIDTH) / 2))
  const write = (s: string, x: number, y: number, fg = REBOOT_GREEN) => {
    for (let i = 0; i < s.length && x + i < w; i++) if (s[i] !== ' ') put(e, x + i, y, cp(s[i]!), fg)
  }
  const fx: Effect = {
    ...e,
    age: start,
    step() {
      const age = fx.age ?? 0
      fx.age = age + 1
      if (live) postAt = fx.age
      e.codes.fill(0x20)
      e.fgs.fill(DEFAULT)
      if (age >= POST_TEXT_FRAMES) {
        rain.step()
        e.codes.set(rain.codes)
        e.fgs.set(rain.fgs)
        return
      }
      const blink = Math.floor(age / 5) % 2 === 0
      let f = age - POST_CURSOR
      // the title is centred over the boot lines; the cursor blinks where it will start
      const titleX = x0 + Math.max(0, Math.floor((POST_WIDTH - postTitle().length) / 2))
      if (f < 0) {
        if (blink) put(e, titleX, 0, cp('▌'), REBOOT_GREEN)
        return
      }
      // the step on screen and how far into it
      let k = 0
      while (k < POST_STEPS.length - 1 && f >= POST_STEPS[k]!.type + POST_STEPS[k]!.load + POST_STEPS[k]!.hold) {
        f -= POST_STEPS[k]!.type + POST_STEPS[k]!.load + POST_STEPS[k]!.hold
        k++
      }
      const s = k === 0 ? { ...POST_STEPS[0]!, text: postTitle() } : POST_STEPS[k]!
      const typed = Math.min(s.text.length, (f + 1) * POST_TYPE)
      const tx = k === 0 ? titleX : x0
      write(s.text.slice(0, typed), tx, 0)
      if (typed < s.text.length || (s.load === 0 && f < s.type + s.hold)) {
        if (blink || typed < s.text.length) put(e, tx + typed, 0, cp('▌'), REBOOT_GREEN)
      }
      if (s.load && f >= s.type) {
        const run = runs[k]!
        const pct = run[Math.min(run.length - 1, f - s.type)]!
        const done = f >= s.type + s.load
        const tail = s.warn && done ? 'WARN' : `${pct}%`
        const dots = '.'.repeat(Math.max(1, POST_WIDTH - s.text.length - 5))
        write(dots, x0 + s.text.length, 0, 0x0f7d2a)
        if (!(s.warn && done && !blink)) write(tail.padStart(4), x0 + POST_WIDTH - 4, 0)
      }
      // the whole boot's progress, thin, on the bottom row (from the first boot line, not under the title):
      // exactly under the boot line, edge to edge, each boot line its own equal share (5 cells), which fills
      // with that line's percent, stalls and jumps included
      if (h > 1 && k > 0) {
        const lines = POST_STEPS.filter(p => p.load)
        const before = POST_STEPS.slice(0, k).filter(p => p.load).length
        const run = runs[k]!
        const part = s.load && f >= s.type ? run[Math.min(run.length - 1, f - s.type)]! / 100 : 0
        const prog = Math.min(1, (before + part) / lines.length)
        const bw = Math.min(POST_WIDTH, w - x0)
        const bx = x0
        const n = Math.round(prog * bw)
        for (let i = 0; i < bw; i++) put(e, bx + i, h - 1, cp('▄'), i < n ? REBOOT_GREEN : 0x0f3d1a)
      }
    },
  }
  return fx
}
const MAKERS: Record<string, (w: number, h: number) => Effect> = {
  matrix: makeMatrix,
  stars: makeStars,
  nebula: makeNebula,
  comet: makeComet,
  constellations: makeConstellations,
  planet: makePlanet,
  chomp: makeChomp,
  scanner: (w, h) => makeFamily('scanner', w, h),
  rain: (w, h) => makeFamily('rain', w, h),
  warp: (w, h) => makeFamily('warp', w, h),
  eq: (w, h) => makeFamily('eq', w, h),
  trippy: makeTrippy,
  glitch: makeGlitch,
  reboot: (w, h) => makeReboot(w, h),
  post: (w, h) => makePost(w, h),
  aurora: (w, h) => makeFamily('aurora', w, h),
}

// rows, cols: the size the Raster is mounted at (set when drawn). A frame of another size is refused by
// the engine, so the clock skips the blit until the redraw catches up (a fade ending with a smaller band).
type Site = { name: string; effect: Effect; fade?: Fade; rows?: number; cols?: number }
let band: Band = 'off'
let variants: Record<Family, string> = { ...VARIANT_DEFAULTS }
const bandKey = (): string => (isFamily(band) ? `${band}:${variants[band]}` : band)
// what /neontide shows as the chapter playing: "aurora gold", or "post, then scanner code" while it boots
const labelOf = (b: Band): string => (isFamily(b) ? `${b} ${variants[b]}` : b)
const bandLabel = (): string => (band === 'post' ? `post, then ${labelOf(postReturn)}` : labelOf(band))
// shuffleWorkedMs counts how long the band on screen has had Claude working (time waiting for the user
// does not count); a band timed on the clock moves on when it reaches its time. SHUFFLE_MS is the
// lighter tide's time, which the simulation never uses.
const SHUFFLE_MS = 2 * 60 * 1000
let shuffleWorkedMs = 0

// Colour signature of a band: a histogram of its cells' colours over 40 frames, 12 hue bins plus one for
// greys, weighted by brightness and spread into the neighbouring hues so that near colours count as close.
const signatures = new Map<string, number[]>()
function signature(key: string): number[] {
  const hit = signatures.get(key)
  if (hit) return hit
  const [name = '', variant] = key.split(':')
  const saved = { ...variants }
  if (variant && isFamily(name)) variants[name] = variant
  // reboot is judged by its rain (what the scanner after it follows on from), without touching rebootAt
  const e = name === 'reboot' ? makeReboot(48, 2, Math.round((2 * REBOOT_PHASE_MS) / FRAME_MS), false) : MAKERS[name]!(48, BAND_HEIGHT[name as Band] ?? BAND_ROWS)
  Object.assign(variants, saved)
  const bins = new Array<number>(13).fill(0)
  for (let f = 0; f < 40; f++) {
    e.step()
    for (let i = 0; i < e.codes.length; i++) {
      const c = e.fgs[i]!
      if (e.codes[i] === 0x20 || c === DEFAULT) continue
      const r = (c >> 16) & 255
      const g = (c >> 8) & 255
      const b = c & 255
      const max = Math.max(r, g, b)
      const min = Math.min(r, g, b)
      const v = max / 255
      if (max === 0 || (max - min) / max < 0.25) {
        bins[12]! += v
        continue
      }
      const d = max - min
      const hue = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
      const bin = Math.floor((hue / 6) * 12) % 12
      bins[bin]! += v * 0.6
      bins[(bin + 1) % 12]! += v * 0.2
      bins[(bin + 11) % 12]! += v * 0.2
    }
  }
  const sum = bins.reduce((s, x) => s + x, 0) || 1
  const out = bins.map(x => x / sum)
  signatures.set(key, out)
  return out
}
// 0 = same colours, 1 = nothing in common.
const colourDistance = (a: number[], b: number[]): number => a.reduce((s, x, i) => s + Math.abs(x - b[i]!), 0) / 2

// The simulation (tide full in the code): one category after another in a fixed round, glitch and the
// reboot last, then round again (1-row bands → 3-row bands → glitch → reboot → back to 1 row). Every
// variant of a category plays before the next category, in its TIDE_ORDER or chained by colour (each
// next variant is, at random, one of the two not yet shown this round that best continue from the one
// on screen). The code also keeps a lighter tide (one variant per category, tideFull false) that the
// simulation never uses. Every round ends with glitch crashing into the reboot (REBOOT_FRAMES), whose
// rain ends before the scanner starts (no transition between them).
const TIDE: Band[] = ['scanner', 'eq', 'aurora', 'warp', 'nebula', 'constellations', 'stars', 'comet', 'planet', 'rain', 'trippy', 'glitch', 'reboot']
// the space act's chapters after warp, each SPACE_MS on the clock in the simulation (tide full)
const SPACE: Band[] = ['nebula', 'constellations', 'stars', 'comet', 'planet']
const SPACE_MS = 20 * 1000
// the planet stays only while it rises (4 s) and a moment more, then the dive
const PLANET_MS = 5 * 1000
// the simulation's glitch is timed in frames, not on the 1 s clock (see the frame clock): its corrupt
// fade-in, then SIM_GLITCH_MS of full glitch, then the crash (which runs on the reboot's time)
const SIM_GLITCH_MS = 2 * 1000
let glitchFrames = 0
const bandMs = (b: Band): number => (b === 'glitch' ? Infinity : b === 'planet' ? PLANET_MS : SPACE.includes(b) ? SPACE_MS : TIDE_BAND_MS)
const TIDE_GLITCH_MS = 30 * 1000
const TIDE_RECENT = 3
let tide = false
let tideFull = false
// /neontide demo: one whole round shown while Claude is idle (no tokens spent), from the POST to the end of
// the reboot; then the band hides when idle and the simulation carries on as normal. For previewing the
// story while working on it: it answers only where the environment variable NEONTIDE_DEMO is 1, and is
// not in the README or the command's hint. Not saved: a reload ends it.
let demo = false
const demoOn = (): boolean => demo && tide && tideFull
let tideCat = 0
let tideLeft: string[] = []
let tideRecent: Partial<Record<Family, string[]>> = {}
let fadeInto = ''
// The simulation (tide full) times each band to its own motion, counted in frames: a scanner one lap (left
// to right and back, so it depends on the band's width), an eq EQ_BEATS beats, warp burst whole bursts,
// any other family band TIDE_BAND_MS. Stars and trippy get TIDE_BAND_MS on the clock; glitch is counted in
// frames (SIM_GLITCH_MS after its corrupt fade-in). Plain
// tide keeps SHUFFLE_MS.
const TIDE_BAND_MS = 10 * 1000
const TIDE_BAND_FRAMES = Math.round(TIDE_BAND_MS / FRAME_MS)
const EQ_BEATS = 16
let bandCols = 120
// Tide's story order for each family (scanner has its own grouping below): eq from the middle out and
// from plain bars to fancy ones, aurora round the colour wheel to grey, warp from the first streaks
// speeding up to the jump, rain a storm building up to the rising sparks. Both tides use only these
// variants: warp inward and rain splash are left out.
const TIDE_ORDER: Partial<Record<Family, string[]>> = {
  // the matrix-green code first, two colours, then red wide splitting into the pairs, matrix last
  scanner: ['code', 'rainbow', 'fire', 'wide', 'mirror', 'dual', 'matrix'],
  eq: ['center', 'spectrum', 'beat', 'dotbars', 'braille'],
  aurora: ['rainbow', 'borealis', 'toxic', 'gold', 'sunset', 'lava', 'sakura', 'neon', 'australis', 'ocean', 'ice', 'ghost'],
  warp: ['speedlines', 'dense', 'twin', 'gold', 'neon', 'hyper', 'jump'],
  // acid is left out of tide: the storm peaks in neon, eases into glints (a lull, the bolts far off again,
  // the drops glinting), and the strike comes out of the quiet
  rain: ['drizzle', 'downpour', 'gale', 'neon', 'glints', 'ember'],
}
const tideVariants = (f: Family): string[] => TIDE_ORDER[f] ?? Object.keys(FAMILIES[f])
const AURORA_MORPH_FRAMES = 20
// the simulation: the auroras run as one continuous journey through their colours: each lasts
// AURORA_JOURNEY_FRAMES (about 2.5 s, 12 of them about 30 s) and its whole time is the slide from the
// colour before, so the sky never stops changing. Plain tide keeps one aurora for its usual time.
const AURORA_JOURNEY_FRAMES = Math.round(2500 / FRAME_MS)
const EMBER_RAINBOW_FRAMES = Math.round(2000 / FRAME_MS)
// Scanner laps in the simulation: the switch is counted in frames, so it lands exactly where
// the beams are, with no dissolve. tide full runs the single block scanners first (code first, then colour-chained), with
// red `wide` always last; it does its lap and carries on to the middle, where it splits into red
// `mirror` (starting at the middle going out), then `dual` (phased to cross there). Each mirrored one
// runs from meeting to meeting. matrix comes last, starting at the middle where the pair met.
const SCAN_PAIRS = ['mirror', 'dual']
// every tide round (after the reboot, and when tide is turned on) starts with the matrix-green scanner
const SCAN_FIRST = 'code'
const SCAN_SPLITTER = 'wide'
const SCAN_LAST = 'matrix'
const isScanSingle = (n: string) => !SCAN_PAIRS.includes(n) && n !== SCAN_LAST
function scanGroup(left: string[]): string[] {
  const singles = left.filter(isScanSingle)
  if (singles.length) return singles.length > 1 ? singles.filter(n => n !== SCAN_SPLITTER) : singles
  const pairs = SCAN_PAIRS.filter(n => left.includes(n))
  return pairs.length ? [pairs[0]!] : left
}
let scanSplit = false
// the scanner colour slide (about 1 s) between two single scanners
const SCAN_SLIDE = 10
// the splitter (wide) ends mid-band where it splits, so there is nothing to slide
const scanSplitFrom = (from: string): boolean => from === SCAN_SPLITTER
// the simulation's beams move SCAN_SPEED columns a frame, so its 7 scanners take about 1¼ min at 120
// columns instead of 2⅓ (a lap about 10½ s); the lighter tide keeps 1 column a frame
const SCAN_SPEED = 2
const scanStep = (): number => (tide && tideFull ? SCAN_SPEED : 1)
// the next beam frame: S columns on, but never past a wall (at width W, or half of it for mirror, a beam
// is at a wall every W - 1 frames), so the beam always touches both edges whatever the width
function scanAdvance(F: number, v: string, W: number, S: number): number {
  const wall = (v === 'mirror' ? Math.max(2, Math.floor(W / 2)) : Math.max(2, W)) - 1
  for (let k = 1; k < S; k++) if ((F + k) % wall === 0) return F + k
  return F + S
}
const frameTimed = (): boolean => tide && ((tideFull && isFamily(band)) || band === 'reboot' || band === 'post')
const scanStart = (v: string, W: number): number => (v === 'dual' || v === SCAN_LAST ? Math.floor(W / 2) : 0)
function scanFrames(v: string, W: number, split = scanSplit): number {
  W = Math.max(2, W)
  const lap = v === 'mirror' ? 2 * Math.max(2, Math.floor(W / 2)) - 2 : v === 'ease' ? Math.round(1.8 * W) : 2 * W - 2
  return lap + (split ? (v === 'ease' ? Math.round(0.45 * W) : Math.floor(W / 2)) : 0)
}
function scanChosen(): void {
  const v = variants.scanner
  scanSplit = tideFull && isScanSingle(v) && !tideLeft.some(isScanSingle)
}
// How many frames a family variant stays in the simulation.
function variantFrames(f: Family | 'reboot' | 'post', v: string, W: number, split = false): number {
  if (f === 'reboot') return REBOOT_FRAMES
  if (f === 'post') return POST_FRAMES
  if (f === 'scanner') return Math.ceil(scanFrames(v, W, split) / scanStep())
  if (f === 'eq') return EQ_BEATS * 8
  if (f === 'aurora' && tideFull) return AURORA_JOURNEY_FRAMES
  if (f === 'warp' && v === 'burst') return Math.ceil(TIDE_BAND_FRAMES / 18) * 18
  if (f === 'warp' && v === 'jump') return JUMP_FRAMES
  return TIDE_BAND_FRAMES
}
function closestVariant(f: Family, names: string[]): string {
  if (band === 'off') return pick(names)
  const from = signature(bandKey())
  return pick(names.map(n => ({ n, d: colourDistance(signature(`${f}:${n}`), from) })).sort((x, y) => x.d - y.d).slice(0, 2).map(x => x.n))
}
function tideEnter(cat: number): void {
  tideCat = ((cat % TIDE.length) + TIDE.length) % TIDE.length
  const next = TIDE[tideCat]!
  tideLeft = []
  if (isFamily(next)) {
    const all = tideVariants(next)
    if (tideFull) {
      const order = TIDE_ORDER[next]
      const first = order ? order[0]! : next === 'scanner' ? SCAN_FIRST : closestVariant(next, all)
      variants[next] = first
      tideLeft = (order ?? all).filter(n => n !== first)
    } else {
      const recent = tideRecent[next] ?? []
      variants[next] = next === 'scanner' ? SCAN_FIRST : closestVariant(next, all.filter(n => !recent.includes(n)))
      tideRecent[next] = [...recent, variants[next]].slice(-TIDE_RECENT)
    }
  }
  band = next
  fadeInto = bandKey()
  shuffleWorkedMs = 0
  rebootAt = 0
  scanSplit = false
  if (band === 'scanner') scanChosen()
  tidePosDirty = true
}
function tideNext(): void {
  if (band === 'post') return postDone()
  // the reboot is over: the next version of the simulation starts
  if (band === 'reboot') {
    // the demo round is over (it doesn't count); a real crash is the next loop
    if (demoOn()) demo = false
    else simCrash()
  }
  if (!tideFull || !isFamily(band) || tideLeft.length === 0) return tideEnter(tideCat + 1)
  const v = TIDE_ORDER[band] ? tideLeft[0]! : closestVariant(band, band === 'scanner' ? scanGroup(tideLeft) : tideLeft)
  variants[band] = v
  tideLeft = tideLeft.filter(n => n !== v)
  // scanner to scanner is a hard cut timed to the beams; the rest get the transition fadeKind() picks
  fadeInto = band === 'scanner' ? '' : bandKey()
  shuffleWorkedMs = 0
  if (band === 'scanner') scanChosen()
  tidePosDirty = true
}
function tideStart(full: boolean): void {
  tide = true
  demo = false
  tideFull = full
  tideRecent = {}
  tideEnter(0)
  postStart()
}
// tide full's start page: the band shows the POST, and the round (or the resumed position) waits in
// postReturn until it ends. Never between loops.
let postReturn: Band = 'off'
function postStart(): void {
  if (!tide || !tideFull || band === 'post') return
  postReturn = band
  band = 'post'
  postAt = 0
  fadeInto = 'post'
}
function postDone(): void {
  band = postReturn
  fadeInto = bandKey()
  shuffleWorkedMs = 0
  rebootAt = 0
  tidePosDirty = true
}
// Where the round is, saved as v2.tidePos so the next load (/reload-plugins or a new session) carries on
// from the same band and variant, with the same variants still to come. The band on screen restarts its own animation (a scanner its lap). tideEnter/tideNext mark it
// dirty; the 1 s clock writes it. A saved position that doesn't fit the code any more is ignored.
type TidePos = { full: boolean; cat: number; variant: string; left: string[]; recent: Partial<Record<Family, string[]>> }
let tidePosDirty = false
const tidePos = (): TidePos => ({ full: tideFull, cat: tideCat, variant: isFamily(band === 'post' ? postReturn : band) ? variants[(band === 'post' ? postReturn : band) as Family] : '', left: tideLeft, recent: tideRecent })
function tideResume(saved: unknown, full: boolean): boolean {
  if (!saved || typeof saved !== 'object') return false
  const p = saved as Partial<TidePos>
  if (p.full !== full || typeof p.cat !== 'number' || !Number.isInteger(p.cat) || p.cat < 0 || p.cat >= TIDE.length) return false
  const cat = TIDE[p.cat]!
  const names = isFamily(cat) ? tideVariants(cat) : []
  if (isFamily(cat) && (typeof p.variant !== 'string' || !names.includes(p.variant))) return false
  tide = true
  tideFull = full
  tideCat = p.cat
  band = cat
  if (isFamily(cat)) variants[cat] = p.variant!
  const strings = (v: unknown, allowed: string[]): string[] => (Array.isArray(v) ? v.filter((n): n is string => typeof n === 'string' && allowed.includes(n)) : [])
  tideLeft = full && isFamily(cat) ? strings(p.left, names).filter(n => n !== p.variant) : []
  tideRecent = {}
  if (p.recent && typeof p.recent === 'object') {
    for (const f of Object.keys(FAMILIES) as Family[]) {
      const r = strings((p.recent as Record<string, unknown>)[f], tideVariants(f))
      if (r.length) tideRecent[f] = r.slice(-TIDE_RECENT)
    }
  }
  fadeInto = ''
  shuffleWorkedMs = 0
  rebootAt = 0
  scanSplit = false
  if (band === 'scanner') scanChosen()
  return true
}

// Changes between tide's bands. Both bands keep animating while it runs. Shorter bands sit on the bottom
// rows, so a band growing from 1 to 3 rows rises out of the old one. fadeKind() picks the kind:
//   dissolve  each cell switches at its own random moment, bottom rows a little earlier (the default)
//   dip       eq → eq: the bars sink to silence, then the next eq rises
//   zoom      warp → warp: the old stars rush outwards, the new ones open from the centre
//   wind      rain → rain: the old rain blows away to the right, the new one blows in
//   melt      rain → rain: the old rain drips down the columns, the new one is behind it
//   ink       rain → rain: blots of the new rain appear at random spots and spread until they meet
//   mid       scanner → eq: eq opens out from the middle, where the matrix beam ended
//   decode    eq → aurora: the aurora's cells start as random characters and settle into place
//   burnout   aurora → warp, part 1 (1 row): the aurora keeps moving but burns out by itself: each cell
//             dims (█ ▓ ▒ ░) at its own moment and goes out. One cell near each of chomp's dot columns
//             leaves a bit (·) in its colour; the bits drift to the dot columns and turn into chomp's
//             dots, and the pac-man appears at the left edge. Then part 2:
//   eat       (3 rows) chomp's maze: blue walls above and below, the pac-man eats the dots left to right
//             at EAT_COLS a frame with two ghosts behind it, runs off the right edge and comes back in from
//             the left (the tunnel) to a third of the way in, where the ship builds round him; then the
//             ship launches: the walls stream away to the left as white streaks, the ghosts fall behind
//             and fade, and warp (speedlines in tide full) comes in around the ship.
//             Only the last SHIP_LAUNCH frames step warp, so its own time starts there.
//   fireworks warp → stars: a spark climbs, bursts in colour, and the sparks fall into the starfield
//   fall      stars → rain: the stars fall and the drizzle takes over
//   flood     rain → trippy: the plasma rises from the bottom with a ragged, flickering flame edge,
//             throwing rainbow sparks, until it fills the band (in tide full the ember has gone rainbow first)
//   corrupt   trippy → glitch: glitch eats the plasma cell by cell, slowly
//   crash     glitch → reboot: the glitch suddenly gets worse (more noise, rows tearing sideways, whole rows
//             flashing), strobes, goes blank, and the reboot's ERROR appears; the reboot waits meanwhile
//   dropout   warp → nebula: out of hyperspace: burst's streaks shrink to dots and slow, the core fades,
//             the ship's exhaust calms, and the nebula fades in round the ship
//   condense  nebula → constellations: the clouds thin out and the brightest points stay as stars
//   drift     constellations → stars: the lines fade and the stars begin drifting past
//   flare     stars → comet: the starfield fades and one star ahead brightens into the comet's head,
//             which then streaks past under the ship
//   (comet → planet dissolves; the planet rises ahead by itself)
//   dive      planet → rain: the planet grows as the ship nears it, cumulus banks pile up and rush past,
//             the ship flies into the white, then comes out under storm-grey cloud into the drizzle
//   strike    glints → ember (tide): the storm's last bolt hits the ship: silence, a white flash, the bolt,
//             the explosion (parts flying, the pac-man tumbling away up out of the band), and the wreck
//             burning into the ember's sparks
//   cut       reboot → scanner: no transition; the reboot's rain has already ended (band empty), so the
//             1-row scanner simply starts its lap from the left
const FADE_FRAMES = 8
type FadeKind = 'dissolve' | 'dip' | 'zoom' | 'wind' | 'melt' | 'ink' | 'mid' | 'decode' | 'burnout' | 'eat' | 'fireworks' | 'fall' | 'flood' | 'corrupt' | 'crash' | 'cut' | 'dropout' | 'condense' | 'drift' | 'flare' | 'dive' | 'strike' | 'split'
// Length of each kind in frames (90 ms); the sweeps cross the band at a fixed pace, so they depend on its width.
const FADE_LEN: Record<FadeKind, number | ((w: number) => number)> = {
  dissolve: FADE_FRAMES, dip: 12, zoom: 12, wind: 14, melt: 16, ink: 16, mid: 12, decode: 16,
  burnout: () => BURN_FADE + BURN_DRIFT + 3, eat: w => Math.ceil((w + 4 + shipX(w)) / EAT_COLS) + 1 + SHIP_ASSEMBLE + SHIP_LAUNCH, fireworks: 24, fall: 16, flood: 22, corrupt: 26, crash: 18, cut: 0,
  dropout: 30, condense: 26, drift: 20, flare: 18, dive: 78, strike: 46,
  split: w => Math.ceil(w / 2 / SPLIT_COLS) + SPLIT_TRAIL + SPLIT_RISE,
}
// burnout: BURN_FADE frames of the aurora going out (about 2 s), BURN_DRIFT frames of the bits drifting
// into place (about 1 s), then 3 frames of the pac-man at the left edge with the dots.
// eat: the pac-man eats at EAT_COLS a frame, through the tunnel to a third of the way in; then
// SHIP_ASSEMBLE frames of the ship building round him and SHIP_LAUNCH frames of the launch
const BURN_FADE = 22
// split (matrix scanner → eq): the beam reaching the middle splits into two that
// race to both edges at SPLIT_COLS (5) a frame with a SPLIT_TRAIL long kana trail; the eq rises behind them, its
// bars capped low right behind the trail and growing to full over SPLIT_RISE frames
const SPLIT_COLS = 5
const SPLIT_TRAIL = 6
const SPLIT_RISE = 14
// dropout: how much of it the jump's white-out takes to fade
const DROP_WHITE = 0.35
const BURN_DRIFT = 12
const EAT_COLS = 2
const SHIP_ASSEMBLE = 12
const SHIP_LAUNCH = 16
const CHOMP_DOT = 0xffd0a0
const CHOMP_WALL = 0x2040c0
const CHOMP_PAC = 0xffe000
const GHOSTS = [
  { gap: 6, fg: 0xff4040 },
  { gap: 10, fg: 0x40e0ff },
]
const isDot = (x: number): boolean => x >= 2 && x % 2 === 0
// The ship (tide's traveller through space): the pac-man in a little hull, ·∙≈≈╼◁◖{C}◗━━▶, facing right, a third
// of the way in on the middle row. It builds round the pac-man at the end of the chomp maze and is drawn
// over warp and stars (shipOverlay). parts: how much of it is built (1 = just the pac-man); exhaust:
// how many ≈ trail behind it (longer at higher warp speeds).
const shipX = (w: number): number => Math.floor(w / 3)
const SHIP_HULL = 0xc0c8d8
// the exhaust starts this far behind the cockpit (just behind the spar ╼); the ship has SHIP_PARTS parts
const SHIP_TAIL = 5
const SHIP_PARTS = 10
const SHIP_NOSE = 0xffffff
type CellSet = (x: number, y: number, code: number, fg: number) => void
// The flame behind the ship. heat 0 → 2: orange, getting hotter at the root (white-yellow, straining);
// blue: how much of it, from the nozzle back, burns blue (the afterburner); diamonds: shock diamonds ◆
// along the blue part, at this brightness; flash: how much of it, from the nozzle, flashes white; tight:
// full power, a solid jet with only its last 15% dispersed; steady: no flicker.
// silhouette (0 → 1): the ship dark against the jump's white-out, no jet once past half
type Flame = { heat?: number; blue?: number; diamonds?: number; flash?: number; tight?: boolean; steady?: boolean; hull?: number; silhouette?: number }
function flameColour(t: number, heat: number, isBlue: boolean): number {
  if (isBlue) return t < 0.15 ? mixRgb(0xffffff, 0x80f0ff, t / 0.15) : mixRgb(0x80f0ff, 0x1030c0, (t - 0.15) / 0.85)
  return mixRgb(mixRgb(0xffd060, 0xfff8e0, Math.min(1, heat / 2)), 0xff3010, t)
}
function drawShip(set: CellSet, cx: number, y: number, F: number, exhaust: number, parts = 99, flame: Flame = {}): void {
  const hull = flame.hull ?? SHIP_HULL
  // in the order it builds round him: the cockpit, its frame, the hull, the spar and the long nose
  const body: [number, string, number][] = [[0, F % 8 < 4 ? 'C' : 'O', CHOMP_PAC], [-1, '{', hull], [1, '}', hull], [-2, '◖', hull], [2, '◗', hull], [-3, '◁', hull], [3, '━', hull], [4, '━', hull], [5, '▶', flame.hull ?? SHIP_NOSE], [-4, '╼', hull]]
  const sil = flame.silhouette ?? 0
  body.slice(0, parts).forEach(([dx, g, fg]) => set(cx + dx, y, cp(g), sil > 0 ? mixRgb(fg, 0x22262c, sil) : fg))
  if (parts <= body.length || sil > 0.5) return
  const n = Math.max(1, Math.round(exhaust))
  const heat = flame.heat ?? 0
  const blue = flame.blue ?? 0
  const spread = flame.tight ? Math.max(1, Math.round(n * 0.15)) : 0
  for (let i = 0; i < n; i++) {
    const t = i / n
    const isBlue = t < blue
    // the flame flickers, more as it strains (heat 2)
    const jitter = flame.steady ? 0 : Math.random() * 0.25 * (1 + heat * 0.6)
    let fg = flameColour(Math.min(1, t + jitter), heat, isBlue)
    let g = '≈'
    if (flame.flash && t < flame.flash) fg = mixRgb(fg, 0xffffff, 0.75)
    if (flame.diamonds && isBlue && i % 3 === 2 && i < n - spread) {
      g = '◆'
      fg = mixRgb(fg, 0xffffff, flame.diamonds)
    }
    if (i >= n - spread) {
      // the dispersed end of a full-power jet
      const r = Math.random()
      if (r < 0.35) continue
      g = r < 0.7 ? '∙' : '·'
    }
    set(cx - SHIP_TAIL - i, y, cp(g), fg)
  }
  if (spread) return
  const cool = blue > 0.99
  set(cx - SHIP_TAIL - n, y, cp('∙'), cool ? 0x3050b0 : 0xa05030)
  set(cx - SHIP_TAIL - 1 - n, y, cp('·'), cool ? 0x182860 : 0x603020)
}
const SHIP_BANDS: Band[] = ['warp', 'nebula', 'constellations', 'stars', 'comet', 'planet', 'rain']
// The storm (tide). The lightning builds through the rains: sheet lightning (the top row flickering pale
// inside the clouds, no bolt) in downpour and gale, big close forked bolts in neon (the peak), then a lull
// in glints with only a few thin distant bolts, before the strike. The close ones light up the whole sky and shake the ship with their thunder. In gale the ship
// is buffeted. Ember comes after the strike: no ship.
// sheetAll: sheet lightning lighting every row (all but the ship): after the storm's first one or two
// cloud-row flashes (or near the end of gale at the latest), and once about 2 s before the strike
type BoltKind = 'sheet' | 'sheetAll' | 'far' | 'near'
type BoltCell = [number, number, string]
const STORM: Record<string, [BoltKind, number]> = { downpour: ['sheet', 0.03], gale: ['sheet', 0.04], glints: ['far', 0.015], neon: ['near', 0.04], acid: ['near', 0.045] }
// a bolt's life in frames: on, off, on (the double strobe), held, then the afterglow; a close one's
// thunder shakes the ship for the last few
const BOLT_LIFE: Record<BoltKind, number> = { sheet: 4, sheetAll: 5, far: 7, near: 10 }
const PRE_STRIKE = Math.round(2000 / FRAME_MS)
let bigSheets = { sheets: 0, first: false, pre: false }
let bolt: { age: number; kind: BoltKind; cells: BoltCell[] } | null = null
// A forked bolt down `rows` rows from column x0: on each row a corner, a run sideways and a corner down into
// the next row; the last row ends in a short downstroke. A branch drops off the first run. far: thin
// lines. endX: the column the bolt comes down on (the strike's ship).
function boltShape(x0: number, rows: number, seed: number, far: boolean, endX?: number): BoltCell[] {
  const r = seeded(seed)
  const G = far ? { run: '─', down: '│', dR: '└', dL: '┘', tR: '┐', tL: '┌' } : { run: '━', down: '┃', dR: '┗', dL: '┛', tR: '┓', tL: '┏' }
  const cells: BoltCell[] = []
  let x = x0
  let dir = r() < 0.5 ? -1 : 1
  for (let y = 0; y < rows; y++) {
    if (y === rows - 1) {
      cells.push([x, y, G.down])
      break
    }
    let L = 2 + Math.floor(r() * 3)
    if (endX !== undefined && y === rows - 2) {
      dir = endX >= x ? 1 : -1
      L = Math.abs(endX - x)
    }
    if (L === 0) {
      cells.push([x, y, G.down])
      continue
    }
    cells.push([x, y, dir > 0 ? G.dR : G.dL])
    for (let k = 1; k < L; k++) cells.push([x + dir * k, y, G.run])
    if (y === 0 && !far && rows > 2) cells.push([x + dir * Math.max(1, L - 2), y + 1, dir > 0 ? '╱' : '╲'])
    x += dir * L
    cells.push([x, y, dir > 0 ? G.tR : G.tL])
    if (r() < 0.65) dir = -dir
  }
  return cells
}
// One frame of the storm (from the frame clock): ages the bolt, or maybe starts one. left: frames left of
// the rain on screen (tide full), for the whole-band flashes at the end of gale (if none yet) and before
// the strike (glints).
function stormTick(left = Infinity): void {
  if (!tide || band !== 'rain') bigSheets = { sheets: 0, first: false, pre: false }
  else if (variants.rain === 'glints' && !bigSheets.pre && left <= PRE_STRIKE && left > PRE_STRIKE - 6) {
    bigSheets.pre = true
    bolt = { age: 0, kind: 'sheetAll', cells: [] }
    return
  } else if (variants.rain === 'gale' && !bigSheets.first && left <= PRE_STRIKE && !bolt) {
    bigSheets.first = true
    bolt = { age: 0, kind: 'sheetAll', cells: [] }
    return
  }
  if (bolt) {
    if (++bolt.age >= BOLT_LIFE[bolt.kind]) bolt = null
    return
  }
  if (!tide || band !== 'rain') return
  const st = STORM[variants.rain]
  if (!st || Math.random() >= st[1]) return
  const W = Math.max(10, bandCols)
  // the cloud row flashes once or twice before the first whole-band flash
  if (st[0] === 'sheet') bigSheets.sheets++
  const kind: BoltKind = st[0] === 'sheet' && !bigSheets.first && bigSheets.sheets > 1 + (bigSheets.sheets === 2 ? Math.round(Math.random()) : 1) ? 'sheetAll' : st[0]
  if (kind === 'sheetAll') bigSheets.first = true
  bolt = { age: 0, kind, cells: st[0] === 'sheet' ? [] : boltShape(4 + rnd(W - 8), st[0] === 'far' ? 2 : 3, rnd(1e6), st[0] === 'far') }
}
function drawLightning(e: Effect): void {
  if (!bolt) return
  const a = bolt.age
  if (bolt.kind === 'sheetAll') {
    // every row lights up like the cloud row, on, off, on, then fading twice (the ship is drawn after)
    if (a === 1) return
    const glow = a === 3 ? 0.45 : a === 4 ? 0.2 : 1
    for (let y = 0; y < e.h; y++) for (let x = 0; x < e.w; x++) put(e, x, y, cp('▀'), mixRgb(0x101828, 0x9aa8d8, glow * (0.75 + 0.25 * Math.sin(x * 0.4 + y)) * (1 - 0.12 * y)))
    return
  }
  if (bolt.kind === 'sheet') {
    // inside the clouds: the whole top row lights up pale (▀, the cloud lit from within), on, off, on, then
    // fading; the rain under it catches a little of the light
    if (a === 1) return
    const glow = a === 3 ? 0.35 : 1
    for (let x = 0; x < e.w; x++) put(e, x, 0, cp('▀'), mixRgb(0x101828, 0x9aa8d8, glow * (0.75 + 0.25 * Math.sin(x * 0.4))))
    for (let i = e.w; i < e.codes.length; i++) if (e.codes[i] !== 0x20) e.fgs[i] = mixRgb(e.fgs[i]!, 0xffffff, 0.3 * glow)
    return
  }
  if (a === 1 || a >= 7) return
  const far = bolt.kind === 'far'
  const at = (x: number, y: number) => y * e.w + x
  // on the strobe frames the whole sky lights up (a close bolt fills the empty sky with pale light)
  if (a === 0 || a === 2) {
    for (let i = 0; i < e.codes.length; i++) {
      if (e.codes[i] === 0x20) {
        if (!far) {
          e.codes[i] = cp('░')
          e.fgs[i] = 0x8a96c8
        }
      } else e.fgs[i] = mixRgb(e.fgs[i]!, 0xffffff, far ? 0.35 : 0.6)
    }
  }
  // yellow while it strikes, then the afterglow: amber, orange, dark
  const colour = a <= 3 ? (far ? 0xd8c870 : 0xffe040) : [0xffb020, 0xb06010, 0x502008][a - 4]!
  const mine = new Set(bolt.cells.map(([x, y]) => at(x, y)))
  if (!far && a <= 4) {
    // blue-violet glow above and below the bolt
    for (const [x, y] of bolt.cells) {
      for (const dy of [-1, 1]) {
        const yy = y + dy
        if (yy < 0 || yy >= e.h || x < 0 || x >= e.w || mine.has(at(x, yy))) continue
        const i = at(x, yy)
        if (e.codes[i] === 0x20 || e.codes[i] === cp('░')) put(e, x, yy, cp('·'), 0x6a5cff)
        else e.fgs[i] = mixRgb(e.fgs[i]!, 0x8a7cff, 0.6)
      }
    }
  }
  for (const [x, y, g] of bolt.cells) if (x >= 0 && x < e.w && y < e.h) put(e, x, y, cp(g), colour)
}
// Power through warp: the exhaust's length and heat for each variant. hyper and burst burn blue.
const SHIP_EXHAUST: Record<string, number> = { speedlines: 2, dense: 2, twin: 3, gold: 4, neon: 5, hyper: 8, jump: 8, burst: 10 }
const SHIP_HEAT: Record<string, number> = { speedlines: 0, dense: 0, twin: 1, gold: 1, neon: 2, hyper: 3, jump: 3, burst: 3 }
// tide full: the exhaust leads the speed. In a warp's last SHIP_LEAD frames the flame grows to the next
// warp's length and heat, then the zoom brings the faster stars. Before hyper, neon's last AFTERBURN
// frames are the afterburner instead.
const SHIP_LEAD = Math.round(1500 / FRAME_MS)
// the cruise after the jump (the space chapters and the storm): two ≈, orange
const SHIP_CRUISE = 2
const AFTERBURN = Math.round(1800 / FRAME_MS)
let shipF = 0
// The ship moves forward and back with what is happening (up to 4 columns either side of its spot):
// pressed back as the flame builds before a speed-up, surging forward as it comes, held forward at top
// speed, lunging into the jump, braking out of it, floating in the cruise, drawn towards the planet.
// shipTarget() is where it wants to be; the frame clock eases shipDx towards it, at most SHIP_EASE a
// frame.
const SHIP_EASE = 0.6
// the warps the ship surges into (pressed back as the flame builds before them)
const SHIP_SURGES = ['dense', 'twin']
let shipDx = 0
const easeT = (t: number): number => {
  const c = Math.max(0, Math.min(1, t))
  return c * c * (3 - 2 * c)
}
function shipTarget(site: Site, w: number): number {
  const fx = site.fade?.target ?? site.effect
  const age = fx.age ?? 0
  if (band === 'warp') {
    const v = variants.warp
    const left = variantFrames('warp', v, fx.w) - age
    const next = tide && tideFull ? tideLeft[0] : undefined
    // the jump (hyper is done): drops back as the lines stretch, then lunges into the white
    if (v === 'jump') {
      const q = age / JUMP_FRAMES
      return q < 0.55 ? 4 - 5 * easeT(q / 0.55) : -1 + 5 * easeT((q - 0.55) / 0.3)
    }
    // once the flame turns blue (neon's afterburner) the ship only pushes forward until hyper is over
    if (next === 'hyper' && left <= AFTERBURN) return 3 * easeT(1 - left / AFTERBURN)
    // hyper: still gaining, creeping from +3 to +4 over its whole time, no pull-back before the jump
    if (v === 'hyper') return 3 + easeT(age / variantFrames('warp', v, fx.w))
    // only the first speed-ups move the ship (fewer jumps): before dense and twin the flame builds and it is
    // pressed back, then it surges; gold and neon it holds steady until the afterburner pushes it on
    if (next && SHIP_SURGES.includes(next) && left <= SHIP_LEAD) return -easeT(1 - left / SHIP_LEAD)
    if (!SHIP_SURGES.includes(v) && v !== 'speedlines') return 0
    // the speed-up has come: a surge that settles
    const settle = 1 - easeT(age / 18)
    // the launch: a kick off the line
    if (v === 'speedlines') return 2 * Math.sin(Math.PI * Math.min(1, age / 22))
    // aims past +2 so the eased ship reaches about +2 before it settles
    return 3 * settle
  }
  // out of hyperspace: braking from the lunge back to the cruise spot
  if (site.fade?.kind === 'dropout') return 4 * (1 - easeT(site.fade.frame / site.fade.frames))
  // diving into the clouds
  if (site.fade?.kind === 'dive') return 2 + site.fade.frame / site.fade.frames
  const float = Math.sin((shipF * 2 * Math.PI) / 66)
  // the comet's wake as it passes underneath
  if (band === 'comet') return Math.abs((fx.pos ?? -999) - shipX(w)) < 8 ? -1 : float
  // drawn towards the planet as it rises
  if (band === 'planet') return 2 * easeT((fx.pos ?? 0) / 55)
  if (band === 'rain') {
    // out of the clouds, easing back to its spot; fighting the wind at the storm's peak
    if (variants.rain === 'drizzle' && age < 22) return 3 * (1 - easeT(age / 22))
    return variants.rain === 'neon' ? float : 0
  }
  // the cruise: floating
  return float
}
// One frame of easing the ship towards where it wants to be.
function shipEase(site: Site, w: number): void {
  const t = shipTarget(site, w)
  shipDx += Math.max(-SHIP_EASE, Math.min(SHIP_EASE, t - shipDx))
}
// The ship's exhaust length and flame for the band on screen.
function shipFlame(site: Site, w: number): [number, Flame] {
  const fx = site.fade?.target ?? site.effect
  if (band === 'warp') {
    const v = variants.warp
    let len = SHIP_EXHAUST[v] ?? 2
    const heat = SHIP_HEAT[v] ?? 0
    const fl: Flame = heat >= 3 ? { heat: 2, blue: 1, steady: true, diamonds: v === 'hyper' ? 0.3 : 0, tight: v === 'burst' } : { heat }
    const next = tide && tideFull ? tideLeft[0] : undefined
    const left = variantFrames('warp', v, fx.w) - (fx.age ?? 0)
    if (next === 'hyper' && left <= AFTERBURN) {
      // the afterburner: a white flash at the nozzle, the flame shoots out to about twice neon's length,
      // blue sweeps back from the nozzle pushing the orange off the end, shock diamonds pulse along it,
      // then it settles at hyper's length
      const q = Math.max(0, 1 - left / AFTERBURN)
      const peak = SHIP_EXHAUST.hyper! * 1.4
      len = q < 0.3 ? len + (peak - len) * (q / 0.3) : q < 0.7 ? peak : peak + (SHIP_EXHAUST.hyper! - peak) * ((q - 0.7) / 0.3)
      fl.heat = 2
      fl.flash = q < 0.25 ? 1 - q / 0.25 : 0
      fl.blue = Math.max(0, Math.min(1, (q - 0.15) / 0.55))
      fl.diamonds = q > 0.35 ? 0.5 + 0.5 * Math.sin(shipF * 1.3) : 0
    } else if (next && left <= SHIP_LEAD) {
      const q = Math.max(0, 1 - left / SHIP_LEAD)
      len += ((SHIP_EXHAUST[next] ?? len) - len) * q
      if (heat < 3) fl.heat = heat + ((SHIP_HEAT[next] ?? heat) - heat) * q
    }
    // the jump: in burst the jet flares white to the left edge with each burst
    // the jump: the jet stretches white towards the left edge with the stars
    if (v === 'jump') {
      const q = Math.min(1, (fx.age ?? 0) / JUMP_FRAMES)
      len = 8 + Math.max(0, shipX(w) - 12) * q * q
      // white-hot at the nozzle, but only its first half: the back half stays blue
      fl.flash = Math.min(0.5, q)
      // a dark silhouette against the white bloom
      fl.silhouette = Math.max(0, Math.min(1, ((fx.age ?? 0) - JUMP_BLOOM_AT) / JUMP_BLOOM))
    }
    if (v === 'burst' && (fx.pos ?? 0) % 18 < 3) {
      len = Math.max(len, shipX(w) - 4)
      fl.flash = 0.5
    }
    return [len, fl]
  }
  // the frame between the jump and the drop-out (the band has changed, the fade is built on the next render)
  if (site.name.startsWith('warp') && !site.fade) return [Math.max(8, shipX(w) - 4), { heat: 2, blue: 1, tight: true, steady: true, silhouette: variants.warp === 'jump' ? 1 : 0 }]
  // out of hyperspace: the jet shrinks and cools back from blue to orange
  if (site.fade?.kind === 'dropout') {
    const q = site.fade.frame / site.fade.frames
    const from = Math.max(8, shipX(w) - 4)
    // the silhouette takes its colours back as the white fades
    return [from + (SHIP_CRUISE - from) * Math.min(1, q * 1.5), { heat: 2 * (1 - q), blue: 1 - q, tight: q < 0.5, steady: q < 0.5, silhouette: 1 - Math.min(1, q / DROP_WHITE) }]
  }
  // the storm: whipped back in gale
  if (band === 'rain') return [variants.rain === 'gale' ? 3 : SHIP_CRUISE, {}]
  // the comet streaking past underneath: the exhaust flares as the head goes by
  if (band === 'comet' && Math.abs((fx.pos ?? -999) - shipX(w)) < 5) return [4, {}]
  return [SHIP_CRUISE, {}]
}
// Draws the ship over a band in tide's space chapters and the storm, except while the maze is still building it and in
// the strike (both draw their own); after the strike it is gone.
function shipOverlay(site: Site): void {
  if (!tide || !SHIP_BANDS.includes(band) || site.fade?.kind === 'burnout' || site.fade?.kind === 'eat' || site.fade?.kind === 'strike') return
  // after the strike the ship is gone
  if (band === 'rain' && variants.rain === 'ember') return
  const e = site.effect
  if (e.h < 3) return
  const [exhaust, flame] = shipFlame(site, e.w)
  if (band === 'rain') drawLightning(e)
  // gale buffets the ship a column either way
  // gale buffets the ship a column either way; a close bolt's thunder shakes it a few frames after the strike
  const thunder = band === 'rain' && bolt?.kind === 'near' && bolt.age >= 6 ? (bolt.age % 2 ? 1 : -1) : 0
  const buffet = (band === 'rain' && variants.rain === 'gale' && shipF % 8 < 3 ? (shipF % 16 < 8 ? 1 : -1) : 0) + thunder
  const dx = Math.round(shipDx)
  drawShip((x, y, code, fg) => put(e, x, y, code, fg), shipX(e.w) + dx + buffet, Math.floor(e.h / 2), shipF, exhaust, 99, flame)
}
const RAIN_FADES: FadeKind[] = ['wind', 'melt', 'ink']
const BETWEEN: Record<string, FadeKind> = {
  'scanner>eq': 'split', 'eq>aurora': 'decode', 'aurora>warp': 'burnout', 'warp>stars': 'fireworks',
  'stars>rain': 'fall', 'warp>nebula': 'dropout', 'nebula>constellations': 'condense', 'constellations>stars': 'drift',
  'stars>comet': 'flare', 'planet>rain': 'dive', 'rain>trippy': 'flood', 'trippy>glitch': 'corrupt', 'glitch>reboot': 'crash', 'reboot>scanner': 'cut',
}
type Fade = Effect & { target: Effect; frame: number; frames: number; kind: FadeKind }
function fadeKind(fromName: string, toName: string): FadeKind {
  const a = fromName.split(':')[0] ?? ''
  const [b = '', v = ''] = toName.split(':')
  // the POST starts and ends on an empty band (its rain has ended), so no transition either way
  if (a === 'post' || b === 'post') return 'cut'
  if (a !== b) return BETWEEN[`${a}>${b}`] ?? 'dissolve'
  if (a === 'eq') return 'dip'
  // the storm's end: the bolt that destroys the ship
  if (a === 'rain' && v === 'ember' && tide) return 'strike'
  if (a === 'warp') return 'zoom'
  // rain takes turns: wind, melt, ink, wind…
  if (a === 'rain') return RAIN_FADES[Math.max(0, (TIDE_ORDER.rain ?? []).indexOf(v) - 1) % RAIN_FADES.length]!
  return 'dissolve'
}
// Bar glyphs from low to high, for the eq dip.
const LADDERS = [EQ_LV, Array.from('░▒▓█'), EQ_BR, EQ_DB].map(l => l.map(cp))
// the aurora's own ladder (░▒▓█), for the burnout: █ in EQ_LV would otherwise turn it into eq bars
const SHADES = Array.from('░▒▓█').map(cp)
function dimShade(code: number, frac: number): number {
  const i = SHADES.indexOf(code)
  return i < 0 ? code : SHADES[Math.min(i, Math.round(frac * (SHADES.length - 1)))]!
}
function clampLevel(code: number, frac: number): number {
  for (const l of LADDERS) {
    const i = l.indexOf(code)
    if (i >= 0) return l[Math.min(i, Math.round(frac * (l.length - 1)))]!
  }
  return code
}
const CRASH_GLYPHS = Array.from('░▒▓█▌▐▀▄').map(cp)
const CRASH_COLOURS = [51, 201, 231, 46, 196].map(x256)
const DECODE_GLYPHS =Array.from('01ｱｲｳｴｵｶｷ#%&*+=<>').map(cp)
function makeFade(from: Effect, to: Effect, kind: FadeKind = 'dissolve'): Fade {
  const w = to.w
  // burnout stays at the old band's 1 row; its target is the 3-row eat, which the band grows to
  const h = kind === 'burnout' ? from.h : Math.max(from.h, to.h)
  const e = blank(w, h)
  const len = FADE_LEN[kind]
  const frames = typeof len === 'number' ? len : len(w)
  const mid = (w - 1) / 2
  const seeds = kind === 'ink' ? Array.from({ length: Math.max(3, Math.round(w / 14)) }, () => [Math.random() * w, Math.random() * h] as const) : []
  const spread = w / Math.max(1, seeds.length)
  // when each cell switches (0..1), for the kinds that switch cell by cell
  const at = Float32Array.from({ length: w * h }, (_, k) => {
    const x = k % w
    const y = Math.floor(k / w)
    const r = Math.random()
    if (kind === 'mid') return 0.9 * (Math.abs(x - mid) / Math.max(1, w / 2)) + 0.1 * r
    if (kind === 'ink') return Math.min(1, 0.85 * (Math.min(...seeds.map(([sx, sy]) => Math.hypot(x - sx, (y - sy) * 3))) / spread) + 0.15 * r)
    if (kind === 'corrupt') return r
    return 0.65 * r + 0.35 * ((h - 1 - y) / Math.max(1, h - 1))
  })
  const drip = Float32Array.from({ length: w }, () => Math.random() * 0.6)
  // burnout: one bit for each of chomp's dot columns, left by an aurora cell up to 3 columns away
  const bits = kind === 'burnout' ? Array.from({ length: w }, (_, x) => x).filter(isDot).map(d => ({ to: d, from: Math.max(0, Math.min(w - 1, d + rnd(7) - 3)) })) : []
  const bitAt = new Int32Array(w).fill(-1)
  bits.forEach((b, j) => (bitAt[b.from] = j))
  const bitFg = Uint32Array.from(bits, b => (from.codes[b.from] !== 0x20 && from.fgs[b.from] !== DEFAULT ? from.fgs[b.from]! : 0x808080))
  const sparks = kind === 'fireworks' ? Array.from({ length: 28 }, (_, j) => ({ a: (j / 28) * Math.PI * 2 + Math.random() * 0.2, s: 0.6 + Math.random() * 0.6, c: x256(hsv(Math.random())) })) : []
  // the index of src's cell at band row y (shorter bands sit on the bottom rows), or -1 when blank or outside it
  const cellOf = (src: Effect, x: number, y: number): number => {
    const sy = y - (h - src.h)
    if (x < 0 || x >= src.w || sy < 0 || sy >= src.h) return -1
    const i = sy * src.w + x
    return src.codes[i] === 0x20 ? -1 : i
  }
  const set = (x: number, y: number, code: number, fg: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return
    e.codes[y * w + x] = code
    e.fgs[y * w + x] = fg
  }
  // draw src's cell (sx, sy) at (x, y)
  const copy = (src: Effect, sx: number, sy: number, x = sx, y = sy) => {
    const i = cellOf(src, sx, sy)
    if (i >= 0) set(x, y, src.codes[i]!, src.fgs[i]!)
  }
  const each = (f: (x: number, y: number, k: number) => void) => {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) f(x, y, y * w + x)
  }
  const paint = (p: number) => {
    switch (kind) {
      case 'dip':
        each((x, y) => {
          const src = p < 0.5 ? from : to
          const i = cellOf(src, x, y)
          if (i >= 0) set(x, y, clampLevel(src.codes[i]!, p < 0.5 ? 1 - 2 * p : 2 * p - 1), src.fgs[i]!)
        })
        return
      case 'zoom': {
        const r = p * (w / 2 + 1)
        each((x, y) => {
          if (Math.abs(x - mid) <= r) copy(to, x, y)
          const nx = Math.round(mid + (x - mid) * (1 + 3 * p))
          if (Math.abs(nx - mid) > r) copy(from, x, y, nx, y)
        })
        return
      }
      case 'wind':
        each((x, y, k) => {
          if (at[k]! < p) copy(to, x, y)
        })
        each((x, y, k) => {
          const i = cellOf(from, x, y)
          if (i < 0) return
          const dx = Math.floor(Math.max(0, p * 1.6 - at[k]! * 0.6) ** 2 * w * 1.2)
          set(x + dx, y, dx > 2 ? cp(dx > 8 ? '·' : '~') : from.codes[i]!, mixRgb(from.fgs[i]!, 0, Math.min(0.8, p)))
        })
        return
      case 'melt':
        each((x, y) => {
          const s = Math.floor(Math.max(0, Math.min(1, p * 1.7 - drip[x]!)) * (h + 1))
          if (y < s) copy(to, x, y)
          else copy(from, x, y - s, x, y)
        })
        return
      case 'decode':
        each((x, y, k) => {
          const i = cellOf(to, x, y)
          if (at[k]! < p) copy(to, x, y)
          else if (at[k]! < p + 0.35 && i >= 0) set(x, y, DECODE_GLYPHS[rnd(DECODE_GLYPHS.length)]!, to.fgs[i]!)
          else copy(from, x, y)
        })
        return
      case 'burnout': {
        const f = fade.frame
        const y = h - 1
        if (f <= BURN_FADE) {
          // the aurora (still moving) dims cell by cell and goes out; a bit stays where each bit's cell was
          const q = f / BURN_FADE
          for (let x = 0; x < w; x++) {
            const i = cellOf(from, x, y)
            const s = Math.max(0, Math.min(1, (q - at[x]! * 0.6) / 0.4))
            if (i >= 0 && s < 1) {
              set(x, y, dimShade(from.codes[i]!, 1 - s), mixRgb(from.fgs[i]!, 0, s * 0.6))
              if (bitAt[x]! >= 0) bitFg[bitAt[x]!] = from.fgs[i]!
            }
          }
          bits.forEach((b, j) => {
            if (q >= at[b.from]! * 0.6 + 0.4) set(b.from, y, cp('·'), bitFg[j]!)
          })
          return
        }
        if (f <= BURN_FADE + BURN_DRIFT) {
          // the bits drift to the dot columns and turn into chomp's dots
          const q = (f - BURN_FADE) / BURN_DRIFT
          const ease = q * q * (3 - 2 * q)
          bits.forEach((b, j) => set(Math.round(b.from + (b.to - b.from) * ease), y, cp(q < 0.8 ? '·' : '.'), mixRgb(bitFg[j]!, CHOMP_DOT, q)))
          return
        }
        // the pac-man appears at the left edge, facing the dots
        for (let x = 0; x < w; x++) if (isDot(x)) set(x, y, cp('.'), CHOMP_DOT)
        set(0, y, cp(f % 4 < 2 ? 'C' : 'O'), CHOMP_PAC)
        return
      }
      case 'eat': {
        // the maze: the pac-man eats the dots left to right with the ghosts behind, runs off the right edge
        // and comes back in from the left (the tunnel), stops a third of the way in, and the ship builds
        // round him; then the ship launches: the walls stream away to the left as streaks, the ghosts fall
        // behind and fade, and warp comes in around the ship
        const f = fade.frame
        const row = Math.floor(h / 2)
        const track = w + 4
        const sx = (P: number) => (P >= w + 2 ? P - track : P)
        const stopP = track + shipX(w)
        const runEnd = Math.ceil(stopP / EAT_COLS) + 1
        const P = Math.min(stopP, (f - 1) * EAT_COLS)
        const built = f - runEnd
        const q = Math.max(0, (f - runEnd - SHIP_ASSEMBLE) / SHIP_LAUNCH)
        if (q > 0) each((x, y, k) => {
          if (at[k]! < q) copy(to, x, y)
        })
        for (const y of [row - 1, row + 1]) {
          for (let x = 0; x < w; x++) {
            const k = y * w + x
            if (q > 0 && at[k]! < q) continue
            const dx = Math.floor(q * q * w * (0.3 + at[k]!))
            set(x - dx, y, cp(dx > 1 ? '━' : '-'), dx > 1 ? mixRgb(0xffffff, 0x606060, q) : CHOMP_WALL)
          }
        }
        if (P <= w + 1) for (let x = 0; x < w; x++) if (x > P && isDot(x)) set(x, row, cp('.'), CHOMP_DOT)
        for (const g of GHOSTS) {
          if (P - g.gap < 0) continue
          set(sx(P - g.gap) - Math.floor(q * q * w * 0.7), row, cp('ᗣ'), mixRgb(g.fg, 0, Math.min(1, q * 1.3)))
        }
        if (built <= 0) set(sx(P), row, cp(f % 4 < 2 ? 'C' : 'O'), CHOMP_PAC)
        else drawShip(set, sx(P), row, f, q > 0 ? 1 + Math.round(q) : 1, 1 + Math.floor((built * SHIP_PARTS) / SHIP_ASSEMBLE))
        return
      }
      case 'split': {
        const r = fade.frame * SPLIT_COLS
        const half = Math.floor(w / 2)
        const trail = [231, 46, 40, 34, 28, 22]
        each((x, y) => {
          // columns behind this side's head (the right beam from the middle, the left one from just left of it)
          const k = r - (x >= half ? x - half : half - 1 - x)
          if (k < 0) return
          if (k < SPLIT_TRAIL) return set(x, y, cp(MATRIX_KANA[Math.floor(seeded(fade.frame * 7 + x)() * MATRIX_KANA.length)]!), x256(trail[k]!))
          const i = cellOf(to, x, y)
          if (i < 0) return
          // calm right behind the trail, rising to full
          const cap = Math.min(1, 0.12 + (0.88 * (k - SPLIT_TRAIL)) / (SPLIT_RISE * SPLIT_COLS))
          const lv = EQ_LV.indexOf(String.fromCodePoint(to.codes[i]!))
          if (lv < 0) return copy(to, x, y)
          const capped = Math.min(lv, Math.round(cap * (EQ_LV.length - 1)))
          set(x, y, cp(EQ_LV[capped]!), x256(EQ_FIRE[capped]!))
        })
        return
      }
      case 'dropout': {
        // out of hyperspace: the old stars shrink to dots and dim (the core with them); the nebula fades in
        // after the jump the band is white: it fades down (█ ▓ ▒ ░) over the first DROP_WHITE of the change
        // with the nebula coming through it
        const show = (p - 0.25) / 0.75
        const wq = Math.min(1, p / DROP_WHITE)
        each((x, y, k) => {
          const i = cellOf(from, x, y)
          const c = i >= 0 ? from.codes[i]! : 0x20
          if (c === cp('█')) {
            if (wq < 0.75 + 0.25 * at[k]!) return set(x, y, dimShade(c, 1 - wq), mixRgb(0xffffff, 0x101820, wq))
            const j = cellOf(to, x, y)
            if (j >= 0) set(x, y, to.codes[j]!, mixRgb(0, to.fgs[j]!, Math.min(1, Math.max(0, show) * 2)))
            return
          }
          const j = cellOf(to, x, y)
          if (show > 0 && at[k]! < show && j >= 0) return set(x, y, to.codes[j]!, mixRgb(0, to.fgs[j]!, Math.min(1, (show - at[k]!) * 3)))
          if (i < 0) return
          if (c === cp('─') && p > 0.2) return
          const g = c === cp('━') || c === cp('-') ? (p < 0.2 ? c : p < 0.45 ? cp('-') : cp('·')) : c
          set(x, y, g, mixRgb(from.fgs[i]!, 0, Math.min(1, p * 1.15)))
        })
        return
      }
      case 'condense': {
        // the clouds thin out; the stars of the constellations show through first
        each((x, y, k) => {
          const j = cellOf(to, x, y)
          if (j >= 0 && to.codes[j] === cp('✦') && p > 0.25) return set(x, y, to.codes[j]!, mixRgb(0, to.fgs[j]!, Math.min(1, (p - 0.25) * 2.5)))
          if (at[k]! < p) return copy(to, x, y)
          const i = cellOf(from, x, y)
          if (i >= 0) set(x, y, dimShade(from.codes[i]!, 1 - p), mixRgb(from.fgs[i]!, 0, p * 0.8))
        })
        return
      }
      case 'drift': {
        // the lines fade fast, the stars slide left, and the starfield takes over
        const dx = Math.floor(p * p * 8)
        each((x, y) => {
          const i = cellOf(from, x, y)
          if (i < 0) return
          const line = from.codes[i] !== cp('✦')
          if (line && p > 0.5) return
          set(x - dx, y, from.codes[i]!, mixRgb(from.fgs[i]!, 0, Math.min(1, line ? p * 2 : p)))
        })
        each((x, y, k) => {
          if (at[k]! < p) copy(to, x, y)
        })
        return
      }
      case 'flare': {
        // the starfield fades out; one star ahead, where the comet will start, brightens into its head
        each((x, y, k) => {
          if (at[k]! > p) copy(from, x, y)
          else copy(to, x, y)
        })
        const hx = Math.round(to.pos ?? w * 0.85)
        const q = Math.min(1, p * 1.3)
        set(hx, h - 1, cp(q < 0.3 ? '.' : q < 0.55 ? '+' : q < 0.8 ? '*' : '✸'), mixRgb(0x506070, 0xffffff, q))
        if (q > 0.6) for (const dx of [-1, 1]) set(hx + dx, h - 1, cp('·'), mixRgb(0x203040, 0xa8e8ff, q))
        return
      }
      case 'dive': {
        // the planet grows (its zoom is set in step); cumulus banks pile up and rush past the ship; the
        // ship flies into the white; then out under storm-grey cloud into the drizzle
        const f = fade.frame
        const banks = Math.max(0, Math.min(1, (p - 0.3) / 0.35))
        const white = Math.max(0, Math.min(1, (p - 0.6) / 0.15))
        const out = Math.max(0, (p - 0.78) / 0.22)
        const scroll = f * (0.4 + 2.5 * p)
        each((x, y, k) => {
          if (out > 0) {
            if (y === 0) return set(x, y, cp(out > 0.5 ? '▀' : '▓'), mixRgb(0xd0d8e0, 0x404854, out))
            if (at[k]! < out) return copy(to, x, y)
            return set(x, y, SHADES[at[k]! > 0.7 ? 1 : 0]!, mixRgb(0xc0c8d0, 0x505864, out))
          }
          if (white > 0 && at[k]! < white) {
            // inside the cloud: white and grey, with streaks rushing past
            const streak = (Math.floor(x + scroll * 2) + y * 7) % 11 === 0
            return set(x, y, cp(streak ? '─' : at[k]! > 0.5 ? '█' : '▓'), streak ? 0x9098a8 : mixRgb(0xe8eef4, 0xffffff, at[k]!))
          }
          // cumulus banks from the bottom: white tops, grey undersides, rushing left towards the ship
          const u = x + scroll
          const n = 0.55 + 0.3 * Math.sin(u * 0.19) + 0.15 * Math.sin(u * 0.47 + y * 1.3)
          const height = banks * (h + 0.6) * n
          const up = h - 1 - y
          if (up < height) {
            const top = height - up < 1
            return set(x, y, cp(top ? (height - up < 0.5 ? '▄' : '▆') : '█'), y === h - 1 ? 0x8890a0 : top ? 0xf4f8ff : 0xd8e0e8)
          }
          copy(from, x, y)
        })
        return
      }
      case 'strike': {
        const f = fade.frame
        const row = Math.floor(h / 2)
        const cx = shipX(w)
        // the ship's parts flying apart: [glyph, dx at start, vx, vy]
        const PARTS: [string, number, number, number][] = [['╼', -4, -1.9, -0.3], ['◁', -3, -1.5, 0.35], ['◖', -2, -1.1, 0.4], ['{', -1, -0.6, -0.45], ['}', 1, 0.7, 0.4], ['◗', 2, 1.1, -0.35], ['━', 3, 1.6, 0.3], ['▶', 5, 2.2, -0.2]]
        if (f <= 3) {
          // the last moment of the storm
          each((x, y) => copy(from, x, y))
          drawShip(set, cx, row, f, 1, 99)
          return
        }
        if (f === 4) return drawShip(set, cx, row, f, 1) // the rain stops for an instant
        if (f <= 9) {
          // the last bolt, the storm's kind but bigger, with a second fork beside it, forking down onto the
          // ship: on (the sky lights up), off, on, then held while the ship glows white; the bolt yellow,
          // flickering hot
          const ship = { hull: 0xffffff }
          if (f === 6) return drawShip(set, cx, row, f, 1, 99, ship)
          const on = f === 5 || f === 7
          each((x, y) => {
            const i = cellOf(from, x, y)
            if (on) set(x, y, cp('░'), 0xb0bce8)
            else if (i >= 0) set(x, y, from.codes[i]!, mixRgb(from.fgs[i]!, 0, 0.7))
          })
          const bolts = [...boltShape(cx - 6, row + 1, 4242, false, cx), ...boltShape(cx + 9, h, 977, false)]
          if (!on) for (const [x, y] of bolts) for (const dy of [-1, 1]) set(x, y + dy, cp('·'), 0x6a5cff)
          for (const [x, y, g] of bolts) set(x, y, cp(g), f % 2 ? 0xffe040 : 0xfff4a0)
          drawShip(set, cx, row, f, 1, 99, ship)
          return
        }
        // the explosion: a fireball growing from the ship, the parts flying apart and falling, the
        // pac-man tumbling away up and out of the band; then the wreck burns into the ember
        const t = f - 10
        const q = Math.min(1, t / 16)
        const burn = Math.min(1, Math.max(0, (f - 26) / 12))
        each((x, y, k) => {
          if (burn > 0 && at[k]! < burn) return copy(to, x, y)
          const i = cellOf(from, x, y)
          if (i >= 0 && at[k]! > q * 1.3) set(x, y, from.codes[i]!, mixRgb(from.fgs[i]!, 0, 0.5 + 0.5 * q))
        })
        const r = 1 + q * 6
        for (let y = 0; y < h; y++) {
          for (let x = Math.max(0, cx - 16); x < Math.min(w, cx + 17); x++) {
            const d = Math.hypot((x - cx) / 2, y - row)
            if (d > r) continue
            const edge = r - d < 0.9
            if (!edge && q > 0.45) continue // the middle burns out first; the ring goes on
            const heat = Math.min(1, d / r + q * 0.6)
            const fg = heat < 0.3 ? mixRgb(0xffffff, 0xffd040, heat / 0.3) : heat < 0.7 ? mixRgb(0xffd040, 0xff4010, (heat - 0.3) / 0.4) : mixRgb(0xff4010, 0x401008, (heat - 0.7) / 0.3)
            set(x, y, cp(edge ? (Math.random() < 0.5 ? '*' : '+') : q < 0.25 ? '█' : '✺'), mixRgb(fg, 0, burn * 0.8))
          }
        }
        if (q < 0.2) set(cx, row, cp('✺'), 0xffffff)
        for (const [g, dx, vx, vy] of PARTS) {
          const x = Math.round(cx + dx + vx * t)
          const y = Math.min(h - 1, Math.round(row + vy * t + 0.05 * t * t))
          const landed = y === h - 1 && t > 6
          set(x, y, cp(landed ? (f % 4 < 2 ? '^' : '*') : g), landed ? (f % 3 ? 0xff8020 : 0xffd040) : mixRgb(SHIP_HULL, 0x802010, q))
        }
        // the pac-man, thrown clear: up to the top row and tumbling (C ∪ Ɔ ∩) away to the right for about
        // 3 s, fading at the end, over the burning wreck
        const py = Math.max(0, row - Math.floor(t / 4))
        const fadeOut = Math.max(0, (t - 28) / 8)
        if (fadeOut < 1) set(cx + Math.round(t * 1.1), py, cp(['C', '∪', 'Ɔ', '∩'][Math.floor(t / 3) % 4]!), mixRgb(CHOMP_PAC, 0, fadeOut))
        return
      }
      case 'crash': {
        if (p > 0.9) return
        if (p > 0.72) {
          // strobe: a frame of solid noise, then a blank one
          if (fade.frame % 2) each((x, y) => set(x, y, pick(CRASH_GLYPHS), pick(CRASH_COLOURS)))
          return
        }
        const q = p / 0.72
        for (let y = 0; y < h; y++) {
          const tear = Math.random() < q * 0.5 ? rnd(9) - 4 : 0
          for (let x = 0; x < w; x++) copy(from, x, y, x + tear, y)
          if (Math.random() < q * q * 0.35) for (let x = 0; x < w; x++) set(x, y, pick(CRASH_GLYPHS), pick(CRASH_COLOURS))
        }
        for (let n = Math.round(q * q * w * h * 0.45); n > 0; n--) set(rnd(w), rnd(h), pick(CRASH_GLYPHS), pick(CRASH_COLOURS))
        return
      }
      case 'flood': {
        const F = fade.frame
        for (let x = 0; x < w; x++) {
          // how many rows the plasma has risen in this column, with a flickering flame edge
          const edge = 0.6 + 0.35 * Math.sin(x * 0.7 + F * 0.9) + 0.25 * Math.sin(x * 0.23 - F * 0.5) + 0.2 * Math.random()
          const level = p * (h + 2) - edge
          for (let y = 0; y < h; y++) {
            const up = h - 1 - y
            if (up < level) copy(to, x, y)
            else if (up < level + 1 && p < 0.97 && Math.random() < 0.55) set(x, y, cp(pick(['✦', '*', '+', '·'])), x256(hsv(x / w + F / 30)))
            else copy(from, x, y)
          }
        }
        return
      }
      case 'fireworks': {
        if (p < 0.3) {
          const q = p / 0.3
          each((x, y, k) => {
            if (at[k]! > q) copy(from, x, y)
          })
          const ry = h - 1 - Math.floor(q * (h - 1))
          set(Math.round(mid), ry, cp('^'), 0xffd75f)
          set(Math.round(mid), ry + 1, cp('|'), 0xaf8700)
          return
        }
        const q = (p - 0.3) / 0.7
        each((x, y, k) => {
          if (at[k]! < q) copy(to, x, y)
        })
        if (q < 0.12) set(Math.round(mid), 0, cp('✺'), 0xffffff)
        const r = q * (w / 3)
        for (const s of sparks) {
          const x = Math.round(mid + Math.cos(s.a) * r * s.s)
          const y = Math.round(Math.sin(s.a) * r * s.s * 0.2 + q * q * h)
          set(x, y, cp(q < 0.5 ? '*' : q < 0.8 ? '+' : '·'), mixRgb(s.c, 0, q * 0.7))
        }
        return
      }
      case 'fall':
        each((x, y, k) => {
          const i = cellOf(to, x, y)
          const j = cellOf(from, x, y - Math.floor(p * (h + 1)))
          if (at[k]! < p && i >= 0) set(x, y, to.codes[i]!, to.fgs[i]!)
          else if (j >= 0) set(x, y, cp(p < 0.5 ? '·' : '.'), 0x87d7ff)
        })
        return
      default:
        each((x, y, k) => copy(at[k]! < p ? to : from, x, y))
    }
  }
  const fade: Fade = {
    ...e,
    kind,
    target: to,
    frame: 0,
    frames,
    step() {
      // dropping out of hyperspace, the old stars slow down: stepped every frame, then every 2nd, 3rd…
      // into the clouds, the planet grows as the ship nears it (its first 40%)
      if (kind === 'dive') (from as Effect & { zoom?: number }).zoom = Math.min(1, fade.frame / (frames * 0.4))
      if (kind !== 'dropout' || fade.frame % (1 + Math.floor((fade.frame / frames) * 4)) === 0) from.step()
      // the reboot starts its ERROR only once the crash is over; the eat starts only once the burnout is
      // over; warp's own time starts only in the eat's handover
      // the comet waits at the flared star until the flare is over
      // the drizzle starts only as the ship comes out of the clouds
      if (kind === 'eat' ? fade.frame >= frames - SHIP_LAUNCH : kind === 'dive' ? fade.frame >= frames * 0.78 : kind !== 'crash' && kind !== 'burnout' && kind !== 'flare') to.step()
      fade.frame++
      e.codes.fill(0x20)
      e.fgs.fill(DEFAULT)
      paint(fade.frame / frames)
    },
  }
  return fade
}
// The matrix rain the boot and the reboot use (makeMatrix's defaults); matrixBurst is left at 0.
let matrix: MatrixOpts = { ...MATRIX_DEFAULTS }
let matrixBurst = 0
let isWorking = false
const sites = new Map<string, Site>()

// Whether the simulation is on (tide) and where it is, kept on this machine. A new install has nothing
// saved, and the simulation is on.
async function save($: Dollar): Promise<void> {
  await $.store.set('v2.on', tide)
  await $.store.set('v2.tidePos', tidePos())
  tidePosDirty = false
}

function rasterSiteBuild(requestId: string, name: string, w: number, h: number): Effect {
  const have = sites.get(requestId)
  // A running dissolve keeps its own height (the taller of the two bands) until it finishes.
  if (have && have.name === name && have.effect.w === w && (have.effect.h === h || have.fade)) return have.effect
  const effect = MAKERS[name.split(':')[0]!]!(w, h)
  effect.step()
  if (tide && have && have.name !== name && fadeInto === name && have.effect.w === w && fadeKind(have.name, name) !== 'cut') {
    const kind = fadeKind(have.name, name)
    // burnout (1 row) hands over to eat (3 rows), which ends on the new band
    const fade = kind === 'burnout' ? makeFade(have.effect, makeFade({ ...blank(w, h), step() {} }, effect, 'eat'), kind) : makeFade(have.effect, effect, kind)
    fade.step()
    sites.set(requestId, { name, effect: fade, fade })
    return fade
  }
  sites.set(requestId, { name, effect })
  return effect
}
// The effect for a render site, noting the size it is about to be mounted at.
function rasterSite(requestId: string, name: string, w: number, h: number): Effect {
  const effect = rasterSiteBuild(requestId, name, w, h)
  const site = sites.get(requestId)
  if (site) {
    site.rows = effect.h
    site.cols = effect.w
    shipOverlay(site)
  }
  return effect
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // the simulation's session book (its version numbers); this session's id finds its own entry again
    try {
      sessionId = (await $.session.id()) || 'local'
    } catch {
      sessionId = 'local'
    }
    const storedSim = await $.store.get('v2.sim')
    if (storedSim && typeof storedSim === 'object') {
      const b = storedSim as Partial<SimBook>
      const sessions: SimBook['sessions'] = {}
      if (b.sessions && typeof b.sessions === 'object') {
        for (const [id, v] of Object.entries(b.sessions)) {
          if (v && typeof v.major === 'number' && typeof v.loops === 'number') sessions[id] = { major: v.major, loops: v.loops, at: typeof v.at === 'number' ? v.at : 0 }
        }
      }
      simBook = { count: typeof b.count === 'number' && b.count >= 0 ? Math.floor(b.count) : 0, sessions }
    }
    // on unless /neontide off was the last word; it boots, then carries on where it was
    if ((await $.store.get('v2.on')) !== false) {
      if (!tideResume(await $.store.get('v2.tidePos'), true)) tideStart(true)
      else postStart()
    }

    await $.command.register({ name: 'neontide', description: 'neontide: /neontide on|off starts or stops the simulation; /neontide alone says whether it is on', argumentHint: '[on|off]' })

    $.clock.every(FRAME_MS, () => {
      shipF++
      // the ship eases towards where it wants to be; out of its chapters it waits at its spot
      if (tide && SHIP_BANDS.includes(band)) {
        const site = [...sites.values()].find(s => s.effect.h >= 3)
        if (site) shipEase(site, site.effect.w)
      } else shipDx = 0
      {
        const rain = tide && tideFull && band === 'rain' ? [...sites.values()].find(s => s.name === bandKey()) : undefined
        const fx = rain ? (rain.fade?.target ?? rain.effect) : undefined
        stormTick(fx ? variantFrames('rain', variants.rain, fx.w) - (fx.age ?? 0) : Infinity)
      }
      for (const site of sites.values()) {
        site.effect.step()
        if (site.fade && site.fade.frame >= site.fade.frames) {
          const resized = site.fade.target.h !== site.fade.h
          site.effect = site.fade.target
          // a fade can end on another fade (burnout → eat), which then runs to its own target
          site.fade = 'target' in site.effect ? (site.effect as Fade) : undefined
          if (resized) $.ui.invalidate('ui.render')
        }
      }
      // A family band's time is up (a scanner's lap, an eq's beats…): switch on this very frame. A change
      // within the family is built here (scanner: hard cut where the beams are; aurora: colour slide;
      // others: fadeKind()); a change of category is left to rasterSite on the next render.
      if (frameTimed() && (isWorking || demoOn())) {
        const target = (s: Site) => s.fade?.target ?? s.effect
        const f = band as Family
        const due = [...sites.values()].some(s => s.name.split(':')[0] === f && (f === 'scanner' && target(s).end !== undefined ? (target(s).pos ?? 0) >= target(s).end! : (target(s).age ?? 0) >= variantFrames(f, variants[f], target(s).w, scanSplit)))
        if (due && band === 'post') {
          postDone()
          $.ui.invalidate('ui.render')
        } else if (due) {
          tideNext()
          if (band === f) {
            for (const s of sites.values()) {
              if (s.name === bandKey() || s.name.split(':')[0] !== f) continue
              const fx = target(s)
              if (f === 'scanner' || f === 'aurora') {
                const from = s.name.split(':')[1]
                // two single scanners: the new one starts on the old one's last frame (just before the wall; the old
                // one's last frame is replaced in this same tick) and ends a lap after the wall,
                // so the head never skips and the trail folds through the turn; its colours slide in from
                // the old one's over SCAN_SLIDE frames
                const slide = f === 'scanner' && from !== undefined && isScanSingle(from) && isScanSingle(variants.scanner) && !scanSplitFrom(from)
                s.effect = f === 'aurora' ? makeFamily(f, fx.w, fx.h, { start: fx.pos, from, morph: tideFull ? AURORA_JOURNEY_FRAMES : AURORA_MORPH_FRAMES }) : makeFamily(f, fx.w, fx.h, slide ? { from, morph: SCAN_SLIDE, start: fx.last ?? (fx.pos ?? 1) - 1, nominal: fx.end } : {})
                s.effect.step()
                s.fade = undefined
              } else {
                const fade = makeFade(s.effect, makeFamily(f, fx.w, fx.h), fadeKind(s.name, bandKey()))
                fade.step()
                s.effect = fade
                s.fade = fade
              }
              s.name = bandKey()
            }
          }
          $.ui.invalidate('ui.render')
        }
      }
      // The simulation's glitch is timed in frames: the corrupt fade-in (FADE_LEN.corrupt), then
      // SIM_GLITCH_MS of full glitch, then on to the reboot (the crash between them is unchanged)
      if (tide && tideFull && band === 'glitch' && (isWorking || demoOn())) {
        glitchFrames++
        if (glitchFrames >= (FADE_LEN.corrupt as number) + Math.round(SIM_GLITCH_MS / FRAME_MS)) {
          glitchFrames = 0
          tideNext()
          $.ui.invalidate('ui.render')
        }
      } else if (band !== 'glitch') glitchFrames = 0
      for (const [requestId, site] of sites) {
        // The band changed size (a fade ended on a shorter band): wait for the redraw rather than send a
        // frame the engine refuses, which used to drop the site and restart the band from its first frame.
        if (site.rows !== undefined && (site.effect.h !== site.rows || site.effect.w !== site.cols)) continue
        shipOverlay(site)
        void $.ui.blit({ requestId, key: 'fx', cells: encode(site.effect) }).then(r => {
          if (r.deny) sites.delete(requestId)
        })
      }
    })
    $.clock.every(1000, () => {
      // a second of Claude working counts towards the band's time
      if (tide && (isWorking || demoOn())) shuffleWorkedMs += 1000
      if (tidePosDirty) {
        tidePosDirty = false
        void $.store.set('v2.tidePos', tidePos())
      }
      if (simRunsDirty) {
        simRunsDirty = false
        void $.store.set('v2.sim', simBook)
      }
      if (tide && !frameTimed() && shuffleWorkedMs >= (tideFull ? bandMs(band) : band === 'glitch' ? TIDE_GLITCH_MS : SHUFFLE_MS)) {
        tideNext()
        $.ui.invalidate('ui.render')
      }
    })
    return next(e)
  })

  // /neontide on|off, and /neontide alone to see whether it is on.
  on('command.run', { command: 'neontide' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === '') return { text: tide ? `Now: ${bandLabel()}\nThe simulation is on (${postTitle()}). It plays above the prompt while Claude works; /neontide off stops it.` : 'The simulation is off. /neontide on starts it.' }
    if (arg === 'on') {
      if (tide) return { text: 'The simulation is already on.' }
      tideStart(true)
      await save($)
      $.ui.invalidate('ui.render')
      return { text: 'Simulation on: it boots the next time Claude works.' }
    }
    if (arg === 'off') {
      if (!tide) return { text: 'The simulation is already off.' }
      band = 'off'
      tide = false
      sites.clear()
      await save($)
      $.ui.invalidate('ui.render')
      return { text: 'Simulation off' }
    }
    if (arg === 'demo' && (await $.env.get('NEONTIDE_DEMO')) === '1') {
      tideStart(true)
      demo = true
      $.ui.invalidate('ui.render')
      return { text: 'Simulation demo: one round while Claude is idle.' }
    }
    return { text: 'Usage: /neontide on|off' }
  })

  on('turn.start', ($, e, next) => {
    if (e.agentId === undefined) isWorking = true
    return next(e)
  })

  on('turn.complete', ($, e, next) => {
    if (e.agentId === undefined) isWorking = false
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const p = e.props
    if (band === 'off' || (!p.isWorking && !demoOn()) || p.hasSurvey || p.isCollapsed) {
      sites.delete(e.requestId)
      return next(e)
    }
    const { Box, Raster } = $.ui.resolve(e)
    const below = await next(e)
    const cols = Math.max(1, Math.min(512, p.bodyColumns))
    bandCols = cols
    const rows = Math.max(1, Math.min(BAND_HEIGHT[band] ?? BAND_ROWS, p.maxRows - 2))
    // this session's simulation number is taken the first time it really shows (Claude working)
    // (Claude working, not the demo)
    if (tide && p.isWorking && !demoOn()) simEnter()
    const effect = rasterSite(e.requestId, bandKey(), cols, rows)
    return (
      <Box flexDirection="column">
        {below}
        <Raster key="fx" columns={cols} rows={effect.h} cells={encode(effect)} />
      </Box>
    )
  })
}
