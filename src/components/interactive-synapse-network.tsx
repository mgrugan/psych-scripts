import React, { useRef, useEffect, type ReactNode } from 'react'

export interface InteractiveSynapseNetworkProps {
  /** Content to render on top of the network canvas */
  children?: ReactNode
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

const InteractiveSynapseNetwork: React.FC<InteractiveSynapseNetworkProps> = ({
  children,
  nodeColor = '#ffffff',
  pulseColor = '#ffe08a',
  decayColor = '#ff3b2e',
  nodeCount = 72,
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
  const rafRef = useRef<number | null>(null)

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
      x: number
      y: number
      vx: number
      vy: number
      /** soma size */
      r: number
      /** soma is a slightly squashed, rotated ellipse so nothing reads as a dot */
      squash: number
      tilt: number
      dendrites: Dendrite[] = []
      edges: number[] = []
      /** how close the cursor is, 0-1 */
      excite = 0
      /** firing flash, decays to 0 */
      flash = 0
      /** frames left before the neuron can fire again */
      refractory = 0
      phase: number

      constructor() {
        this.x = Math.random() * width
        this.y = Math.random() * height
        const drift = calm ? 0 : 0.16
        this.vx = (Math.random() - 0.5) * drift
        this.vy = (Math.random() - 0.5) * drift
        this.r = Math.random() * 1.7 + 1.6
        this.squash = 0.62 + Math.random() * 0.3
        this.tilt = Math.random() * Math.PI
        this.phase = Math.random() * Math.PI * 2

        const spines = 3 + Math.floor(Math.random() * 4)
        for (let i = 0; i < spines; i++) {
          this.dendrites.push({
            angle: (i / spines) * Math.PI * 2 + Math.random() * 0.9,
            len: this.r * (3.4 + Math.random() * 5.2),
            bend: (Math.random() - 0.5) * 0.9,
            sway: Math.random() * Math.PI * 2,
          })
        }
      }

      update(t: number) {
        this.x += this.vx
        this.y += this.vy
        if (this.x < 4 || this.x > width - 4) this.vx *= -1
        if (this.y < 4 || this.y > height - 4) this.vy *= -1
        this.x = Math.max(4, Math.min(width - 4, this.x))
        this.y = Math.max(4, Math.min(height - 4, this.y))

        const m = mouseRef.current
        let target = 0
        if (m.active) {
          const d = Math.hypot(this.x - m.x, this.y - m.y)
          target = Math.max(0, 1 - d / hoverRadius)
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

      t = 0

      draw() {
        const heatT = Math.min(1, this.flash)
        const glow = Math.max(this.excite * 0.75, heatT)
        const col = heatT > 0.01 ? mix(REST, heat(heatT), Math.min(1, heatT * 1.5)) : REST

        // dendrites
        const dendAlpha = (0.13 + glow * 0.62) * intensity
        if (dendAlpha > 0.012) {
          ctx.lineWidth = 0.7
          ctx.strokeStyle = rgba(col, dendAlpha)
          for (const d of this.dendrites) {
            const wob = calm ? 0 : Math.sin(this.t * 0.0009 + d.sway) * 0.16
            const a = d.angle + wob
            const len = d.len * (1 + glow * 0.35)
            const ex = this.x + Math.cos(a) * len
            const ey = this.y + Math.sin(a) * len
            const mx = this.x + Math.cos(a) * len * 0.55
            const my = this.y + Math.sin(a) * len * 0.55
            const nx = -Math.sin(a) * len * d.bend * 0.4
            const ny = Math.cos(a) * len * d.bend * 0.4
            ctx.beginPath()
            ctx.moveTo(this.x, this.y)
            ctx.quadraticCurveTo(mx + nx, my + ny, ex, ey)
            ctx.stroke()
          }
        }

        // halo around an active soma
        if (glow > 0.02) {
          const rad = this.r * (5 + glow * 9)
          const g = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, rad)
          g.addColorStop(0, rgba(col, 0.34 * glow * intensity))
          g.addColorStop(1, rgba(col, 0))
          ctx.fillStyle = g
          ctx.beginPath()
          ctx.arc(this.x, this.y, rad, 0, Math.PI * 2)
          ctx.fill()
        }

        // soma
        const breathe = calm ? 1 : 1 + Math.sin(this.t * 0.0012 + this.phase) * 0.08
        const rr = this.r * breathe * (1 + heatT * 0.7)
        ctx.beginPath()
        ctx.ellipse(this.x, this.y, rr, rr * this.squash, this.tilt, 0, Math.PI * 2)
        ctx.fillStyle = rgba(col, (0.28 + glow * 0.72) * intensity)
        ctx.fill()

        if (heatT > 0.25) {
          ctx.beginPath()
          ctx.arc(this.x, this.y, rr * 0.45, 0, Math.PI * 2)
          ctx.fillStyle = rgba([255, 255, 255], Math.min(0.85, heatT) * intensity)
          ctx.fill()
        }
      }
    }

    interface Edge {
      a: Neuron
      b: Neuron
      /** perpendicular offset of the bezier control point, as a fraction of length */
      bow: number
      /** residual glow left behind by a signal */
      heat: number
    }

    interface Spike {
      edge: Edge
      /** true when travelling a -> b */
      forward: boolean
      t: number
      speed: number
      energy: number
    }

    const neurons: Neuron[] = []
    const edges: Edge[] = []
    const spikes: Spike[] = []
    const MAX_SPIKES = 340

    const control = (e: Edge) => {
      const dx = e.b.x - e.a.x
      const dy = e.b.y - e.a.y
      const mx = (e.a.x + e.b.x) / 2
      const my = (e.a.y + e.b.y) / 2
      return { cx: mx - dy * e.bow, cy: my + dx * e.bow }
    }

    const pointOn = (e: Edge, t: number) => {
      const { cx, cy } = control(e)
      const u = 1 - t
      return {
        x: u * u * e.a.x + 2 * u * t * cx + t * t * e.b.x,
        y: u * u * e.a.y + 2 * u * t * cy + t * t * e.b.y,
      }
    }

    function fire(n: Neuron, energy: number) {
      n.flash = Math.max(n.flash, energy)
      n.refractory = 48 + Math.floor(Math.random() * 34)
      if (energy < 0.16) return

      for (const ei of n.edges) {
        if (spikes.length >= MAX_SPIKES) break
        // Not every synapse relays; the network stays legible.
        if (Math.random() > 0.82) continue
        const e = edges[ei]
        const forward = e.a === n
        const other = forward ? e.b : e.a
        if (other.refractory > 0 && Math.random() > 0.25) continue
        spikes.push({
          edge: e,
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
      spikes.length = 0
      const count = Math.max(
        12,
        Math.round(nodeCount * Math.min(1.35, (width * height) / (1440 * 900)))
      )
      for (let i = 0; i < count; i++) neurons.push(new Neuron())

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
          const edge: Edge = {
            a: n,
            b: c.o,
            bow: (Math.random() - 0.5) * 0.22,
            heat: 0,
          }
          edges.push(edge)
          const idx = edges.length - 1
          n.edges.push(idx)
          c.o.edges.push(idx)
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

    const animate = (time: number) => {
      // Fade rather than clear, so signals leave a faint comet trail.
      ctx.fillStyle = `rgba(0,0,0,${trailOpacity})`
      ctx.fillRect(0, 0, width, height)

      // resting synapses
      ctx.lineWidth = 0.6
      for (const e of edges) {
        const base = Math.max(e.a.excite, e.b.excite)
        const a = (0.055 + base * 0.18) * intensity
        const { cx, cy } = control(e)
        ctx.beginPath()
        ctx.moveTo(e.a.x, e.a.y)
        ctx.quadraticCurveTo(cx, cy, e.b.x, e.b.y)
        ctx.strokeStyle = rgba(REST, a)
        ctx.stroke()

        // afterglow of a signal that just passed through
        if (e.heat > 0.01) {
          ctx.lineWidth = 0.6 + e.heat * 1.5
          ctx.strokeStyle = rgba(heat(e.heat), e.heat * 0.55 * intensity)
          ctx.beginPath()
          ctx.moveTo(e.a.x, e.a.y)
          ctx.quadraticCurveTo(cx, cy, e.b.x, e.b.y)
          ctx.stroke()
          ctx.lineWidth = 0.6
          e.heat *= 0.945
        }
      }

      // travelling signals
      for (let i = spikes.length - 1; i >= 0; i--) {
        const s = spikes[i]
        s.t += s.speed
        const e = s.edge
        e.heat = Math.max(e.heat, s.energy * 0.85)

        const tt = s.forward ? s.t : 1 - s.t
        const col = heat(s.energy)

        // comet tail along the synapse
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
        ctx.strokeStyle = rgba(col, 0.5 * s.energy * intensity)
        ctx.stroke()

        // head
        const head = pointOn(e, tt)
        const hr = 1.6 + s.energy * 2.2
        const g = ctx.createRadialGradient(head.x, head.y, 0, head.x, head.y, hr * 4)
        g.addColorStop(0, rgba([255, 255, 255], 0.9 * intensity))
        g.addColorStop(0.35, rgba(col, 0.7 * intensity))
        g.addColorStop(1, rgba(col, 0))
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.arc(head.x, head.y, hr * 4, 0, Math.PI * 2)
        ctx.fill()

        if (s.t >= 1) {
          const target = s.forward ? e.b : e.a
          spikes.splice(i, 1)
          if (target.refractory <= 0) fire(target, s.energy * 0.82)
          else target.flash = Math.max(target.flash, s.energy * 0.4)
        }
      }

      for (const n of neurons) {
        n.update(time)
        n.draw()
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
