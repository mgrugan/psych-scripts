import React, { useState } from 'react'
import type { AnalysisResult } from '../lib/api'

interface ResultsPanelProps {
  result: AnalysisResult
  onReset: () => void
}

/** One screen: pick a condition on the left, it fills the frame on the right. */
const ResultsPanel: React.FC<ResultsPanelProps> = ({ result, onReset }) => {
  const [active, setActive] = useState(0)
  const [zoom, setZoom] = useState(false)
  const plot = result.plots[active]

  if (!plot) return null

  return (
    <div className="rise flex h-full flex-col gap-4 pb-4">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-1.5">
          {result.plots.map((p, i) => (
            <button
              key={p.condition}
              type="button"
              onClick={() => setActive(i)}
              className={`rounded-full px-5 py-2 text-[11px] tracking-[0.18em] uppercase transition-all duration-300 ${
                i === active
                  ? 'bg-white/90 font-medium text-black'
                  : 'font-light text-white/75 hover:text-white'
              }`}
            >
              {p.condition}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <a
            href={`${plot.png}?download=1`}
            className="rounded-full border border-white/70 px-5 py-2 text-[10px] font-light tracking-[0.18em] text-white/85 uppercase transition-all duration-300 hover:border-white hover:text-white"
          >
            Png
          </a>
          <a
            href={`${plot.pdf}?download=1`}
            className="rounded-full border border-white/70 px-5 py-2 text-[10px] font-light tracking-[0.18em] text-white/85 uppercase transition-all duration-300 hover:border-white hover:text-white"
          >
            Pdf
          </a>
          <a
            href={result.archive}
            className="rounded-full bg-white px-5 py-2 text-[10px] font-semibold tracking-[0.18em] text-black uppercase transition-colors duration-300 hover:bg-[#ffe9c2]"
          >
            All
          </a>
          <button
            type="button"
            onClick={onReset}
            className="rounded-full border border-white/70 px-5 py-2 text-[10px] font-light tracking-[0.18em] text-white/75 uppercase transition-all duration-300 hover:border-white hover:text-white"
          >
            New
          </button>
        </div>
      </div>

      <div className="glass min-h-0 flex-1 overflow-hidden rounded-[22px] p-3">
        <button
          type="button"
          onClick={() => setZoom(true)}
          className="block h-full w-full cursor-zoom-in"
          aria-label={`open the ${plot.condition} plot full size`}
        >
          <img
            src={plot.png}
            alt={`${plot.condition} region map`}
            className="h-full w-full rounded-[14px] object-contain"
          />
        </button>
      </div>

      <div className="flex shrink-0 flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <p className="text-[11px] font-light tracking-wide text-white/75">
          {plot.rois.join('  ·  ')}
        </p>
        <p className="text-[10px] font-light tracking-[0.2em] text-white/65 uppercase">
          {result.rows} rows
          {result.skipped > 0 && (
            <span className="text-[#ffb27a]"> · {result.skipped} set aside</span>
          )}{' '}
          · {result.roiCount} rois · top {result.topN} ·{' '}
          {result.mode === 'age' ? 'split by age' : 'men vs women'}
        </p>
      </div>

      {zoom && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${plot.condition} plot`}
          onClick={() => setZoom(false)}
          className="fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center bg-black/90 p-6 backdrop-blur-md"
        >
          <img
            src={plot.png}
            alt={`${plot.condition} region map`}
            className="max-h-full max-w-full rounded-2xl"
          />
        </div>
      )}
    </div>
  )
}

export default ResultsPanel
