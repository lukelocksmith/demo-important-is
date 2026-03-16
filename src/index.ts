import { Hono } from 'hono'
import { basicAuth } from 'hono/basic-auth'
import Anthropic from '@anthropic-ai/sdk'
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync, statSync } from 'fs'
import { join, extname, basename, resolve } from 'path'
import JSZip from 'jszip'

const app = new Hono()

const DATA_DIR = resolve(process.env.DATA_DIR || '/data/projects')
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin'
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

mkdirSync(DATA_DIR, { recursive: true })

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

const auth = basicAuth({ username: 'admin', password: ADMIN_PASSWORD })

// Admin panel
app.use('/admin', auth)
app.get('/admin', (c) => {
  const html = readFileSync(join(import.meta.dir, 'admin.html'), 'utf-8')
  return c.html(html)
})

// All API routes protected
app.use('/api/*', auth)

// List projects
app.get('/api/projects', (c) => {
  if (!existsSync(DATA_DIR)) return c.json([])
  const projects = readdirSync(DATA_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => {
      const files = readdirSync(join(DATA_DIR, d.name)).filter(f => {
        try { return statSync(join(DATA_DIR, d.name, f)).isFile() } catch { return false }
      })
      return { slug: d.name, files }
    })
  return c.json(projects)
})

// Create from HTML paste
app.post('/api/projects/paste', async (c) => {
  const { slug, html } = await c.req.json()
  if (!slug || !validSlug(slug)) return c.json({ error: 'Invalid slug (lowercase letters, numbers, hyphens only)' }, 400)
  if (!html) return c.json({ error: 'html required' }, 400)

  const projectDir = join(DATA_DIR, slug)
  mkdirSync(projectDir, { recursive: true })
  writeFileSync(join(projectDir, 'index.html'), html, 'utf-8')
  return c.json({ slug, url: `/${slug}` })
})

// Create from ZIP upload
app.post('/api/projects/upload', async (c) => {
  const formData = await c.req.formData()
  const slug = (formData.get('slug') as string)?.trim().toLowerCase()
  const file = formData.get('file') as File

  if (!slug || !validSlug(slug)) return c.json({ error: 'Invalid slug' }, 400)
  if (!file) return c.json({ error: 'file required' }, 400)

  const arrayBuffer = await file.arrayBuffer()
  const zip = await JSZip.loadAsync(arrayBuffer)

  const projectDir = join(DATA_DIR, slug)
  mkdirSync(projectDir, { recursive: true })

  const promises: Promise<void>[] = []
  zip.forEach((relativePath, zipEntry) => {
    if (!zipEntry.dir) {
      const filename = basename(relativePath)
      if (validFilename(filename)) {
        promises.push(
          zipEntry.async('uint8array').then(data => {
            writeFileSync(join(projectDir, filename), data)
          })
        )
      }
    }
  })
  await Promise.all(promises)
  return c.json({ slug, url: `/${slug}` })
})

// Get project files with content
app.get('/api/projects/:slug', (c) => {
  const { slug } = c.req.param()
  if (!validSlug(slug)) return c.json({ error: 'Invalid slug' }, 400)

  const projectDir = join(DATA_DIR, slug)
  if (!existsSync(projectDir)) return c.json({ error: 'Not found' }, 404)

  const textExts = new Set(['.html', '.css', '.js', '.ts', '.json', '.txt', '.svg', '.xml', '.md'])
  const files = readdirSync(projectDir)
    .filter(name => {
      try { return statSync(join(projectDir, name)).isFile() } catch { return false }
    })
    .map(name => {
      const ext = extname(name).toLowerCase()
      return {
        name,
        content: textExts.has(ext) ? readFileSync(join(projectDir, name), 'utf-8') : '[binary]'
      }
    })
  return c.json({ slug, files })
})

// Save file in project
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

// Delete project
app.delete('/api/projects/:slug', (c) => {
  const { slug } = c.req.param()
  if (!validSlug(slug)) return c.json({ error: 'Invalid slug' }, 400)

  const projectDir = join(DATA_DIR, slug)
  if (existsSync(projectDir)) rmSync(projectDir, { recursive: true, force: true })
  return c.json({ ok: true })
})

// AI edit endpoint
app.post('/api/ai/edit', async (c) => {
  const { code, instruction, filename } = await c.req.json()
  if (!code || !instruction) return c.json({ error: 'code and instruction required' }, 400)

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 8192,
    messages: [{
      role: 'user',
      content: `Edit this web file per the instruction. Return ONLY the complete updated file content. No explanation, no markdown code fences, no commentary.

File: ${filename || 'index.html'}
Instruction: ${instruction}

Current code:
${code}`
    }]
  })

  const result = response.content[0].type === 'text' ? response.content[0].text : code
  return c.json({ result })
})

// Serve project static files
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.webp': 'image/webp',
}

app.get('/:slug', (c) => {
  const { slug } = c.req.param()
  if (!validSlug(slug)) return c.text('Not found', 404)

  const indexPath = join(DATA_DIR, slug, 'index.html')
  if (!existsSync(indexPath)) return c.text('Project not found', 404)

  const content = readFileSync(indexPath)
  return new Response(content, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
})

app.get('/:slug/:filename{.+}', (c) => {
  const { slug, filename } = c.req.param()
  if (!validSlug(slug)) return c.text('Not found', 404)

  const projectDir = join(DATA_DIR, slug)
  const filePath = safePath(projectDir, filename)
  if (!filePath || !existsSync(filePath)) return c.text('Not found', 404)

  const content = readFileSync(filePath)
  const ext = extname(filename).toLowerCase()
  return new Response(content, { headers: { 'Content-Type': MIME[ext] || 'application/octet-stream' } })
})

app.get('/', (c) => c.redirect('/admin'))

export default {
  port: Number(process.env.PORT) || 3000,
  fetch: app.fetch,
}
