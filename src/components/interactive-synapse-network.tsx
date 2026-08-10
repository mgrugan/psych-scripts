import React, { useRef, useEffect, type ReactNode } from 'react'

export type NetworkPhase = 'field' | 'brain'

export interface InteractiveSynapseNetworkProps {
  /** Content to render on top of the network canvas */
  children?: ReactNode
  /**
   * 'field' scatters the neurons across the viewport and lets the cursor fire
   * them. 'brain' gathers them into a slowly spinning brain. Switching between
   * the two is animated in both directions.
   */
  phase?: NetworkPhase
  /** Resting colour of a neuron soma (rgb triplet, alpha is driven by state) */
  nodeColor?: string
  /** Colour of a signal at full strength */
  pulseColor?: string
  /** Colour a signal decays toward as it travels away from the source */
  decayColor?: string
  /** How many neurons to simulate */
  nodeCount?: number
  /** Maximum distance (px) at which two neurons may form a synapse */
  connectionRadius?: number
  /** Maximum synapses grown per neuron */
  maxSynapses?: number
  /** Radius (px) around the cursor that excites a neuron */
  hoverRadius?: number
  /**
   * Change this to settle the network back to rest. Everything in flight is
   * dropped and every neuron cools off, so the view starts as quiet as it does
   * on a fresh load rather than carrying over whatever built up behind it.
   */
  settle?: number
  /** Opacity of the fading background trail (0-1) */
  trailOpacity?: number
  /** Overall opacity of the network, 0-1. Lower reads as further back. */
  intensity?: number
  /** ARIA label for assistive technologies */
  ariaLabel?: string
  /** Additional CSS classes on the wrapper */
  className?: string
}

type RGB = [number, number, number]

