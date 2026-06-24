import { Hono } from 'hono'
import { basicAuth } from 'hono/basic-auth'
import { getCookie, setCookie } from 'hono/cookie'
import Anthropic from '@anthropic-ai/sdk'
import { createHash, randomUUID } from 'crypto'
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync, statSync } from 'fs'
import { join, extname, basename, resolve } from 'path'
import JSZip from 'jszip'

const app = new Hono()

const DATA_DIR = resolve(process.env.DATA_DIR || '/data/projects')
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin'
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

mkdirSync(DATA_DIR, { recursive: true })

// ── Security ──────────────────────────────────────────────────────────────────

function validSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,62}$/.test(slug)
}

function validFilename(name: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}$/.test(name) && !name.includes('..')
}

function safePath(projectDir: string, filename: string): string | null {
  const resolved = resolve(join(projectDir, filename))
  if (!resolved.startsWith(projectDir + '/') && resolved !== projectDir) return null
  return resolved
}

// ── Project meta (password) ───────────────────────────────────────────────────

interface ProjectMeta { password?: string }

function getMeta(slug: string): ProjectMeta {
  const p = join(DATA_DIR, slug, '_meta.json')
  if (!existsSync(p)) return {}
  try { return JSON.parse(readFileSync(p, 'utf-8')) } catch { return {} }
}

function saveMeta(slug: string, meta: ProjectMeta) {
  writeFileSync(join(DATA_DIR, slug, '_meta.json'), JSON.stringify(meta), 'utf-8')
}

function hashPwd(password: string, slug: string): string {
  return createHash('sha256').update(`${password}:${slug}:demo-is`).digest('hex')
}

// ── SitePing data model ───────────────────────────────────────────────────────

interface CommentAI { category: string; suggestion: string; priority: string }

interface SitepingAnnotation {
  id: string; feedbackId: string
  cssSelector: string; xpath: string; textSnippet: string
  elementTag: string; elementId?: string | null
  textPrefix: string; textSuffix: string; fingerprint: string
  neighborText: string; anchorKey?: string | null
  xPct: number; yPct: number; wPct: number; hPct: number
  scrollX: number; scrollY: number; viewportW: number; viewportH: number; devicePixelRatio: number
  createdAt: string
}

interface SitepingFeedback {
  id: string; projectName: string
  type: 'question' | 'change' | 'bug' | 'other'
  message: string; status: 'open' | 'resolved'
  url: string; urlPattern: string | null
  authorName: string; authorEmail: string
  viewport: string; userAgent: string; clientId: string
  resolvedAt: string | null; createdAt: string; updatedAt: string
  annotations: SitepingAnnotation[]
  screenshotUrl: string | null; diagnostics: unknown | null
  aiAnalysis?: CommentAI
}

function getFeedbacks(slug: string): SitepingFeedback[] {
  const p = join(DATA_DIR, slug, '_feedbacks.json')
  if (!existsSync(p)) return []
  try { return JSON.parse(readFileSync(p, 'utf-8')) } catch { return [] }
}

function saveFeedbacks(slug: string, feedbacks: SitepingFeedback[]) {
  writeFileSync(join(DATA_DIR, slug, '_feedbacks.json'), JSON.stringify(feedbacks), 'utf-8')
}

// Maps SitePing feedback to the format the admin panel expects
function feedbackToAdminComment(f: SitepingFeedback) {
  const ann = f.annotations[0]
  return {
    id: f.id,
    x: ann?.xPct ?? 0.5,
    y: ann?.yPct ?? 0.5,
    text: f.message,
    type: f.type,
    author: f.authorName,
    createdAt: f.createdAt,
    resolved: f.status === 'resolved',
    selector: ann?.cssSelector,
    xpath: ann?.xpath,
    elementText: ann?.textSnippet,
    tagName: ann?.elementTag?.toLowerCase(),
    aiAnalysis: f.aiAnalysis,
  }
}

// ── AI analysis ───────────────────────────────────────────────────────────────

