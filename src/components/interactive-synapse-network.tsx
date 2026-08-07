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
 * A point on a brain-shaped shell.
 *
 * The last slice of the points form the cerebellum, a separate lobe tucked
 * under the back. The rest are the cerebrum: an ellipsoid longer front to back
 * than it is tall, tapered at both poles, flattened underneath, and parted down
 * the middle by a fissure that only opens along the top.
 */
function brainPoint(i: number, n: number): [number, number, number] {
  const cerebellumFrom = Math.floor(n * 0.84)

  if (i >= cerebellumFrom) {
    const k = i - cerebellumFrom
    const count = Math.max(1, n - cerebellumFrom)
    let [sx, sy, sz] = spherePoint(k, count)
    const side = sx >= 0 ? 1 : -1
    return [
      sx * 0.42 + side * 0.06,
      sy * 0.19 - 0.40,
      sz * 0.27 - 0.68,
    ]
  }

  let [ux, uy, uz] = spherePoint(i, cerebellumFrom)

  // proportions: narrow across, tallest in the middle, longest front to back
  ux *= 0.78
  uy *= 0.60
  uz *= 1.14

  // taper the frontal and occipital poles
  const taper = 1 - 0.2 * uz * uz
  ux *= taper
  uy *= taper

  // flatten the underside, a brain does not hang below like a sphere
  if (uy < 0) uy *= 0.78

  // The longitudinal fissure parts the hemispheres along the top only, so the
  // underside stays closed instead of notching into a heart.
  const side = ux >= 0 ? 1 : -1
  const fissure = Math.max(0, Math.min(1, (uy + 0.1) / 0.5))
  ux += side * 0.09 * fissure

  // gyri, just enough surface ripple to avoid reading as a smooth egg
  const ripple = 0.04 * Math.sin(ux * 12) * Math.cos(uz * 9) + 0.025 * Math.sin(uy * 14)
  const len = Math.hypot(ux, uy, uz) || 1
  ux += (ux / len) * ripple
  uy += (uy / len) * ripple
  uz += (uz / len) * ripple

  return [ux, uy, uz]
}

