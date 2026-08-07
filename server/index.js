import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { ZipArchive } from 'archiver'
import express from 'express'
import multer from 'multer'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const JOBS = process.env.JOBS_DIR || path.join(ROOT, '.jobs')
const SCRIPT = path.join(ROOT, 'R', 'run_analysis.R')

const PORT = Number(process.env.PORT || 8787)
const HOST = process.env.HOST || '0.0.0.0'
const RSCRIPT = process.env.RSCRIPT || 'Rscript'
const TIMEOUT_MS = Number(process.env.ANALYSIS_TIMEOUT_MS || 8 * 60 * 1000)
const JOB_TTL_MS = Number(process.env.JOB_TTL_MS || 6 * 60 * 60 * 1000)
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 64 * 1024 * 1024)

await fsp.mkdir(JOBS, { recursive: true })

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
})

const app = express()
app.disable('x-powered-by')
app.use(express.json({ limit: '1mb' }))

/** Job ids are generated here, so anything that is not one is a probe. */
const isJobId = (id) => /^[a-f0-9]{24}$/.test(id || '')

/** Only ever serve files the R script itself wrote. */
function resolveInJob(jobId, name) {
  if (!isJobId(jobId)) return null
  const base = path.basename(name || '')
  if (!base || base.startsWith('.')) return null
  const full = path.join(JOBS, jobId, 'out', base)
  if (!full.startsWith(path.join(JOBS, jobId) + path.sep)) return null
  return full
}

/**
 * Live job state. Runs are async because a full sheet takes long enough that a
 * synchronous request would sit past a proxy's timeout on a small host.
 */
const jobs = new Map()

/**
 * R with tidyverse loaded is the memory hog here, so only one run at a time.
 * Everything else waits its turn rather than risking the box running out.
 */
let queue = Promise.resolve()

function runR({ input, outdir, mode, topN }) {
  return new Promise((resolve) => {
    const args = [
      SCRIPT,
      '--input', input,
      '--outdir', outdir,
      '--mode', mode,
      '--top-n', String(topN),
    ]
    const child = spawn(RSCRIPT, args, { cwd: ROOT })

    let stdout = ''
    let stderr = ''
    let timedOut = false

    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, TIMEOUT_MS)

    child.stdout.on('data', (d) => {
      stdout += d
      if (stdout.length > 400_000) stdout = stdout.slice(-400_000)
    })
    child.stderr.on('data', (d) => {
      stderr += d
      if (stderr.length > 400_000) stderr = stderr.slice(-400_000)
    })

    child.on('error', (err) => {
      clearTimeout(timer)
      resolve({ ok: false, stdout, stderr: String(err.message), spawnFailed: true })
    })

    child.on('close', (code) => {
      clearTimeout(timer)
      if (timedOut) {
        resolve({ ok: false, stdout, stderr: 'the analysis ran out of time' })
      } else {
        resolve({ ok: code === 0, code, stdout, stderr })
      }
    })
  })
}