async function analyzeFeedback(feedback: SitepingFeedback): Promise<CommentAI | undefined> {
  try {
    const ann = feedback.annotations[0]
    const ctx = [
      ann?.elementTag   && `Tag: <${ann.elementTag}>`,
      ann?.cssSelector  && `Selector: ${ann.cssSelector}`,
      ann?.textSnippet  && `Text: "${ann.textSnippet}"`,
      feedback.type     && `Category: ${feedback.type}`,
      feedback.url      && `URL: ${feedback.url}`,
    ].filter(Boolean).join('\n')

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [{
        role: 'user',
        content: `Analyze this client feedback on a web prototype. Reply with JSON only.\n\nFeedback: "${feedback.message}"\n${ctx ? 'Context:\n' + ctx : ''}\n\n{"category":"design|copy|ux|bug|layout|other","suggestion":"short actionable fix","priority":"low|medium|high"}`,
      }],
    })

    const text = response.content[0].type === 'text' ? response.content[0].text : ''
    const match = text.match(/\{[\s\S]*?\}/)
    return match ? JSON.parse(match[0]) : undefined
  } catch {
    return undefined
  }
}

// ── SitePing widget injection ─────────────────────────────────────────────────

function injectSitePing(html: string, slug: string): string {
  const script = `<script src="/siteping.js"></script><script>initDemoSiteping(${JSON.stringify(slug)})</script>`
  return html.includes('</body>') ? html.replace('</body>', script + '</body>') : html + script
}

// ── Lock page ──────────────────────────────────────────────────────────────────

function lockPage(slug: string, error = false): string {
  return `<!DOCTYPE html><html lang="pl"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dostęp chroniony</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f0f17;color:#cdd6f4;min-height:100vh;display:flex;align-items:center;justify-content:center}.card{background:#1e1e2e;border:1px solid #313244;border-radius:16px;padding:40px;width:340px;max-width:95vw;text-align:center}.icon{font-size:40px;margin-bottom:16px}h2{font-size:20px;font-weight:600;margin-bottom:8px}p{font-size:14px;color:#6c7086;margin-bottom:24px}input{width:100%;background:#313244;border:1px solid #45475a;border-radius:8px;padding:12px 16px;color:#cdd6f4;font-size:15px;outline:none;text-align:center;letter-spacing:3px}input:focus{border-color:#89b4fa}button{width:100%;background:#89b4fa;color:#1e1e2e;border:none;border-radius:8px;padding:12px;font-size:15px;font-weight:600;cursor:pointer;margin-top:12px;transition:background .15s}button:hover{background:#74c7ec}.err{color:#f38ba8;font-size:13px;margin-top:12px}</style>
</head><body><div class="card"><div class="icon">🔒</div><h2>Strona chroniona</h2><p>Wpisz hasło żeby zobaczyć projekt</p>
<form method="POST" action="/${slug}/_unlock"><input type="password" name="password" placeholder="••••••••" autofocus autocomplete="current-password"><button type="submit">Wejdź →</button>${error ? '<p class="err">Nieprawidłowe hasło</p>' : ''}</form>
</div></body></html>`
}

// ── Auth ───────────────────────────────────────────────────────────────────────

const auth = basicAuth({ username: 'admin', password: ADMIN_PASSWORD })

// ── SitePing widget bundle ────────────────────────────────────────────────────

const SITEPING_BUNDLE_PATH = join(import.meta.dir, '..', 'dist', 'siteping.js')

app.get('/siteping.js', (c) => {
  if (!existsSync(SITEPING_BUNDLE_PATH)) return c.text('Bundle not found — run: bun build src/siteping-init.ts --outfile dist/siteping.js --target browser', 503)
  const content = readFileSync(SITEPING_BUNDLE_PATH)
  return new Response(content, { headers: { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } })
})

// ── Admin panel ───────────────────────────────────────────────────────────────

app.use('/admin', auth)
app.get('/admin', (c) => {
  const html = readFileSync(join(import.meta.dir, 'admin.html'), 'utf-8')
  return c.html(html)
})

// ── Public: unlock project with password ──────────────────────────────────────

app.post('/:slug/_unlock', async (c) => {
  const { slug } = c.req.param()
  if (!validSlug(slug)) return c.text('Not found', 404)

  const body = await c.req.parseBody()
  const password = String(body.password || '')
  const meta = getMeta(slug)

  if (!meta.password || hashPwd(password, slug) !== meta.password) {
    return c.html(lockPage(slug, true))
  }

  setCookie(c, `demo_${slug}`, meta.password, {
    path: '/' + slug,
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 30,
    sameSite: 'Lax',
  })
  return c.redirect('/' + slug)
})

// ── SitePing endpoint mode (GET/POST/PATCH/DELETE /sp/:slug) ─────────────────
// SitePing calls a single URL for all operations when using endpoint: config.
// Routes are 2-segment (/sp/:slug) so they don't conflict with the 3-segment
// legacy routes (/sp/feedback/:slug, /sp/feedbacks/:slug) below.