const InteractiveSynapseNetwork: React.FC<InteractiveSynapseNetworkProps> = ({
  children,
  phase = 'field',
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
  const rafRef = useRef<number | null>(null)

  // Phase changes must not tear down the simulation, so it is read from a ref.
  useEffect(() => {
    phaseRef.current = phase
  }, [phase])

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
    let spin = 0

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
        // where they left rather than somewhere else entirely.
        const loose = 1 - morph
        this.x += this.vx * loose
        this.y += this.vy * loose
        if (this.x < 4 || this.x > width - 4) this.vx *= -1
        if (this.y < 4 || this.y > height - 4) this.vy *= -1
        this.x = Math.max(4, Math.min(width - 4, this.x))
        this.y = Math.max(4, Math.min(height - 4, this.y))

        // Rotate the brain position and project it, then blend the two layouts.
        const cos = Math.cos(spin)
        const sin = Math.sin(spin)
        const rx = this.bx * cos + this.bz * sin
        let rz = -this.bx * sin + this.bz * cos

        // a slight tilt so the brain is seen from just above, not edge on
        const tc = Math.cos(0.32)
        const ts = Math.sin(0.32)
        const ry = this.by * tc - rz * ts
        rz = this.by * ts + rz * tc

        const scale = Math.min(width, height) * 0.34
        const persp = 3.1 / (3.1 + rz)
        const bpx = width / 2 + rx * scale * persp
        const bpy = height / 2 + ry * scale * persp

        this.depth = persp
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
        const solid = 1 - morph + morph * (0.35 + (this.depth - 0.72) * 1.5)

        const dendAlpha = (0.13 + glow * 0.62) * intensity * Math.max(0.2, solid)
        if (dendAlpha > 0.012) {
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

        if (glow > 0.02) {
          const rad = (this.r + 1.1) * (4 + glow * 7)
          const g = ctx.createRadialGradient(this.px, this.py, 0, this.px, this.py, rad)
          g.addColorStop(0, rgba(col, 0.34 * glow * intensity))
          g.addColorStop(1, rgba(col, 0))
          ctx.fillStyle = g
          ctx.beginPath()
          ctx.arc(this.px, this.py, rad, 0, Math.PI * 2)
          ctx.fill()
        }

        const breathe = calm ? 1 : 1 + Math.sin(this.t * 0.0012 + this.phase) * 0.08
        const rr = this.r * breathe * (1 + heatT * 0.5) * (1 - 0.15 * morph) * (morph ? this.depth : 1)
        ctx.beginPath()
        ctx.ellipse(this.px, this.py, rr, rr * this.squash, this.tilt, 0, Math.PI * 2)
        ctx.fillStyle = rgba(col, (0.28 + glow * 0.72) * intensity * Math.max(0.25, solid))
        ctx.fill()

        if (heatT > 0.25) {
          ctx.beginPath()
          ctx.arc(this.px, this.py, rr * 0.45, 0, Math.PI * 2)
          ctx.fillStyle = rgba([255, 255, 255], Math.min(0.85, heatT) * intensity)
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
          speed: (0.012 + Math.random() * 0.012) * (calm ? 0.6 : 1),
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

      // brain shell coordinates
      neurons.forEach((n, i) => {
        const [bx, by, bz] = brainPoint(i, count)
        n.bx = bx
        n.by = by
        n.bz = bz
      })

      // synapses across the scattered field
      const seen = new Set<string>()
      neurons.forEach((n, i) => {
        const near = neurons
          .map((o, j) => ({ o, j, d: Math.hypot(n.x - o.x, n.y - o.y) }))
          .filter((c) => c.j !== i && c.d < connectionRadius)
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

      // connectome across the brain shell, so the gathered form is wired too
      const seen3 = new Set<string>()
      neurons.forEach((n, i) => {
        const near = neurons
          .map((o, j) => ({
            o,
            j,
            d: Math.hypot(n.bx - o.bx, n.by - o.by, n.bz - o.bz),
          }))
          .filter((c) => c.j !== i && c.d < 0.42)
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
        const a = (0.055 + base * 0.18 + morph * 0.05) * intensity * visibility * Math.max(0.3, depth - 0.35)
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

    let idleFire = 0
    let wasBrain = false

    const animate = (time: number) => {
      // ease the morph toward whichever phase is active
      const target = phaseRef.current === 'brain' ? 1 : 0

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

      if (morph > 0.02 && !calm) spin += 0.0045

      ctx.fillStyle = `rgba(0,0,0,${trailOpacity})`
      ctx.fillRect(0, 0, width, height)

      // positions first, so every edge is drawn against fresh coordinates
      for (const n of neurons) n.update(time)

      const shown = easeInOut(morph)
      drawEdges(edges, 1 - shown)
      drawEdges(brainEdges, shown)

      // Gathered up there is no cursor to excite anything, so it fires itself.
      if (morph > 0.6 && time - idleFire > 430) {
        idleFire = time
        const n = neurons[Math.floor(Math.random() * neurons.length)]
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

        const tail = 0.3
        ctx.lineWidth = 1 + s.energy * 1.6
        ctx.beginPath()
        const steps = 8
        for (let k = 0; k <= steps; k++) {
          const p = s.t - (tail * k) / steps
          if (p < 0) break
          const q = pointOn(e, s.forward ? p : 1 - p)
          if (k === 0) ctx.moveTo(q.x, q.y)
          else ctx.lineTo(q.x, q.y)
        }
        ctx.strokeStyle = rgba(col, 0.5 * s.energy * intensity * vis)
        ctx.stroke()

        const head = pointOn(e, tt)
        const hr = 1.0 + s.energy * 1.4
        const g = ctx.createRadialGradient(head.x, head.y, 0, head.x, head.y, hr * 3.6)
        g.addColorStop(0, rgba([255, 255, 255], 0.9 * intensity * vis))
        g.addColorStop(0.35, rgba(col, 0.7 * intensity * vis))
        g.addColorStop(1, rgba(col, 0))
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.arc(head.x, head.y, hr * 3.6, 0, Math.PI * 2)
        ctx.fill()

        if (s.t >= 1) {
          const target = s.forward ? e.b : e.a
          spikes.splice(i, 1)
          if (target.refractory <= 0) fire(target, s.energy * 0.78)
          else target.flash = Math.max(target.flash, s.energy * 0.4)
        }
      }

      for (const n of neurons) n.draw()

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
