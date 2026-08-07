import type { Mode } from './csv'

export interface PlotResult {
  condition: string
  rois: string[]
  png: string
  pdf: string
}

export interface AnalysisResult {
  jobId: string
  sourceName: string
  mode: Mode
  topN: number
  rows: number
  /** rows set aside because they had no usable sex, condition or age */
  skipped: number
  roiCount: number
  log: string
  plots: PlotResult[]
  archive: string
}

export interface EngineHealth {
  available: boolean
  version?: string
}

export async function checkEngine(): Promise<EngineHealth> {
  try {
    const res = await fetch('/api/health')
    if (!res.ok) return { available: false }
    const body = await res.json()
    return body.r ?? { available: false }
  } catch {
    return { available: false }
  }
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Uploads the sheet, then polls until R is finished. The run is async on the
 * server because a full sheet can take longer than a proxy will hold a request
 * open, so this never blocks on one long-lived connection.
 */
export async function analyze(
  file: File,
  mode: Mode,
  topN: number,
  onProgress?: (status: string) => void
): Promise<AnalysisResult> {
  const form = new FormData()
  form.append('file', file)
  form.append('mode', mode)
  form.append('topN', String(topN))

  const start = await fetch('/api/analyze', { method: 'POST', body: form })
  const started = await start.json().catch(() => ({}))

  if (!start.ok) {
    throw new Error(started?.error || `the upload failed (${start.status})`)
  }

  const jobId: string = started.jobId
  if (!jobId) throw new Error('the server did not start a job')

  onProgress?.('queued')

  // Poll gently at first, then back off so a slow host is not hammered.
  const deadline = Date.now() + 10 * 60 * 1000
  let delay = 1000

  while (Date.now() < deadline) {
    await wait(delay)
    delay = Math.min(delay * 1.25, 4000)

    let body: Record<string, unknown>
    try {
      const res = await fetch(`/api/jobs/${jobId}`)
      if (res.status === 404) throw new Error('that job expired before it finished')
      body = await res.json()
    } catch (e) {
      // A single dropped poll on a sleeping host should not kill the run.
      if (e instanceof Error && e.message.includes('expired')) throw e
      continue
    }

    if (body.status === 'done') return body as unknown as AnalysisResult
    if (body.status === 'error') throw new Error(String(body.error || 'the analysis failed'))
    onProgress?.(String(body.status || 'running'))
  }

  throw new Error('the analysis took too long and was given up on')
}