app.get('/sp/:slug', (c) => {
  const { slug } = c.req.param()
  if (!validSlug(slug)) return c.json({ feedbacks: [], total: 0 })

  let feedbacks = getFeedbacks(slug)
  const status = c.req.query('status')
  const type = c.req.query('type')
  const search = c.req.query('search')
  if (status) feedbacks = feedbacks.filter(f => f.status === status)
  if (type) feedbacks = feedbacks.filter(f => f.type === type)
  if (search) feedbacks = feedbacks.filter(f => f.message.toLowerCase().includes(search.toLowerCase()))

  const page = Math.max(1, Number(c.req.query('page') ?? 1))
  const limit = Math.min(100, Math.max(1, Number(c.req.query('limit') ?? 50)))
  const total = feedbacks.length
  const paged = feedbacks.slice((page - 1) * limit, page * limit)
  return c.json({ feedbacks: paged, total })
})

app.post('/sp/:slug', async (c) => {
  const { slug } = c.req.param()
  if (!validSlug(slug)) return c.json({ error: 'Not found' }, 404)
  if (!existsSync(join(DATA_DIR, slug))) return c.json({ error: 'Not found' }, 404)

  const data = await c.req.json() as Omit<SitepingFeedback, 'id' | 'createdAt' | 'updatedAt'> & { screenshotDataUrl?: string }

  if (data.clientId) {
    const existing = getFeedbacks(slug).find(f => f.clientId === data.clientId)
    if (existing) return c.json(existing)
  }

  const now = new Date().toISOString()
  const feedbackId = randomUUID()
  const feedback: SitepingFeedback = {
    id: feedbackId,
    projectName: slug,
    type: data.type ?? 'other',
    message: String(data.message ?? '').slice(0, 5000),
    status: 'open',
    url: String(data.url ?? ''),
    urlPattern: data.urlPattern ?? null,
    authorName: String(data.authorName ?? 'Client').slice(0, 200),
    authorEmail: String(data.authorEmail ?? 'client@demo.important.is').slice(0, 200),
    viewport: String(data.viewport ?? ''),
    userAgent: String(data.userAgent ?? ''),
    clientId: String(data.clientId ?? randomUUID()),
    resolvedAt: null,
    createdAt: now,
    updatedAt: now,
    annotations: (data.annotations ?? []).map((ann: SitepingAnnotation) => ({
      ...ann,
      id: ann.id ?? randomUUID(),
      feedbackId,
      createdAt: ann.createdAt ?? now,
    })),
    screenshotUrl: (data as any).screenshotDataUrl ?? data.screenshotUrl ?? null,
    diagnostics: data.diagnostics ?? null,
  }

  const feedbacks = getFeedbacks(slug)
  feedbacks.push(feedback)
  saveFeedbacks(slug, feedbacks)

  analyzeFeedback(feedback).then(ai => {
    if (!ai) return
    const all = getFeedbacks(slug)
    const target = all.find(f => f.id === feedback.id)
    if (target) { target.aiAnalysis = ai; saveFeedbacks(slug, all) }
  }).catch(() => {})

  return c.json(feedback, 201)
})

app.patch('/sp/:slug', async (c) => {
  const { slug } = c.req.param()
  if (!validSlug(slug)) return c.json({ error: 'Not found' }, 404)

  const { id, status } = await c.req.json()
  const feedbacks = getFeedbacks(slug)
  const feedback = feedbacks.find(f => f.id === id)
  if (!feedback) return c.json({ error: 'Not found' }, 404)

  feedback.status = status ?? feedback.status
  feedback.resolvedAt = status === 'resolved' ? new Date().toISOString() : null
  feedback.updatedAt = new Date().toISOString()
  saveFeedbacks(slug, feedbacks)
  return c.json(feedback)
})

app.delete('/sp/:slug', async (c) => {
  const { slug } = c.req.param()
  if (!validSlug(slug)) return c.json({ error: 'Not found' }, 404)

  const body = await c.req.json().catch(() => ({})) as { id?: string; deleteAll?: boolean }
  if (body.deleteAll) {
    saveFeedbacks(slug, [])
  } else if (body.id) {
    saveFeedbacks(slug, getFeedbacks(slug).filter(f => f.id !== body.id))
  }
  return new Response(null, { status: 204 })
})

// ── SitePing public API (legacy per-method routes) ────────────────────────────

