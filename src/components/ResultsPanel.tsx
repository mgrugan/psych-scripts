import React, { useState } from 'react'
import type { AnalysisResult, PlotResult } from '../lib/api'

interface ResultsPanelProps {
  result: AnalysisResult
  onReset: () => void
}

const Stat: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div>
    <p className="font-display text-[26px] font-extralight tabular-nums text-white">{value}</p>
    <p className="mt-1 text-[10px] font-medium tracking-widest-xl text-white/28 uppercase">
      {label}
    </p>
  </div>
)

const PlotCard: React.FC<{ plot: PlotResult; onOpen: () => void }> = ({ plot, onOpen }) => (
  <article className="glass-soft group overflow-hidden rounded-[22px]">
    <button
      type="button"
      onClick={onOpen}
      className="block w-full cursor-zoom-in bg-white/[0.02] p-3"
      aria-label={`open the ${plot.condition} plot`}
    >
      <img
        src={plot.png}
        alt={`${plot.condition} region map`}
        loading="lazy"
        className="w-full rounded-[14px] opacity-85 transition-all duration-700 group-hover:opacity-100"
      />
    </button>

    <div className="px-6 pt-5 pb-6">
      <div className="flex items-baseline justify-between gap-4">
        <h3 className="font-display text-[15px] font-medium tracking-[0.2em] text-white/90 uppercase">
          {plot.condition}
        </h3>
        <span className="text-[10px] font-extralight tracking-wider text-white/25">
          {plot.rois.length} rois
        </span>
      </div>

      {plot.rois.length > 0 && (
        <p className="mt-3 text-[11px] font-extralight leading-relaxed tracking-wide text-white/35">
          {plot.rois.join('  ·  ')}
        </p>
      )}

      <div className="mt-6 flex gap-2">
        <a
          href={`${plot.png}?download=1`}
          className="flex-1 rounded-full border border-white/10 py-2.5 text-center text-[11px] font-light tracking-widest text-white/60 uppercase transition-all duration-300 hover:border-white/30 hover:text-white"
        >
          Png
        </a>
        <a
          href={`${plot.pdf}?download=1`}
          className="flex-1 rounded-full border border-white/10 py-2.5 text-center text-[11px] font-light tracking-widest text-white/60 uppercase transition-all duration-300 hover:border-white/30 hover:text-white"
        >
          Pdf
        </a>
      </div>
    </div>
  </article>
)

const ResultsPanel: React.FC<ResultsPanelProps> = ({ result, onReset }) => {
  const [zoom, setZoom] = useState<PlotResult | null>(null)
  const [showLog, setShowLog] = useState(false)

  return (
    <section className="rise">
      <div className="glass rounded-[28px] px-8 py-8 sm:px-10">
        <div className="flex flex-wrap items-end justify-between gap-8">
          <div className="flex gap-12">
            <Stat label="Plots" value={String(result.plots.length)} />
            <Stat label="Rows" value={String(result.rows)} />
            <Stat label="Roi columns" value={String(result.roiCount)} />
            <Stat label="Top n" value={String(result.topN)} />
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onReset}
              className="rounded-full border border-white/10 px-6 py-3 text-[11px] font-light tracking-widest text-white/50 uppercase transition-all duration-300 hover:border-white/25 hover:text-white"
            >
              New sheet
            </button>
            <a
              href={result.archive}
              className="rounded-full bg-white px-7 py-3 text-[11px] font-semibold tracking-widest text-black uppercase transition-colors duration-300 hover:bg-[#ffe9c2]"
            >
              Download all
            </a>
          </div>
        </div>

        <p className="mt-7 text-[11px] font-extralight tracking-wide text-white/28">
          {result.sourceName} · {result.mode === 'age' ? 'split by age' : 'men vs women'}
        </p>
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-2">
        {result.plots.map((p) => (
          <PlotCard key={p.condition} plot={p} onOpen={() => setZoom(p)} />
        ))}
      </div>

      {result.log && (
        <div className="glass-soft mt-8 rounded-[22px] px-7 py-5">
          <button
            type="button"
            onClick={() => setShowLog((v) => !v)}
            className="flex w-full items-center justify-between text-[10px] font-medium tracking-widest-xl text-white/35 uppercase transition hover:text-white/70"
          >
            Run log
            <span className="text-sm font-extralight">{showLog ? '−' : '+'}</span>
          </button>
          {showLog && (
            <pre className="mt-5 max-h-80 overflow-auto text-[11px] leading-relaxed font-light whitespace-pre-wrap text-white/40">
              {result.log}
            </pre>
          )}
        </div>
      )}

      {zoom && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${zoom.condition} plot`}
          onClick={() => setZoom(null)}
          className="fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center bg-black/85 p-6 backdrop-blur-md"
        >
          <img
            src={zoom.png}
            alt={`${zoom.condition} region map`}
            className="max-h-full max-w-full rounded-2xl"
          />
        </div>
      )}
    </section>
  )
}

export default ResultsPanel
