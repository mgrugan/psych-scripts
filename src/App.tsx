import React, { useEffect, useState } from 'react'
import InteractiveSynapseNetwork from './components/interactive-synapse-network'
import UploadPanel from './components/UploadPanel'
import ResultsPanel from './components/ResultsPanel'
import { analyze, checkEngine, type AnalysisResult, type EngineHealth } from './lib/api'
import type { Mode } from './lib/csv'

const App: React.FC = () => {
  const [engine, setEngine] = useState<EngineHealth | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    checkEngine().then(setEngine)
  }, [])

  const run = async (file: File, mode: Mode, topN: number) => {
    setBusy(true)
    setError(null)
    try {
      const res = await analyze(file, mode, topN)
      setResult(res)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'the analysis failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <InteractiveSynapseNetwork />

      {/* keeps the type legible over the brightest part of the network */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-[1]"
        style={{
          background:
            'radial-gradient(120% 75% at 50% 0%, rgba(0,0,0,0.72) 0%, rgba(0,0,0,0.45) 45%, rgba(0,0,0,0.8) 100%)',
        }}
      />

      <div className="relative z-10 min-h-screen">
        <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-8 sm:px-10">
          <div className="flex items-center gap-4">
            <svg viewBox="0 0 32 32" className="h-6 w-6 text-white/70" aria-hidden="true">
              <circle cx="16" cy="16" r="3" fill="currentColor" opacity="0.9" />
              <circle cx="16" cy="16" r="9.5" fill="none" stroke="currentColor" strokeWidth="0.6" opacity="0.55" />
              <circle cx="16" cy="16" r="14.5" fill="none" stroke="currentColor" strokeWidth="0.5" opacity="0.25" />
            </svg>
            <span className="font-display text-[12px] font-medium tracking-widest-xl text-white/75 uppercase">
              FNSW
            </span>
          </div>

          <div className="flex items-center gap-2.5">
            <span
              className="h-1.5 w-1.5 rounded-full transition-colors duration-500"
              style={{
                background:
                  engine === null
                    ? 'rgba(255,255,255,0.28)'
                    : engine.available
                      ? '#ffd27a'
                      : '#ff5a2b',
              }}
            />
            <span className="text-[10px] font-extralight tracking-[0.28em] text-white/35 uppercase">
              {engine === null ? 'checking' : engine.available ? 'engine ready' : 'engine offline'}
            </span>
          </div>
        </header>

        <main className="mx-auto max-w-6xl px-6 pb-28 sm:px-10">
          {/* Once there are plots to look at, the hero steps out of the way. */}
          <section
            className={`rise transition-all duration-700 ${
              result ? 'pt-10 pb-10' : 'pt-12 pb-12 sm:pt-16 sm:pb-16'
            }`}
          >
            <p className="text-[10px] font-medium tracking-widest-xl text-white/30 uppercase">
              AAL region atlas
            </p>
            <h1
              className={`font-display mt-6 max-w-3xl leading-[0.95] font-extralight tracking-[-0.035em] text-white ${
                result
                  ? 'text-[clamp(1.7rem,3.4vw,2.4rem)]'
                  : 'text-[clamp(2.6rem,6.4vw,4.6rem)]'
              }`}
            >
              Where the{result ? ' ' : <br />}
              <span className="font-light text-white/55">signal splits.</span>
            </h1>
            {!result && (
              <p className="mt-8 max-w-xl text-[14px] leading-[1.85] font-extralight tracking-wide text-white/45">
                Upload a sheet of AAL ROI values. The pipeline ranks every region by its
                standardized difference between groups, then returns a plot for each condition,
                ready to download.
              </p>
            )}
          </section>

          {result ? (
            <ResultsPanel result={result} onReset={() => setResult(null)} />
          ) : (
            <div className="max-w-2xl">
              <UploadPanel busy={busy} onRun={run} />

              {busy && (
                <p className="mt-7 text-center text-[11px] font-extralight tracking-[0.24em] text-white/35 uppercase">
                  R is drawing your conditions
                </p>
              )}

              {error && (
                <div className="glass-soft mt-7 rounded-2xl px-7 py-5">
                  <p className="text-[10px] font-medium tracking-widest-xl text-[#ff8a5c] uppercase">
                    Stopped
                  </p>
                  <p className="mt-3 text-[13px] leading-relaxed font-extralight text-white/60">
                    {error}
                  </p>
                </div>
              )}

              {engine && !engine.available && !busy && (
                <p className="mt-7 text-[11px] leading-relaxed font-extralight text-white/30">
                  R is not reachable yet. Install R with tidyverse, cowplot and scales, then
                  start the api with npm run dev.
                </p>
              )}
            </div>
          )}
        </main>

        <footer className="mx-auto max-w-6xl px-6 pb-12 sm:px-10">
          <div className="hairline h-px" />
          <p className="mt-6 text-[10px] font-extralight tracking-[0.28em] text-white/20 uppercase">
            Face · Number · Geometry · Word
          </p>
        </footer>
      </div>
    </>
  )
}

export default App