/** Accepts '#rrggbb', 'rgb(a)(...)' or a bare 'r,g,b' triplet. */
function toRGB(input: string, fallback: RGB): RGB {
  const hex = input.trim().match(/^#?([0-9a-f]{6})$/i)
  if (hex) {
    const n = parseInt(hex[1], 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }
  const nums = input.match(/-?\d+(\.\d+)?/g)
  if (nums && nums.length >= 3) {
    return [Number(nums[0]), Number(nums[1]), Number(nums[2])]
  }
  return fallback
}

function mix(a: RGB, b: RGB, t: number): RGB {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ]
}

function rgba(c: RGB, a: number) {
  return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`
}

const easeInOut = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2

/** Evenly spread point on a unit sphere, by golden angle spiral. */
function spherePoint(i: number, n: number): [number, number, number] {
  const uy = 1 - 2 * ((i + 0.5) / n)
  const r = Math.sqrt(Math.max(0, 1 - uy * uy))
  const theta = i * 2.399963229728653
  return [r * Math.cos(theta), uy, r * Math.sin(theta)]
}

/**
 * A point on a brain-shaped shell, returned as position followed by the centre
 * of the lobe it belongs to. The centre gives the outward normal, which is what
 * lets the far side of the volume be culled so the thing reads as a solid
 * surface rather than a cloud you can see straight through.
 *
 * Built as four parts rather than one lump, because a single ellipsoid reads as
 * an egg from every angle. What makes a side view legible as a brain is the
 * temporal lobe: a smaller lobe slung low and forward beneath the cerebrum,
 * leaving a notch between the two. The cerebellum sits under the back and the
 * stem drops away below it.
 */
type BrainPoint = [number, number, number, number, number, number]

function brainPoint(i: number, n: number): BrainPoint {
  const nCerebrum = Math.round(n * 0.54)
  const nTemporal = Math.round(n * 0.2)
  const nCerebellum = Math.round(n * 0.17)
  const nStem = Math.max(1, n - nCerebrum - nTemporal - nCerebellum)

  // ---- temporal lobes: the shape that makes the profile read as a brain ----
  if (i >= nCerebrum && i < nCerebrum + nTemporal) {
    const k = i - nCerebrum
    const perSide = Math.max(1, Math.round(nTemporal / 2))
    const side = k < perSide ? 1 : -1
    const [sx, sy, sz] = spherePoint(k % perSide, perSide)
    const cx = side * 0.34
    const cy = -0.34
    const cz = 0.1
    return [cx + side * sx * 0.14, cy + sy * 0.17, cz + sz * 0.52, cx, cy, cz]
  }

  // ---- cerebellum: under the back, in two small halves ----
  if (i >= nCerebrum + nTemporal && i < nCerebrum + nTemporal + nCerebellum) {
    const k = i - nCerebrum - nTemporal
    const [sx, sy, sz] = spherePoint(k, nCerebellum)
    const side = sx >= 0 ? 1 : -1
    const cx = side * 0.05
    const cy = -0.44
    const cz = -0.76
    // fine horizontal banding, the foliation that tells it apart from the bulk
    const band = 0.022 * Math.sin(sy * 34)
    return [cx + sx * (0.34 + band), cy + sy * 0.17, cz + sz * (0.24 + band), cx, cy, cz]
  }

  // ---- brain stem: a short column dropping away below the back ----
  if (i >= nCerebrum + nTemporal + nCerebellum) {
    const k = i - nCerebrum - nTemporal - nCerebellum
    const t = (k + 0.5) / nStem
    const ring = k * 2.399963229728653
    const rad = 0.085 * (1 - t * 0.35)
    const cy = -0.34 - t * 0.5
    const cz = -0.3 + t * 0.06
    return [Math.cos(ring) * rad, cy, cz + Math.sin(ring) * rad, 0, cy, cz]
  }

  // ---- cerebrum: the bulk above everything else ----
  let [ux, uy, uz] = spherePoint(i, nCerebrum)

  ux *= 0.62
  uy *= 0.56
  uz *= 1.0

  // taper the frontal and occipital poles
  const taper = 1 - 0.22 * uz * uz
  ux *= taper
  uy *= taper

  // Squeeze the underside in as well as flatten it, so the temporal lobes are
  // left standing proud of it rather than buried inside.
  if (uy < 0) {
    uy *= 0.72
    ux *= 0.82
  }

  // sits above the lobes slung beneath it
  uy += 0.16

  // The longitudinal fissure parts the hemispheres along the top only, so the
  // underside stays closed instead of notching into a heart.
  const side = ux >= 0 ? 1 : -1
  const fissure = Math.max(0, Math.min(1, (uy + 0.02) / 0.5))
  ux += side * 0.085 * fissure

  // The lateral fissure, the deep groove that separates the temporal lobe from
  // everything above it. It is the most legible landmark on a brain seen from
  // the side, so it is cut in rather than left to the ripple.
  const sylvian = Math.exp(-Math.pow((uy - 0.01) / 0.085, 2))
  ux *= 1 - 0.15 * sylvian
  uy -= 0.025 * sylvian

  // gyri: deeper and finer than a gentle wobble, so the surface reads as folded
  const ripple =
    0.055 * Math.sin(ux * 17) * Math.cos(uz * 13) +
    0.04 * Math.sin(uy * 19 + uz * 5) +
    0.025 * Math.cos(ux * 24 + uy * 9)
  const len = Math.hypot(ux, uy - 0.16, uz) || 1
  ux += (ux / len) * ripple
  uy += ((uy - 0.16) / len) * ripple
  uz += (uz / len) * ripple

  return [ux, uy, uz, 0, 0.16, 0]
}

const InteractiveSynapseNetwork: React.FC<InteractiveSynapseNetworkProps> = ({
  children,
  phase = 'field',
  settle = 0,
  nodeColor = '#ffffff',
  pulseColor = '#ffe08a',
  decayColor = '#ff3b2e',
  nodeCount = 130,
  connectionRadius = 190,
  maxSynapses = 4,
  hoverRadius = 130,
  trailOpacity = 0.24,
  intensity = 0.7,
  ariaLabel = 'Interactive neuron network',
  className = '',
}) => {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const mouseRef = useRef({ x: -9999, y: -9999, active: false })
  const phaseRef = useRef<NetworkPhase>(phase)
  const settleRef = useRef(settle)
  const rafRef = useRef<number | null>(null)

  // Phase changes must not tear down the simulation, so it is read from a ref.
  useEffect(() => {
    phaseRef.current = phase
  }, [phase])

  useEffect(() => {
    settleRef.current = settle
  }, [settle])

  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return
    const ctx = canvas.getContext('2d')!
    if (!ctx) return

    const REST: RGB = toRGB(nodeColor, [255, 255, 255])
    const HOT: RGB = toRGB(pulseColor, [255, 224, 138])
    const COOL: RGB = toRGB(decayColor, [255, 59, 46])

    const calm =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    let width = wrap.clientWidth || 1
    let height = wrap.clientHeight || 1
    let dpr = Math.min(window.devicePixelRatio || 1, 2)

    /** 0 = scattered field, 1 = fully gathered brain. */
    let morph = 0
    /** eased morph, what the drawing actually uses */
    let shown = 0
    let spin = 0
    // Recomputed once a frame rather than once per neuron, which matters now
    // that the shell runs to well over a thousand points.
    let spinCos = 1
    let spinSin = 0
    let brainScale = 1
    // The cursor becomes a light source once the neurons gather, so moving it
    // sweeps across the surface instead of firing anything.
    let lightX = 0
    let lightY = 0
    const LIGHT_RADIUS = 460
    /** The brain sits above centre so the quote beneath it stays clear. */
    const BRAIN_CENTER_Y = 0.35

    /**
     * The pool of light is baked once into its own bitmap and then stamped each
     * frame. Evaluating a radial gradient across a few million pixels every
     * frame was costing about a third of the frame budget on its own.
     */
    let lightSprite: HTMLCanvasElement | null = null
    const buildLightSprite = () => {
      const px = Math.round(LIGHT_RADIUS * 2 * dpr)
      const c = document.createElement('canvas')
      c.width = px
      c.height = px
      const g2 = c.getContext('2d')
      if (!g2) return
      const r = px / 2
      const grad = g2.createRadialGradient(r, r, 0, r, r, r)
      grad.addColorStop(0, 'rgba(255,236,198,0.5)')
      grad.addColorStop(0.4, 'rgba(255,214,150,0.17)')
      grad.addColorStop(1, 'rgba(255,214,150,0)')
      g2.fillStyle = grad
      g2.fillRect(0, 0, px, px)
      lightSprite = c
    }
    const TILT_COS = Math.cos(0.32)
    const TILT_SIN = Math.sin(0.32)

    /**
     * Signal colour: yellow at the source, sliding to red as the pulse loses
     * energy further out in the network.
     */
    const heat = (energy: number): RGB => {
      const t = Math.max(0, Math.min(1, energy))
      return mix(COOL, HOT, Math.pow(t, 0.62))
    }

    interface Dendrite {
      angle: number
      len: number
      bend: number
      sway: number
    }

    class Neuron {
      /** free-roaming position in the scattered field */
      x: number
      y: number
      vx: number
      vy: number
      /** position on the brain shell, before rotation */
      bx = 0
      by = 0
      bz = 0
      /** outward surface normal at that position, before rotation */
      nx = 0
      ny = 0
      nz = 0
      /** 1 when the surface points straight at the viewer, 0 when edge on */
      facing = 1
      /** that same normal in screen space, for shading against the cursor */
      snx = 0
      sny = 0
      /** where this neuron is actually drawn this frame */
      px = 0
      py = 0
      /** depth after rotation, drives how solid it looks */
      depth = 1
      r: number
      squash: number
      tilt: number
      dendrites: Dendrite[] = []
      edges2d: number[] = []
      edges3d: number[] = []
      excite = 0
      flash = 0
      refractory = 0
      phase: number
      t = 0
      /**
       * Shell neurons exist only to give the gathered brain a surface dense
       * enough to read. They never join the scattered field, so the field keeps
       * exactly the density it had.
       */
      shell = false

      constructor() {
        this.x = Math.random() * width
        this.y = Math.random() * height
        const drift = calm ? 0 : 0.16
        this.vx = (Math.random() - 0.5) * drift
        this.vy = (Math.random() - 0.5) * drift
        this.r = Math.random() * 0.8 + 0.65
        this.squash = 0.62 + Math.random() * 0.3
        this.tilt = Math.random() * Math.PI
        this.phase = Math.random() * Math.PI * 2
        this.px = this.x
        this.py = this.y

        const spines = 3 + Math.floor(Math.random() * 4)
        for (let i = 0; i < spines; i++) {
          this.dendrites.push({
            angle: (i / spines) * Math.PI * 2 + Math.random() * 0.9,
            len: 6 + Math.random() * 13,
            bend: (Math.random() - 0.5) * 0.9,
            sway: Math.random() * Math.PI * 2,
          })
        }
      }

      update(t: number) {
        // Gathered up, the field position is parked so the neurons come back to
        // where they left rather than somewhere else entirely. Shell neurons
        // have no field position to keep.
        const loose = this.shell ? 0 : 1 - morph
        this.x += this.vx * loose
        this.y += this.vy * loose
        if (this.x < 4 || this.x > width - 4) this.vx *= -1
        if (this.y < 4 || this.y > height - 4) this.vy *= -1
        this.x = Math.max(4, Math.min(width - 4, this.x))
        this.y = Math.max(4, Math.min(height - 4, this.y))

        // Rotate the brain position and project it, then blend the two layouts.
        const rx = this.bx * spinCos + this.bz * spinSin
        let rz = -this.bx * spinSin + this.bz * spinCos

        // a slight tilt so the brain is seen from just above, not edge on
        const ry = this.by * TILT_COS - rz * TILT_SIN
        rz = this.by * TILT_SIN + rz * TILT_COS

        // The normal goes through the same rotation. Nearer is more negative in
        // z, so a surface faces the viewer when its turned normal does too.
        const mx = this.nx * spinCos + this.nz * spinSin
        const mz = -this.nx * spinSin + this.nz * spinCos
        const my = this.ny * TILT_COS - mz * TILT_SIN
        this.facing = -(this.ny * TILT_SIN + mz * TILT_COS)
        // screen space, where y runs the other way
        this.snx = mx
        this.sny = -my

        const persp = 3.1 / (3.1 + rz)
        const bpx = width / 2 + rx * brainScale * persp
        // The shell is built with y pointing up; the canvas has it pointing
        // down, so it is flipped here. Without this the brain hangs upside
        // down and the lobes meant to tuck underneath float above the bulk.
        const bpy = height * BRAIN_CENTER_Y - ry * brainScale * persp

        this.depth = persp

        if (this.shell) {
          this.px = bpx
          this.py = bpy
          this.flash *= 0.9
          if (this.flash < 0.001) this.flash = 0
          this.t = t
          return
        }

        this.px = this.x + (bpx - this.x) * morph
        this.py = this.y + (bpy - this.y) * morph

        const m = mouseRef.current
        let target = 0
        if (m.active && loose > 0.05) {
          // Packed into the brain nearly every neuron would sit inside the
          // cursor radius at once, so the hover only bites in the open field.
          const d = Math.hypot(this.px - m.x, this.py - m.y)
          target = Math.max(0, 1 - d / hoverRadius) * loose
        }
        this.excite += (target - this.excite) * 0.16

        if (this.refractory > 0) this.refractory--

        // Hovering the neuron is what fires it.
        if (this.excite > 0.55 && this.refractory <= 0) {
          fire(this, 1)
        }

        this.flash *= 0.9
        if (this.flash < 0.001) this.flash = 0
        this.t = t
      }

      draw() {
        const heatT = Math.min(1, this.flash)
        const glow = Math.max(this.excite * 0.75, heatT)
        const col = heatT > 0.01 ? mix(REST, heat(heatT), Math.min(1, heatT * 1.5)) : REST

        // Gathered into the brain, depth does the work the cursor did before.
        const solid = 1 - morph + morph * (0.12 + (this.depth - 0.7) * 1.9)
        // a shell point has nothing to show until the brain forms
        const present = this.shell ? shown : 1
        if (present < 0.01) return

        // Shell points are the surface itself, so they get their own weighting
        // rather than the field's: a plain dot, bright at the front of the
        // volume and dropping away toward the back.
        const dendAlpha = (0.13 + glow * 0.62) * intensity * Math.max(0.15, solid) * present * (1 - shown)
        if (!this.shell && dendAlpha > 0.012) {
          ctx.lineWidth = 0.7
          ctx.strokeStyle = rgba(col, dendAlpha)
          for (const d of this.dendrites) {
            const wob = calm ? 0 : Math.sin(this.t * 0.0009 + d.sway) * 0.16
            const a = d.angle + wob
            // dendrites shrink as the neurons pack into the brain
            const len = d.len * (1 + glow * 0.35) * (1 - 0.6 * morph)
            const ex = this.px + Math.cos(a) * len
            const ey = this.py + Math.sin(a) * len
            const mx = this.px + Math.cos(a) * len * 0.55
            const my = this.py + Math.sin(a) * len * 0.55
            const nx = -Math.sin(a) * len * d.bend * 0.4
            const ny = Math.cos(a) * len * d.bend * 0.4
            ctx.beginPath()
            ctx.moveTo(this.px, this.py)
            ctx.quadraticCurveTo(mx + nx, my + ny, ex, ey)
            ctx.stroke()
          }
        }

        // A tight bloom rather than the wide soft ball it used to be. Wide and
        // soft reads as an orb; this reads as something charged.
        if (glow > 0.02) {
          const rad = (this.r + 0.5) * (1.8 + glow * 3.2)
          const g = ctx.createRadialGradient(this.px, this.py, 0, this.px, this.py, rad)
          g.addColorStop(0, rgba(col, 0.42 * glow * intensity * present))
          g.addColorStop(0.5, rgba(col, 0.14 * glow * intensity * present))
          g.addColorStop(1, rgba(col, 0))
          ctx.fillStyle = g
          ctx.beginPath()
          ctx.arc(this.px, this.py, rad, 0, Math.PI * 2)
          ctx.fill()
        }

        // Firing throws off a short spark, angled per neuron so the whole field
        // does not flash the same cross.
        if (heatT > 0.06) {
          const arm = (2.5 + heatT * 9) * (1 - 0.5 * morph)
          const jitter = 0.85 + Math.random() * 0.3
          ctx.lineWidth = 0.7
          ctx.strokeStyle = rgba(mix(col, [255, 255, 255], 0.5), Math.min(0.9, heatT) * intensity * present)
          ctx.beginPath()
          for (let k = 0; k < 4; k++) {
            const a2 = this.tilt + (k * Math.PI) / 2
            const len = arm * (k % 2 ? jitter : 1)
            ctx.moveTo(this.px, this.py)
            ctx.lineTo(this.px + Math.cos(a2) * len, this.py + Math.sin(a2) * len)
          }
          ctx.stroke()
        }

        const breathe = calm ? 1 : 1 + Math.sin(this.t * 0.0012 + this.phase) * 0.08
        const rr =
          this.r *
          breathe *
          (1 + heatT * 0.5) *
          (1 - 0.15 * morph) *
          (morph ? this.depth : 1) *
          (this.shell ? 0.8 : 1)
        ctx.beginPath()
        ctx.ellipse(this.px, this.py, rr * 0.85, rr * 0.85 * this.squash, this.tilt, 0, Math.PI * 2)
        ctx.fillStyle = rgba(col, (0.34 + glow * 0.66) * intensity * Math.max(0.12, solid) * present)
        ctx.fill()

        if (heatT > 0.12) {
          ctx.beginPath()
          ctx.arc(this.px, this.py, rr * 0.42, 0, Math.PI * 2)
          ctx.fillStyle = rgba([255, 255, 255], Math.min(0.95, heatT * 1.3) * intensity * present)
          ctx.fill()
        }
      }
    }

    interface Edge {
      a: Neuron
      b: Neuron
      bow: number
      heat: number
    }

    interface Spike {
      edge: Edge
      /** true when this signal is travelling the brain wiring, not the field */
      brain: boolean
      forward: boolean
      t: number
      speed: number
      energy: number
    }

    const neurons: Neuron[] = []
    /** neurons[0..fieldCount-1] are the field; the rest are surface only */
    let fieldCount = 0
    const edges: Edge[] = []
    const brainEdges: Edge[] = []
    const spikes: Spike[] = []
    const MAX_SPIKES = 340

    const control = (e: Edge) => {
      const dx = e.b.px - e.a.px
      const dy = e.b.py - e.a.py
      const mx = (e.a.px + e.b.px) / 2
      const my = (e.a.py + e.b.py) / 2
      return { cx: mx - dy * e.bow, cy: my + dx * e.bow }
    }

    const pointOn = (e: Edge, t: number) => {
      const { cx, cy } = control(e)
      const u = 1 - t
      return {
        x: u * u * e.a.px + 2 * u * t * cx + t * t * e.b.px,
        y: u * u * e.a.py + 2 * u * t * cy + t * t * e.b.py,
      }
    }

    function fire(n: Neuron, energy: number) {
      n.flash = Math.max(n.flash, energy)
      n.refractory = 48 + Math.floor(Math.random() * 34)
      if (energy < 0.16) return

      // Part way through a morph the two layouts disagree about where every
      // neuron is, so a signal launched now would be dragged across the screen
      // as the endpoints move. Flash, but send nothing.
      if (morph > 0.05 && morph < 0.95) return

      // Signals travel whichever wiring is currently on screen.
      const useBrain = morph > 0.5
      const list = useBrain ? n.edges3d : n.edges2d
      const pool = useBrain ? brainEdges : edges

      for (const ei of list) {
        if (spikes.length >= MAX_SPIKES) break
        if (Math.random() > 0.82) continue
        const e = pool[ei]
        if (!e) continue
        const forward = e.a === n
        const other = forward ? e.b : e.a
        if (other.refractory > 0 && Math.random() > 0.25) continue
        spikes.push({
          edge: e,
          brain: useBrain,
          forward,
          t: 0,
          speed: (0.022 + Math.random() * 0.02) * (calm ? 0.6 : 1),
          energy: energy * (0.72 + Math.random() * 0.14),
        })
      }
    }

    const build = () => {
      neurons.length = 0
      edges.length = 0
      brainEdges.length = 0
      spikes.length = 0

      const count = Math.max(
        12,
        Math.round(nodeCount * Math.min(1.35, (width * height) / (1440 * 900)))
      )
      for (let i = 0; i < count; i++) neurons.push(new Neuron())
      fieldCount = count

      // Extra points that only appear once gathered. A brain needs a far denser
      // surface than the field wants, and this keeps the two independent.
      const shellCount = Math.round(count * 14)
      for (let i = 0; i < shellCount; i++) {
        const n = new Neuron()
        n.shell = true
        neurons.push(n)
      }

      // Brain coordinates are dealt out by a stride rather than in order, so
      // the field neurons land across every region instead of piling into the
      // cerebrum and leaving the lobes to appear out of nowhere.
      const total = neurons.length
      neurons.forEach((n, i) => {
        const [bx, by, bz, cx, cy, cz] = brainPoint((i * 7919) % total, total)
        n.bx = bx
        n.by = by
        n.bz = bz
        const dx = bx - cx
        const dy = by - cy
        const dz = bz - cz
        const len = Math.hypot(dx, dy, dz) || 1
        n.nx = dx / len
        n.ny = dy / len
        n.nz = dz / len
      })

      // synapses across the scattered field, shell points excluded
      const seen = new Set<string>()
      neurons.forEach((n, i) => {
        if (n.shell) return
        const near = neurons
          .map((o, j) => ({ o, j, d: Math.hypot(n.x - o.x, n.y - o.y) }))
          .filter((c) => !c.o.shell && c.j !== i && c.d < connectionRadius)
          .sort((p, q) => p.d - q.d)
          .slice(0, maxSynapses)

        for (const c of near) {
          const key = i < c.j ? `${i}:${c.j}` : `${c.j}:${i}`
          if (seen.has(key)) continue
          seen.add(key)
          edges.push({ a: n, b: c.o, bow: (Math.random() - 0.5) * 0.22, heat: 0 })
          const idx = edges.length - 1
          n.edges2d.push(idx)
          c.o.edges2d.push(idx)
        }
      })

      // Connectome across the brain, wired between the field neurons only. The
      // shell is surface, not circuitry, and pairing all of it would turn this
      // into a quadratic search over the better part of a thousand points.
      const seen3 = new Set<string>()
      neurons.forEach((n, i) => {
        if (n.shell) return
        const near = neurons
          .map((o, j) => ({
            o,
            j,
            d: Math.hypot(n.bx - o.bx, n.by - o.by, n.bz - o.bz),
          }))
          .filter((c) => !c.o.shell && c.j !== i && c.d < 0.42)
          .sort((p, q) => p.d - q.d)
          .slice(0, 3)

        for (const c of near) {
          const key = i < c.j ? `${i}:${c.j}` : `${c.j}:${i}`
          if (seen3.has(key)) continue
          seen3.add(key)
          brainEdges.push({ a: n, b: c.o, bow: (Math.random() - 0.5) * 0.14, heat: 0 })
          const idx = brainEdges.length - 1
          n.edges3d.push(idx)
          c.o.edges3d.push(idx)
        }
      })
    }

    const resize = () => {
      const prevW = width
      const prevH = height
      width = wrap.clientWidth || 1
      height = wrap.clientHeight || 1
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      if (neurons.length === 0) {
        build()
      } else {
        const sx = width / prevW
        const sy = height / prevH
        for (const n of neurons) {
          n.x *= sx
          n.y *= sy
        }
      }
      lightSprite = null
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, width, height)
    }

    resize()

    const onPointerMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      mouseRef.current = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        active: true,
      }
    }
    const onPointerLeave = () => {
      mouseRef.current = { x: -9999, y: -9999, active: false }
    }

    window.addEventListener('pointermove', onPointerMove, { passive: true })
    window.addEventListener('pointerdown', onPointerMove, { passive: true })
    document.addEventListener('pointerleave', onPointerLeave)

    const ro = new ResizeObserver(resize)
    ro.observe(wrap)

    const drawEdges = (list: Edge[], visibility: number) => {
      if (visibility <= 0.01) return
      ctx.lineWidth = 0.6
      for (const e of list) {
        const base = Math.max(e.a.excite, e.b.excite)
        const depth = morph > 0.01 ? (e.a.depth + e.b.depth) / 2 : 1
        const a = (0.055 + base * 0.18) * intensity * visibility * Math.max(0.1, (depth - 0.74) * 1.5)
        const { cx, cy } = control(e)
        ctx.beginPath()
        ctx.moveTo(e.a.px, e.a.py)
        ctx.quadraticCurveTo(cx, cy, e.b.px, e.b.py)
        ctx.strokeStyle = rgba(REST, a)
        ctx.stroke()

        if (e.heat > 0.01) {
          ctx.lineWidth = 0.6 + e.heat * 1.5
          ctx.strokeStyle = rgba(heat(e.heat), e.heat * 0.55 * intensity * visibility)
          ctx.beginPath()
          ctx.moveTo(e.a.px, e.a.py)
          ctx.quadraticCurveTo(cx, cy, e.b.px, e.b.py)
          ctx.stroke()
          ctx.lineWidth = 0.6
          e.heat *= 0.945
        }
      }
    }

    /**
     * The surface runs to well over a thousand points, and giving each one its
     * own fill was the single most expensive thing on the frame. They are
     * bucketed by brightness instead and drawn as a handful of batched paths.
     */
    const SHELL_BUCKETS = 9
    const shellBatch: number[][] = Array.from(
      { length: SHELL_BUCKETS * 2 },
      () => [] as number[]
    )
    const WARM: RGB = mix(REST, HOT, 0.4)

    const drawShell = () => {
      const reach2 = LIGHT_RADIUS * LIGHT_RADIUS

      for (let i = fieldCount; i < neurons.length; i++) {
        const n = neurons[i]
        // the far side of the volume is dropped, which is what gives the
        // silhouette an edge instead of letting the back fill it in
        if (n.facing <= 0.02) continue

        const dx = lightX - n.px
        const dy = lightY - n.py
        const d2 = dx * dx + dy * dy
        let beam = 0
        if (d2 < reach2) {
          const dist = Math.sqrt(d2) || 1
          const diffuse = Math.max(0, (n.snx * dx + n.sny * dy) / dist)
          beam = (1 - dist / LIGHT_RADIUS) * (0.25 + diffuse * 0.75)
        }

        const alpha = Math.min(1, 0.18 + Math.sqrt(n.facing) * 0.5 + beam * 0.75) * shown
        if (alpha < 0.02) continue

        const bucket =
          (beam > 0.06 ? SHELL_BUCKETS : 0) +
          Math.min(SHELL_BUCKETS - 1, (alpha * SHELL_BUCKETS) | 0)
        const arr = shellBatch[bucket]
        arr.push(n.px, n.py, (1.0 + n.r * 0.4) * n.depth * (1 + beam * 0.5))
      }

      for (let k = 0; k < shellBatch.length; k++) {
        const arr = shellBatch[k]
        if (arr.length === 0) continue
        const warm = k >= SHELL_BUCKETS
        const a = ((k % SHELL_BUCKETS) + 0.5) / SHELL_BUCKETS
        ctx.beginPath()
        for (let j = 0; j < arr.length; j += 3) {
          // moveTo first, or every dot is joined to the last one
          ctx.moveTo(arr[j] + arr[j + 2], arr[j + 1])
          ctx.arc(arr[j], arr[j + 1], arr[j + 2], 0, Math.PI * 2)
        }
        ctx.fillStyle = rgba(warm ? WARM : REST, a)
        ctx.fill()
        arr.length = 0
      }
    }

    let idleFire = 0
    let wasBrain = false
    let lastSettle = settleRef.current

    const animate = (time: number) => {
      // ease the morph toward whichever phase is active
      const target = phaseRef.current === 'brain' ? 1 : 0

      // Asked to settle: drop everything in flight and let every neuron cool.
      // Without this the view comes back carrying every cascade set off while it
      // was hidden, which lands all at once the moment it is shown again.
      if (settleRef.current !== lastSettle) {
        lastSettle = settleRef.current
        spikes.length = 0
        for (const e of edges) e.heat = 0
        for (const e of brainEdges) e.heat = 0
        for (const n of neurons) {
          n.excite = 0
          n.flash = 0
          n.refractory = 0
        }
      }

      // On a phase flip, anything still in flight belongs to the layout that is
      // leaving. Its endpoints are about to move across the whole viewport, so
      // it goes rather than streaking after them.
      const nowBrain = phaseRef.current === 'brain'
      if (nowBrain !== wasBrain) {
        for (let i = spikes.length - 1; i >= 0; i--) {
          if (spikes[i].brain !== nowBrain) spikes.splice(i, 1)
        }
        for (const e of nowBrain ? edges : brainEdges) e.heat = 0
        wasBrain = nowBrain
      }
      const step = calm ? 0.12 : 0.022
      if (Math.abs(target - morph) > 0.0005) {
        morph += (target - morph) * (step * 2)
        morph = Math.max(0, Math.min(1, morph))
      } else {
        morph = target
      }

      if (morph > 0.02 && !calm) spin += 0.0022
      spinCos = Math.cos(spin)
      spinSin = Math.sin(spin)
      brainScale = Math.min(width, height) * 0.3

      // The comet trail is what gives the scattered field its motion, but on a
      // turning brain it just smears the surface, so it is wound back as the
      // neurons gather.
      // Fully gathered the fade is so close to opaque that the alpha blend is
      // wasted work, and an opaque fill is markedly cheaper across a full
      // retina canvas every frame.
      if (morph > 0.92) {
        ctx.fillStyle = '#000'
      } else {
        ctx.fillStyle = `rgba(0,0,0,${trailOpacity + morph * (0.85 - trailOpacity)})`
      }
      ctx.fillRect(0, 0, width, height)

      // positions first, so every edge is drawn against fresh coordinates
      for (const n of neurons) n.update(time)

      shown = easeInOut(morph)

      // A pool of light under the cursor. Only while gathered: on the open
      // field the cursor already has a job.
      if (shown > 0.01) {
        const m = mouseRef.current
        lightX = m.active ? m.x : width / 2
        lightY = m.active ? m.y : height * BRAIN_CENTER_Y
        if (!lightSprite) buildLightSprite()
        if (lightSprite) {
          ctx.globalCompositeOperation = 'lighter'
          ctx.globalAlpha = 0.22 * shown
          ctx.drawImage(
            lightSprite,
            lightX - LIGHT_RADIUS,
            lightY - LIGHT_RADIUS,
            LIGHT_RADIUS * 2,
            LIGHT_RADIUS * 2
          )
          ctx.globalAlpha = 1
          ctx.globalCompositeOperation = 'source-over'
        }
      }

      drawEdges(edges, 1 - shown)
      drawEdges(brainEdges, shown)

      // Gathered up there is no cursor to excite anything, so it fires itself.
      if (morph > 0.6 && time - idleFire > 430) {
        idleFire = time
        const n = neurons[Math.floor(Math.random() * fieldCount)]
        if (n && n.refractory <= 0) fire(n, 0.95)
      }

      for (let i = spikes.length - 1; i >= 0; i--) {
        const s = spikes[i]
        s.t += s.speed
        const e = s.edge
        e.heat = Math.max(e.heat, s.energy * 0.85)

        const tt = s.forward ? s.t : 1 - s.t
        const col = heat(s.energy)
        const vis = s.brain ? shown : 1 - shown
        if (vis <= 0.02) continue

        // A bolt rather than a comet: the path is kinked off the synapse a
        // little, redrawn each frame so it crackles, then struck twice. A wide
        // coloured pass for the discharge around it, a thin near white pass for
        // the core of the arc itself.
        const tail = 0.26
        const steps = 9
        const pts: { x: number; y: number }[] = []
        for (let k = 0; k <= steps; k++) {
          const p = s.t - (tail * k) / steps
          if (p < 0) break
          const q = pointOn(e, s.forward ? p : 1 - p)
          pts.push(q)
        }
        if (pts.length > 1) {
          // kink each interior point across the line of travel
          for (let k = 1; k < pts.length - 1; k++) {
            const a0 = pts[k - 1]
            const b0 = pts[k + 1]
            const dx = b0.x - a0.x
            const dy = b0.y - a0.y
            const len = Math.hypot(dx, dy) || 1
            const amp = (Math.random() - 0.5) * 5 * s.energy * (1 - k / pts.length)
            pts[k] = { x: pts[k].x + (-dy / len) * amp, y: pts[k].y + (dx / len) * amp }
          }

          const trace = () => {
            ctx.beginPath()
            ctx.moveTo(pts[0].x, pts[0].y)
            for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k].x, pts[k].y)
            ctx.stroke()
          }

          ctx.lineCap = 'round'
          ctx.lineJoin = 'round'
          ctx.lineWidth = 2.2 + s.energy * 2.2
          ctx.strokeStyle = rgba(col, 0.16 * s.energy * intensity * vis)
          trace()
          ctx.lineWidth = 0.8
          ctx.strokeStyle = rgba(mix(col, [255, 255, 255], 0.65), 0.9 * s.energy * intensity * vis)
          trace()
        }

        // the leading tip: a hard point with a short cross flare
        const head = pointOn(e, tt)
        const flare = (1.8 + s.energy * 3.4) * vis
        ctx.lineWidth = 0.7
        ctx.strokeStyle = rgba(col, 0.55 * s.energy * intensity * vis)
        ctx.beginPath()
        ctx.moveTo(head.x - flare, head.y)
        ctx.lineTo(head.x + flare, head.y)
        ctx.moveTo(head.x, head.y - flare)
        ctx.lineTo(head.x, head.y + flare)
        ctx.stroke()
        ctx.beginPath()
        ctx.arc(head.x, head.y, 0.9 + s.energy * 0.9, 0, Math.PI * 2)
        ctx.fillStyle = rgba([255, 255, 255], 0.95 * intensity * vis)
        ctx.fill()

        if (s.t >= 1) {
          const target = s.forward ? e.b : e.a
          spikes.splice(i, 1)
          if (target.refractory <= 0) fire(target, s.energy * 0.78)
          else target.flash = Math.max(target.flash, s.energy * 0.4)
        }
      }

      if (shown > 0.01) drawShell()
      for (const n of neurons) {
        if (!n.shell) n.draw()
      }

      rafRef.current = requestAnimationFrame(animate)
    }

    rafRef.current = requestAnimationFrame(animate)

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerdown', onPointerMove)
      document.removeEventListener('pointerleave', onPointerLeave)
      ro.disconnect()
    }
  }, [
    nodeColor,
    pulseColor,
    decayColor,
    nodeCount,
    connectionRadius,
    maxSynapses,
    hoverRadius,
    trailOpacity,
    intensity,
  ])

  return (
    <div
      ref={wrapRef}
      role="img"
      aria-label={ariaLabel}
      className={`fixed inset-0 overflow-hidden bg-black ${className}`}
    >
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="absolute inset-0 block h-full w-full"
      />
      {children ? <div className="relative z-10 h-full w-full">{children}</div> : null}
    </div>
  )
}

export default InteractiveSynapseNetwork