app.post('/sp/feedback/:slug', async (c) => {
  const { slug } = c.req.param()
  if (!validSlug(slug)) return c.json({ error: 'Not found' }, 404)
  if (!existsSync(join(DATA_DIR, slug))) return c.json({ error: 'Not found' }, 404)

  const data = await c.req.json() as Omit<SitepingFeedback, 'id' | 'createdAt' | 'updatedAt'>

  // Idempotency: return existing on duplicate clientId
  if (data.clientId) {
    const existing = getFeedbacks(slug).find(f => f.clientId === data.clientId)
    if (existing) return c.json(existing)
  }

  const now = new Date().toISOString()
  const feedbackId = randomUUID()
  const feedback: SitepingFeedback = {
    id: feedbackId,
    projectName: slug,
    type: data.type ?? 'other',
    message: String(data.message ?? '').slice(0, 5000),
    status: 'open',
    url: String(data.url ?? ''),
    urlPattern: data.urlPattern ?? null,
    authorName: String(data.authorName ?? 'Client').slice(0, 200),
    authorEmail: String(data.authorEmail ?? 'client@demo.important.is').slice(0, 200),
    viewport: String(data.viewport ?? ''),
    userAgent: String(data.userAgent ?? ''),
    clientId: String(data.clientId ?? randomUUID()),
    resolvedAt: null,
    createdAt: now,
    updatedAt: now,
    annotations: (data.annotations ?? []).map((ann: SitepingAnnotation) => ({
      ...ann,
      id: ann.id ?? randomUUID(),
      feedbackId,
      createdAt: ann.createdAt ?? now,
    })),
    screenshotUrl: data.screenshotUrl ?? null,
    diagnostics: data.diagnostics ?? null,
  }

  const feedbacks = getFeedbacks(slug)
  feedbacks.push(feedback)
  saveFeedbacks(slug, feedbacks)

  // AI analysis in background
  analyzeFeedback(feedback).then(ai => {
    if (!ai) return
    const all = getFeedbacks(slug)
    const target = all.find(f => f.id === feedback.id)
    if (target) { target.aiAnalysis = ai; saveFeedbacks(slug, all) }
  }).catch(() => {})

  return c.json(feedback, 201)
})

app.get('/sp/feedbacks/:slug', (c) => {
  const { slug } = c.req.param()
  if (!validSlug(slug)) return c.json({ feedbacks: [], total: 0 })

  let feedbacks = getFeedbacks(slug)
  const status = c.req.query('status')
  const type = c.req.query('type')
  const search = c.req.query('search')
  if (status) feedbacks = feedbacks.filter(f => f.status === status)
  if (type) feedbacks = feedbacks.filter(f => f.type === type)
  if (search) feedbacks = feedbacks.filter(f => f.message.toLowerCase().includes(search.toLowerCase()))

  const page = Math.max(1, Number(c.req.query('page') ?? 1))
  const limit = Math.min(100, Math.max(1, Number(c.req.query('limit') ?? 50)))
  const total = feedbacks.length
  const paged = feedbacks.slice((page - 1) * limit, page * limit)

  return c.json({ feedbacks: paged, total })
})

app.get('/sp/feedback/:slug/client/:clientId', (c) => {
  const { slug, clientId } = c.req.param()
  if (!validSlug(slug)) return c.json(null, 404)

  const feedback = getFeedbacks(slug).find(f => f.clientId === decodeURIComponent(clientId))
  return feedback ? c.json(feedback) : c.json(null, 404)
})

app.patch('/sp/feedback/:slug/:id', async (c) => {
  const { slug, id } = c.req.param()
  if (!validSlug(slug)) return c.json({ error: 'Not found' }, 404)

  const { status, resolvedAt } = await c.req.json()
  const feedbacks = getFeedbacks(slug)
  const feedback = feedbacks.find(f => f.id === id)
  if (!feedback) return c.json({ error: 'Not found' }, 404)

  feedback.status = status ?? feedback.status
  feedback.resolvedAt = resolvedAt ?? feedback.resolvedAt
  feedback.updatedAt = new Date().toISOString()
  saveFeedbacks(slug, feedbacks)
  return c.json(feedback)
})

app.delete('/sp/feedback/:slug/:id', (c) => {
  const { slug, id } = c.req.param()
  if (!validSlug(slug)) return c.json({ error: 'Not found' }, 404)

  const feedbacks = getFeedbacks(slug)
  const idx = feedbacks.findIndex(f => f.id === id)
  if (idx === -1) return c.json({ error: 'Not found' }, 404)

  feedbacks.splice(idx, 1)
  saveFeedbacks(slug, feedbacks)
  return new Response(null, { status: 204 })
})

