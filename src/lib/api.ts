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

export async function analyze(
  file: File,
  mode: Mode,
  topN: number
): Promise<AnalysisResult> {
  const form = new FormData()
  form.append('file', file)
  form.append('mode', mode)
  form.append('topN', String(topN))

  const res = await fetch('/api/analyze', { method: 'POST', body: form })
  const body = await res.json().catch(() => ({}))

  if (!res.ok) {
    throw new Error(body?.error || `the analysis failed (${res.status})`)
  }
  return body as AnalysisResult
}