/** Pull the useful line out of an R error dump for the UI. */
function tidyError(stderr) {
  const lines = String(stderr || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  const hit = lines.find((l) => /^(Error|Fatal error)/i.test(l))
  const line = hit || lines[lines.length - 1] || 'the analysis failed'
  return line.replace(/^Error(\s+in[^:]*)?:\s*/i, '').slice(0, 400)
}

async function sweepOldJobs() {
  try {
    const now = Date.now()
    for (const entry of await fsp.readdir(JOBS, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const dir = path.join(JOBS, entry.name)
      const stat = await fsp.stat(dir)
      if (now - stat.mtimeMs > JOB_TTL_MS) {
        await fsp.rm(dir, { recursive: true, force: true })
        jobs.delete(entry.name)
      }
    }
  } catch {
    // sweeping is best effort
  }
}

async function execute(jobId, { jobDir, outDir, inputPath, mode, topN, sourceName }) {
  const job = jobs.get(jobId)
  if (!job) return

  job.status = 'running'
  job.startedAt = Date.now()

  const result = await runR({ input: inputPath, outdir: outDir, mode, topN })

  let log = ''
  try {
    log = await fsp.readFile(path.join(outDir, 'log.txt'), 'utf8')
  } catch {
    log = result.stdout
  }
  job.log = log

  if (result.spawnFailed) {
    job.status = 'error'
    job.error =
      'R is not reachable on this machine. Install R plus tidyverse, cowplot and scales, or point RSCRIPT at your Rscript binary.'
    await fsp.rm(jobDir, { recursive: true, force: true })
    return
  }

  if (!result.ok) {
    job.status = 'error'
    job.error = tidyError(result.stderr)
    await fsp.rm(jobDir, { recursive: true, force: true })
    return
  }

  let manifest
  try {
    manifest = JSON.parse(await fsp.readFile(path.join(outDir, 'manifest.json'), 'utf8'))
  } catch {
    job.status = 'error'
    job.error = 'the analysis finished without writing any plots'
    await fsp.rm(jobDir, { recursive: true, force: true })
    return
  }

  // The uploaded sheet is only needed while R is reading it.
  await fsp.rm(inputPath, { force: true })

  job.status = 'done'
  job.result = {
    jobId,
    sourceName,
    mode: manifest.mode,
    topN: manifest.topN,
    rows: manifest.rows,
    skipped: manifest.skipped || 0,
    roiCount: manifest.roiCount,
    log,
    plots: (manifest.plots || []).map((p) => ({
      condition: p.condition,
      rois: p.rois || [],
      png: `/api/jobs/${jobId}/files/${encodeURIComponent(p.png)}`,
      pdf: `/api/jobs/${jobId}/files/${encodeURIComponent(p.pdf)}`,
    })),
    archive: `/api/jobs/${jobId}/archive`,
  }

  sweepOldJobs()
}

app.get('/api/health', async (_req, res) => {
  const probe = await new Promise((resolve) => {
    const child = spawn(RSCRIPT, ['--version'])
    let out = ''
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (out += d))
    child.on('error', () => resolve(null))
    child.on('close', () => resolve(out.trim().split('\n')[0] || 'Rscript'))
  })
  res.json({ ok: true, r: probe ? { available: true, version: probe } : { available: false } })
})

app.post('/api/analyze', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'no file was uploaded' })
  }

  const mode = req.body?.mode === 'age' ? 'age' : 'sex'
  const topN = Math.max(1, Math.min(40, Number(req.body?.topN) || 10))
  const sourceName = req.file.originalname || 'upload.csv'

  const jobId = crypto.randomBytes(12).toString('hex')
  const jobDir = path.join(JOBS, jobId)
  const outDir = path.join(jobDir, 'out')
  await fsp.mkdir(outDir, { recursive: true })

  const inputPath = path.join(jobDir, 'input.csv')
  await fsp.writeFile(inputPath, req.file.buffer)

  jobs.set(jobId, { status: 'queued', createdAt: Date.now(), sourceName })

  // Hand the run to the queue and answer immediately; the client polls.
  queue = queue
    .then(() => execute(jobId, { jobDir, outDir, inputPath, mode, topN, sourceName }))
    .catch(async (err) => {
      const job = jobs.get(jobId)
      if (job) {
        job.status = 'error'
        job.error = err?.message || 'the analysis failed'
      }
      await fsp.rm(jobDir, { recursive: true, force: true })
    })

  res.status(202).json({ jobId, status: 'queued' })
})

app.get('/api/jobs/:id', (req, res) => {
  const id = req.params.id
  if (!isJobId(id)) return res.status(404).json({ error: 'not found' })
  const job = jobs.get(id)
  if (!job) return res.status(404).json({ error: 'that job has expired' })

  if (job.status === 'done') return res.json({ status: 'done', ...job.result })
  if (job.status === 'error') {
    return res.status(200).json({ status: 'error', error: job.error, log: job.log || '' })
  }
  res.json({
    status: job.status,
    elapsedMs: job.startedAt ? Date.now() - job.startedAt : 0,
  })
})

app.get('/api/jobs/:id/files/:name', (req, res) => {
  const full = resolveInJob(req.params.id, req.params.name)
  if (!full || !fs.existsSync(full)) return res.status(404).json({ error: 'not found' })
  // The jobs directory is hidden, so send() has to be told to serve through it.
  const options = { dotfiles: 'allow' }
  if (req.query.download === '1') {
    return res.download(full, path.basename(full), options)
  }
  res.sendFile(full, options)
})

app.get('/api/jobs/:id/archive', (req, res) => {
  const id = req.params.id
  if (!isJobId(id)) return res.status(404).json({ error: 'not found' })
  const dir = path.join(JOBS, id, 'out')
  if (!fs.existsSync(dir)) return res.status(404).json({ error: 'not found' })

  res.attachment(`fnsw-plots-${id.slice(0, 8)}.zip`)
  const archive = new ZipArchive({ zlib: { level: 9 } })
  archive.on('error', () => res.destroy())
  archive.pipe(res)
  archive.directory(dir, false)
  archive.finalize()
})

// Serve the built dashboard when it exists, so one process covers everything.
const dist = path.join(ROOT, 'dist')
if (fs.existsSync(dist)) {
  app.use(express.static(dist))
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')))
}

app.use((err, _req, res, _next) => {
  if (err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'that file is larger than the 64 MB limit' })
  }
  const status = Number(err?.status || err?.statusCode) || 500
  res.status(status).json({ error: err?.message || 'something went wrong' })
})

app.listen(PORT, HOST, () => {
  console.log(`api listening on http://${HOST}:${PORT}`)
})

sweepOldJobs()
setInterval(sweepOldJobs, 30 * 60 * 1000).unref()