app.delete('/sp/feedbacks/:slug', (c) => {
  const { slug } = c.req.param()
  if (!validSlug(slug)) return c.json({ error: 'Not found' }, 404)
  saveFeedbacks(slug, [])
  return new Response(null, { status: 204 })
})

// ── Protected API ─────────────────────────────────────────────────────────────

app.use('/api/*', auth)

app.get('/api/projects', (c) => {
  if (!existsSync(DATA_DIR)) return c.json([])
  const projects = readdirSync(DATA_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => {
      const files = readdirSync(join(DATA_DIR, d.name))
        .filter(f => !f.startsWith('_'))
        .filter(f => { try { return statSync(join(DATA_DIR, d.name, f)).isFile() } catch { return false } })
      const feedbacks = getFeedbacks(d.name)
      const meta = getMeta(d.name)
      return {
        slug: d.name,
        files,
        commentCount: feedbacks.filter(f => f.status === 'open').length,
        hasPassword: !!meta.password,
      }
    })
  return c.json(projects)
})

app.post('/api/projects/paste', async (c) => {
  const { slug, html } = await c.req.json()
  if (!slug || !validSlug(slug)) return c.json({ error: 'Invalid slug (lowercase, numbers, hyphens only)' }, 400)
  if (!html) return c.json({ error: 'html required' }, 400)

  const projectDir = join(DATA_DIR, slug)
  mkdirSync(projectDir, { recursive: true })
  writeFileSync(join(projectDir, 'index.html'), html, 'utf-8')
  return c.json({ slug, url: `/${slug}` })
})

app.post('/api/projects/upload', async (c) => {
  const formData = await c.req.formData()
  const slug = (formData.get('slug') as string)?.trim().toLowerCase()
  const file = formData.get('file') as File

  if (!slug || !validSlug(slug)) return c.json({ error: 'Invalid slug' }, 400)
  if (!file) return c.json({ error: 'file required' }, 400)

  const zip = await JSZip.loadAsync(await file.arrayBuffer())
  const projectDir = join(DATA_DIR, slug)
  mkdirSync(projectDir, { recursive: true })

  const promises: Promise<void>[] = []
  zip.forEach((relativePath, entry) => {
    if (!entry.dir) {
      const filename = basename(relativePath)
      if (validFilename(filename) && !filename.startsWith('_')) {
        promises.push(entry.async('uint8array').then(data => {
          writeFileSync(join(projectDir, filename), data)
        }))
      }
    }
  })
  await Promise.all(promises)
  return c.json({ slug, url: `/${slug}` })
})

app.get('/api/projects/:slug', (c) => {
  const { slug } = c.req.param()
  if (!validSlug(slug)) return c.json({ error: 'Invalid slug' }, 400)

  const projectDir = join(DATA_DIR, slug)
  if (!existsSync(projectDir)) return c.json({ error: 'Not found' }, 404)

  const textExts = new Set(['.html', '.css', '.js', '.ts', '.json', '.txt', '.svg', '.xml', '.md'])
  const files = readdirSync(projectDir)
    .filter(name => !name.startsWith('_'))
    .filter(name => { try { return statSync(join(projectDir, name)).isFile() } catch { return false } })
    .map(name => ({
      name,
      content: textExts.has(extname(name).toLowerCase())
        ? readFileSync(join(projectDir, name), 'utf-8')
        : '[binary]'
    }))

  const meta = getMeta(slug)
  return c.json({ slug, files, hasPassword: !!meta.password })
})

app.put('/api/projects/:slug', async (c) => {
  const { slug } = c.req.param()
  if (!validSlug(slug)) return c.json({ error: 'Invalid slug' }, 400)

  const { filename, content } = await c.req.json()
  if (!filename || !validFilename(filename)) return c.json({ error: 'Invalid filename' }, 400)

  const projectDir = join(DATA_DIR, slug)
  if (!existsSync(projectDir)) return c.json({ error: 'Not found' }, 404)

  const filePath = safePath(projectDir, filename)
  if (!filePath) return c.json({ error: 'Invalid path' }, 400)

  writeFileSync(filePath, content, 'utf-8')
  return c.json({ ok: true })
})

app.delete('/api/projects/:slug', (c) => {
  const { slug } = c.req.param()
  if (!validSlug(slug)) return c.json({ error: 'Invalid slug' }, 400)

  const projectDir = join(DATA_DIR, slug)
  if (existsSync(projectDir)) rmSync(projectDir, { recursive: true, force: true })
  return c.json({ ok: true })
})

