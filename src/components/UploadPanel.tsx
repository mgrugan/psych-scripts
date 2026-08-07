import React, { useCallback, useRef, useState } from 'react'
import { formatBytes, previewSheet, type Mode, type SheetPreview } from '../lib/csv'

interface UploadPanelProps {
  busy: boolean
  onRun: (file: File, mode: Mode, topN: number) => void
}

const MODES: { id: Mode; label: string; note: string }[] = [
  { id: 'sex', label: 'Men vs women', note: 'one block per sex, split by a solid rule' },
  { id: 'age', label: 'Split by age', note: 'each sex halved at its own median age' },
]

const UploadPanel: React.FC<UploadPanelProps> = ({ busy, onRun }) => {
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<SheetPreview | null>(null)
  const [mode, setMode] = useState<Mode>('sex')
  const [topN, setTopN] = useState(10)
  const [dragging, setDragging] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const accept = useCallback(async (next: File | null | undefined) => {
    if (!next) return
    if (!/\.(csv|tsv|txt)$/i.test(next.name)) {
      setNote('that needs to be a csv exported from the sheet')
      return
    }
    setNote(null)
    setFile(next)
    setPreview(null)
    try {
      const p = await previewSheet(next)
      setPreview(p)
      setMode(p.suggested)
      if (!p.hasSex || !p.hasCondition) {
        setNote('a sex column and a condition column are both needed')
      }
    } catch {
      setNote('that file could not be read')
    }
  }, [])

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    if (busy) return
    accept(e.dataTransfer.files?.[0])
  }

  const ready = Boolean(file) && !busy
  const ageBlocked = mode === 'age' && preview !== null && !preview.hasAge

  return (
    <section className="glass rise rounded-[28px] p-2">
      <div
        onDragOver={(e) => {
          e.preventDefault()
          if (!busy) setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => !busy && inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click()
        }}
        className={`group relative cursor-pointer rounded-[22px] border border-dashed px-8 py-10 text-center transition-all duration-500 ${
          dragging
            ? 'border-[rgba(255,210,122,0.55)] bg-[rgba(255,210,122,0.05)]'
            : 'border-white/30 hover:border-white/55 hover:bg-white/[0.03]'
        } ${busy ? 'pointer-events-none opacity-60' : ''}`}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.tsv,.txt,text/csv"
          className="hidden"
          onChange={(e) => accept(e.target.files?.[0])}
        />

        <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full border border-white/35 transition-transform duration-700 group-hover:scale-110">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="0.9"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-5 w-5 text-white/70"
            aria-hidden="true"
          >
            <path d="M12 16V4" />
            <path d="m7.5 8.5 4.5-4.5 4.5 4.5" />
            <path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15" />
          </svg>
        </div>

        {file ? (
          <>
            {/* real exports have long unbroken names, so this has to clip */}
            <p
              className="font-display truncate text-[17px] font-light tracking-tight text-white"
              title={file.name}
            >
              {file.name}
            </p>
            <p className="mt-2 text-[12px] font-light tracking-wide text-white/80">
              {formatBytes(file.size)}
              {preview
                ? ` · ${preview.rowCount} rows · ${preview.roiCount} roi columns`
                : ' · reading'}
            </p>
          </>
        ) : (
          <>
            <p className="font-display text-[19px] font-light tracking-tight text-white">
              Drop the sheet here
            </p>
            <p className="mt-2.5 text-[12px] font-light tracking-wide text-white/75">
              export the google sheet as csv, or click to browse
            </p>
          </>
        )}
      </div>

      <div className="px-6 pt-6 pb-5">
        <div className="grid gap-5">
          <div>
            <p className="mb-2.5 text-[10px] font-medium tracking-widest-xl text-white/70 uppercase">
              Layout
            </p>
            <div className="inline-flex rounded-full border border-white/25 bg-white/[0.04] p-1">
              {MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  disabled={busy}
                  onClick={() => setMode(m.id)}
                  title={m.note}
                  className={`rounded-full px-5 py-2 text-[12px] tracking-wide transition-all duration-300 ${
                    mode === m.id
                      ? 'bg-white/90 font-medium text-black'
                      : 'font-light text-white/75 hover:text-white'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <p className="mt-2.5 text-[11px] font-light text-white/70">
              {MODES.find((m) => m.id === mode)?.note}
            </p>
          </div>

          <div>
            <p className="mb-2.5 text-[10px] font-medium tracking-widest-xl text-white/70 uppercase">
              Top regions
            </p>
            <div className="inline-flex items-center gap-5 rounded-full border border-white/25 bg-white/[0.04] px-5 py-1.5">
              <button
                type="button"
                disabled={busy || topN <= 1}
                onClick={() => setTopN((n) => Math.max(1, n - 1))}
                className="text-lg font-light text-white/75 transition hover:text-white disabled:opacity-20"
                aria-label="fewer regions"
              >
                &minus;
              </button>
              <span className="font-display w-8 text-center text-[20px] font-extralight tabular-nums text-white">
                {topN}
              </span>
              <button
                type="button"
                disabled={busy || topN >= 40}
                onClick={() => setTopN((n) => Math.min(40, n + 1))}
                className="text-lg font-light text-white/75 transition hover:text-white disabled:opacity-20"
                aria-label="more regions"
              >
                +
              </button>
            </div>
          </div>
        </div>

        {(note || ageBlocked) && (
          <p className="mt-4 text-[12px] font-light text-[#ffb27a]">
            {ageBlocked ? 'this sheet has no age column, so use the men vs women layout' : note}
          </p>
        )}

        <div className="mt-6 h-px hairline" />

        <button
          type="button"
          disabled={!ready || ageBlocked}
          onClick={() => file && onRun(file, mode, topN)}
          className={`relative mt-6 w-full overflow-hidden rounded-full py-3.5 text-[12px] tracking-widest uppercase transition-all duration-500 ${
            ready && !ageBlocked
              ? 'bg-white font-semibold text-black hover:bg-[#ffe9c2]'
              : 'cursor-not-allowed border border-white/25 bg-white/[0.04] font-light text-white/60'
          }`}
        >
          {busy ? 'Running the pipeline' : 'Run analysis'}
          {busy && <span className="sweep absolute inset-x-0 bottom-0 h-px" />}
        </button>
      </div>
    </section>
  )
}

export default UploadPanel
