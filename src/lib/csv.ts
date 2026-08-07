export type Mode = 'sex' | 'age'

export interface SheetPreview {
  columns: string[]
  rowCount: number
  roiCount: number
  hasAge: boolean
  hasSex: boolean
  hasCondition: boolean
  suggested: Mode
}

const META = [
  'participant',
  'participantid',
  'subject',
  'condition',
  'conditioncode',
  'conditionname',
  'sex',
  'sex_m0f1',
  'gender',
  'age',
  'ageyears',
  'age_years',
  'agegroup',
  'subjectrow',
]

/** Split one CSV line, honouring quoted fields. */
function splitLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else quoted = false
      } else cur += ch
    } else if (ch === '"') {
      quoted = true
    } else if (ch === ',') {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out.map((v) => v.trim())
}

const has = (cols: string[], ...names: string[]) =>
  cols.some((c) => names.includes(c.trim().toLowerCase()))

/** Reads just enough of the file to describe it before anything is uploaded. */
export async function previewSheet(file: File): Promise<SheetPreview> {
  const head = await file.slice(0, 512 * 1024).text()
  const lines = head.split(/\r?\n/)
  const columns = splitLine(lines[0] || '').filter((c) => c.length > 0)

  const text = await file.text()
  const rowCount = text
    .split(/\r?\n/)
    .slice(1)
    .filter((l) => l.trim().length > 0).length

  // Mirrors the rule in run_analysis.R: when columns are named with their AAL
  // number first, only those count as regions.
  const rest = columns.filter((c) => !META.includes(c.trim().toLowerCase()))
  const aal = rest.filter((c) => /^[0-9]+[^0-9]/.test(c.trim()))
  const roiCount = aal.length > 0 ? aal.length : rest.length
  const hasAge = has(columns, 'age', 'ageyears', 'age_years')
  const hasSex = has(columns, 'sex', 'sex_m0f1', 'gender')
  const hasCondition = has(columns, 'condition', 'conditioncode')

  return {
    columns,
    rowCount,
    roiCount,
    hasAge,
    hasSex,
    hasCondition,
    suggested: hasAge ? 'age' : 'sex',
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