// ── Project settings (password) ───────────────────────────────────────────────

app.patch('/api/projects/:slug/settings', async (c) => {
  const { slug } = c.req.param()
  if (!validSlug(slug)) return c.json({ error: 'Invalid slug' }, 400)
  if (!existsSync(join(DATA_DIR, slug))) return c.json({ error: 'Not found' }, 404)

  const { password } = await c.req.json()
  const meta = getMeta(slug)

  if (password === null || password === '') {
    delete meta.password
  } else {
    meta.password = hashPwd(String(password), slug)
  }

  saveMeta(slug, meta)
  return c.json({ ok: true, hasPassword: !!meta.password })
})

// ── Comments admin API (maps SitePing feedbacks to old comment format) ────────

app.get('/api/projects/:slug/comments', (c) => {
  const { slug } = c.req.param()
  if (!validSlug(slug)) return c.json({ error: 'Invalid slug' }, 400)
  return c.json(getFeedbacks(slug).map(feedbackToAdminComment))
})

app.patch('/api/projects/:slug/comments/:id', async (c) => {
  const { slug, id } = c.req.param()
  if (!validSlug(slug)) return c.json({ error: 'Invalid slug' }, 400)

  const { resolved } = await c.req.json()
  const feedbacks = getFeedbacks(slug)
  const feedback = feedbacks.find(f => f.id === id)
  if (!feedback) return c.json({ error: 'Not found' }, 404)

  feedback.status = resolved ? 'resolved' : 'open'
  feedback.resolvedAt = resolved ? new Date().toISOString() : null
  feedback.updatedAt = new Date().toISOString()
  saveFeedbacks(slug, feedbacks)
  return c.json({ ok: true })
})

app.delete('/api/projects/:slug/comments/:id', (c) => {
  const { slug, id } = c.req.param()
  if (!validSlug(slug)) return c.json({ error: 'Invalid slug' }, 400)

  const feedbacks = getFeedbacks(slug).filter(f => f.id !== id)
  saveFeedbacks(slug, feedbacks)
  return c.json({ ok: true })
})

// ── AI edit ───────────────────────────────────────────────────────────────────

app.post('/api/ai/edit', async (c) => {
  const { code, instruction, filename } = await c.req.json()
  if (!code || !instruction) return c.json({ error: 'code and instruction required' }, 400)

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 8192,
    messages: [{
      role: 'user',
      content: `Edit this web file per the instruction. Return ONLY the complete updated file content. No explanation, no markdown fences.

File: ${filename || 'index.html'}
Instruction: ${instruction}

Current code:
${code}`
    }]
  })

  const result = response.content[0].type === 'text' ? response.content[0].text : code
  return c.json({ result })
})

// ── Serve project pages ───────────────────────────────────────────────────────

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css',
  '.js': 'application/javascript', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.webp': 'image/webp',
}

app.get('/:slug', (c) => {
  const { slug } = c.req.param()
  if (!validSlug(slug)) return c.text('Not found', 404)

  const indexPath = join(DATA_DIR, slug, 'index.html')
  if (!existsSync(indexPath)) return c.text('Project not found', 404)

  const meta = getMeta(slug)
  if (meta.password) {
    const cookie = getCookie(c, `demo_${slug}`)
    if (cookie !== meta.password) return c.html(lockPage(slug))
  }

  const html = readFileSync(indexPath, 'utf-8')
  return c.html(injectSitePing(html, slug))
})

app.get('/:slug/:filename{.+}', (c) => {
  const { slug, filename } = c.req.param()
  if (!validSlug(slug)) return c.text('Not found', 404)

  const meta = getMeta(slug)
  if (meta.password) {
    const cookie = getCookie(c, `demo_${slug}`)
    if (cookie !== meta.password) return c.text('Unauthorized', 401)
  }

  const projectDir = join(DATA_DIR, slug)
  const filePath = safePath(projectDir, filename)
  if (!filePath || !existsSync(filePath)) return c.text('Not found', 404)

  const content = readFileSync(filePath)
  const ext = extname(filename).toLowerCase()
  return new Response(content, { headers: { 'Content-Type': MIME[ext] || 'application/octet-stream' } })
})

app.get('/', (c) => c.redirect('/admin'))

export default { port: Number(process.env.PORT) || 3000, fetch: app.fetch }
