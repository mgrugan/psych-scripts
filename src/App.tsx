import React, { useEffect, useState } from 'react'
import InteractiveSynapseNetwork from './components/interactive-synapse-network'
import UploadPanel from './components/UploadPanel'
import ResultsPanel from './components/ResultsPanel'
import LoadingDots from './components/LoadingDots'
import { analyze, checkEngine, type AnalysisResult, type EngineHealth } from './lib/api'
import type { Mode } from './lib/csv'

const App: React.FC = () => {
  const [engine, setEngine] = useState<EngineHealth | null>(null)
  const [busy, setBusy] = useState(false)
  const [phase, setPhase] = useState('queued')
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** bumped when the upload view comes back, to settle the network first */
  const [settle, setSettle] = useState(0)

  useEffect(() => {
    checkEngine().then(setEngine)
  }, [])

  const run = async (file: File, mode: Mode, topN: number) => {
    setBusy(true)
    setError(null)
    setPhase('queued')
    try {
      const res = await analyze(file, mode, topN, setPhase)
      setResult(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'the analysis failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {/* The network gathers into a spinning brain while R is working. */}
      <InteractiveSynapseNetwork phase={busy ? 'brain' : 'field'} settle={settle} />

      {/* keeps the type legible, and lifts out of the way of the brain */}
      <div
        aria-hidden="true"
        className={`pointer-events-none fixed inset-0 z-[1] transition-opacity duration-[1200ms] ${
          busy ? 'opacity-30' : 'opacity-100'
        }`}
        style={{
          background:
            'radial-gradient(120% 75% at 50% 0%, rgba(0,0,0,0.72) 0%, rgba(0,0,0,0.45) 45%, rgba(0,0,0,0.8) 100%)',
        }}
      />

      <div className="relative z-10 flex h-screen flex-col">
        <header className="mx-auto flex w-full max-w-6xl shrink-0 items-center px-6 py-6 sm:px-10">
          <img src="/icons/brain.png" alt="" aria-hidden="true" className="h-7 w-7 opacity-90" />
        </header>

        <main className="mx-auto w-full max-w-6xl min-h-0 flex-1 px-6 sm:px-10">
          {busy ? (
            <div className="flex h-full items-end justify-center pb-16">
              <p className="font-display text-[12px] font-light tracking-[0.4em] text-white/90 uppercase">
                <LoadingDots
                  label={phase === 'queued' ? 'Waiting for the engine' : 'Drawing your conditions'}
                />
              </p>
            </div>
          ) : result ? (
            <ResultsPanel
              result={result}
              onReset={() => {
                setResult(null)
                setSettle((n) => n + 1)
              }}
            />
          ) : (
            <div className="grid h-full content-start items-center gap-10 overflow-y-auto py-2 lg:grid-cols-[1fr_minmax(0,440px)] lg:content-center lg:gap-14 lg:overflow-hidden lg:py-0">
              <section className="rise pt-6 lg:pt-0">
                <p className="flex items-center gap-2.5 text-[10px] font-medium tracking-widest-xl text-white/70 uppercase">
                  <img src="/icons/mosaic.png" alt="" aria-hidden="true" className="h-3 w-3 opacity-80" />
                  AAL region atlas
                </p>
                <h1 className="font-display gradient-text mt-5 text-[clamp(2.2rem,5vw,3.9rem)] leading-[0.98] font-extralight tracking-[-0.035em]">
                  The Mosaic
                  <br />
                  <span className="font-light">Project</span>
                </h1>
                <p className="mt-6 max-w-md text-[13px] leading-[1.8] font-light tracking-wide text-white/85">
                  Upload a sheet of AAL ROI values. The pipeline ranks every region by its
                  standardized difference between groups, then returns a plot for each
                  condition, ready to download.
                </p>

                {error && (
                  <div className="glass-soft mt-7 max-w-md rounded-2xl px-6 py-4">
                    <p className="text-[10px] font-medium tracking-widest-xl text-[#ff8a5c] uppercase">
                      Stopped
                    </p>
                    <p className="mt-2 text-[12px] leading-relaxed font-light text-white/90">
                      {error}
                    </p>
                  </div>
                )}

                {engine && !engine.available && (
                  <p className="mt-6 max-w-md text-[11px] leading-relaxed font-light text-white/70">
                    R is not reachable yet. Install R with tidyverse, cowplot and scales, then
                    start the api.
                  </p>
                )}
              </section>

              <div className="pb-6 lg:pb-0">
                <UploadPanel busy={busy} onRun={run} />
              </div>
            </div>
          )}
        </main>

        <footer className="mx-auto w-full max-w-6xl shrink-0 px-6 pb-5 sm:px-10">
          <div className="hairline h-px" />
          <p className="mt-4 text-[10px] font-light tracking-[0.28em] text-white/55 uppercase">
            Face · Number · Geometry · Word
          </p>
        </footer>
      </div>
    </>
  )
}

export default App
