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

// ── Comments ──────────────────────────────────────────────────────────────────

interface Comment { id: string; x: number; y: number; text: string; createdAt: string; resolved: boolean }

function getComments(slug: string): Comment[] {
  const p = join(DATA_DIR, slug, '_comments.json')
  if (!existsSync(p)) return []
  try { return JSON.parse(readFileSync(p, 'utf-8')) } catch { return [] }
}

function saveComments(slug: string, comments: Comment[]) {
  writeFileSync(join(DATA_DIR, slug, '_comments.json'), JSON.stringify(comments), 'utf-8')
}

// ── Annotation script (injected into every served page) ───────────────────────

const ANNOTATION_JS = `(function(){
'use strict';
if(document.getElementById('__da'))return;
var SL='__SLUG__',BA=location.origin,mode=false,pins=[];
var st=document.createElement('style');
st.textContent='#__da{position:fixed;bottom:20px;right:20px;z-index:999999;font-family:-apple-system,sans-serif}'
+'#__dab{width:42px;height:42px;border-radius:50%;background:#1e1e2e;border:2px solid #45475a;color:#cdd6f4;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 14px rgba(0,0,0,.4);transition:all .2s}'
+'#__dab:hover{background:#313244}#__dab.on{background:#89b4fa;color:#1e1e2e;border-color:#89b4fa}'
+'.__dp{position:fixed;width:26px;height:26px;border-radius:50% 50% 50% 0;background:#89b4fa;color:#1e1e2e;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;transform:rotate(-45deg) translate(-50%,-50%);cursor:pointer;z-index:999990;box-shadow:0 2px 8px rgba(0,0,0,.3)}'
+'.__dp:hover{filter:brightness(1.15)}.__dp span{transform:rotate(45deg);display:block}'
+'.__dpp{position:fixed;background:#1e1e2e;border:1px solid #313244;border-radius:10px;padding:12px;width:240px;z-index:999999;box-shadow:0 8px 24px rgba(0,0,0,.5)}'
+'.__dpp textarea{width:100%;background:#313244;border:1px solid #45475a;border-radius:6px;color:#cdd6f4;padding:8px;font-size:13px;resize:none;height:80px;outline:none;box-sizing:border-box;font-family:inherit}'
+'.__dpp textarea:focus{border-color:#89b4fa}.__dff{display:flex;gap:6px;margin-top:8px}'
+'.__dff button{flex:1;padding:6px;border-radius:6px;border:none;font-size:12px;cursor:pointer;font-weight:500}'
+'.__ds{background:#89b4fa;color:#1e1e2e}.__ds:hover{background:#74c7ec}.__dc{background:#313244;color:#cdd6f4}'
+'.__tip{position:fixed;background:#1e1e2e;border:1px solid #313244;border-radius:8px;padding:8px 12px;max-width:200px;font-size:12px;color:#cdd6f4;z-index:999998;pointer-events:none;box-shadow:0 4px 12px rgba(0,0,0,.3)}'
+'body.__cx,body.__cx *{cursor:crosshair!important}';
document.head.appendChild(st);
var ui=document.createElement('div');ui.id='__da';
var btn=document.createElement('button');btn.id='__dab';btn.title='Dodaj komentarz';btn.textContent='💬';
ui.appendChild(btn);document.body.appendChild(ui);
btn.addEventListener('click',function(e){e.stopPropagation();mode=!mode;btn.classList.toggle('on',mode);document.body.classList.toggle('__cx',mode);});
document.addEventListener('click',function(e){
  if(!mode)return;
  if(e.target.closest('#__da')||e.target.closest('.__dpp'))return;
  var x=e.clientX/window.innerWidth,y=e.clientY/window.innerHeight;
  mode=false;btn.classList.remove('on');document.body.classList.remove('__cx');
  showInput(e.clientX,e.clientY,x,y);
},true);
function showInput(ax,ay,rx,ry){
  document.querySelectorAll('.__dpp').forEach(function(el){el.remove();});
  var pop=document.createElement('div');pop.className='__dpp';
  var l=ax+12,t=ay+12;
  if(l+250>window.innerWidth)l=ax-260;
  if(t+150>window.innerHeight)t=ay-160;
  pop.style.left=l+'px';pop.style.top=t+'px';
  var ta=document.createElement('textarea');ta.placeholder='Opisz co chcesz zmienić...';
  var ff=document.createElement('div');ff.className='__dff';
  var sb=document.createElement('button');sb.className='__ds';sb.textContent='Wyślij ↵';
  var cb=document.createElement('button');cb.className='__dc';cb.textContent='Anuluj';
  ff.appendChild(sb);ff.appendChild(cb);pop.appendChild(ta);pop.appendChild(ff);
  document.body.appendChild(pop);ta.focus();
  sb.addEventListener('click',function(){
    var txt=ta.value.trim();if(!txt)return;
    sb.textContent='...';sb.disabled=true;
    fetch(BA+'/comment/'+SL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({x:rx,y:ry,text:txt})})
      .then(function(){pop.remove();load();}).catch(function(){sb.textContent='Wyślij ↵';sb.disabled=false;});
  });
  cb.addEventListener('click',function(){pop.remove();});
  ta.addEventListener('keydown',function(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sb.click();}if(e.key==='Escape')pop.remove();});
}
function renderPins(){
  document.querySelectorAll('.__dp,.__tip').forEach(function(el){el.remove();});
  var n=0;
  pins.forEach(function(c){
    if(c.resolved)return;n++;
    var pin=document.createElement('div');pin.className='__dp';
    pin.style.left=(c.x*window.innerWidth)+'px';pin.style.top=(c.y*window.innerHeight)+'px';
    var sp=document.createElement('span');sp.textContent=n;pin.appendChild(sp);
    var tip=null;
    pin.addEventListener('mouseenter',function(){
      tip=document.createElement('div');tip.className='__tip';tip.textContent=c.text;
      tip.style.left=(c.x*window.innerWidth+20)+'px';tip.style.top=(c.y*window.innerHeight)+'px';
      document.body.appendChild(tip);
    });
    pin.addEventListener('mouseleave',function(){if(tip){tip.remove();tip=null;}});
    document.body.appendChild(pin);
  });
}
function load(){
  fetch(BA+'/comments/'+SL).then(function(r){return r.json();}).then(function(d){pins=d;renderPins();}).catch(function(){});
}
window.addEventListener('resize',renderPins);
load();
})();`

function injectScript(html: string, slug: string): string {
  const script = `<script>${ANNOTATION_JS.replace(/__SLUG__/g, slug)}</script>`
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

// ── Public: add comment (called from annotation script on client page) ─────────

app.post('/comment/:slug', async (c) => {
  const { slug } = c.req.param()
  if (!validSlug(slug)) return c.json({ error: 'Not found' }, 404)
  if (!existsSync(join(DATA_DIR, slug))) return c.json({ error: 'Not found' }, 404)

  const { x, y, text } = await c.req.json()
  if (!text || typeof x !== 'number' || typeof y !== 'number') return c.json({ error: 'Invalid' }, 400)

  const comments = getComments(slug)
  const comment: Comment = {
    id: randomUUID(),
    x: Math.min(Math.max(x, 0), 1),
    y: Math.min(Math.max(y, 0), 1),
    text: String(text).slice(0, 1000),
    createdAt: new Date().toISOString(),
    resolved: false,
  }
  comments.push(comment)
  saveComments(slug, comments)
  return c.json({ ok: true, id: comment.id })
})

// ── Public: get active comments (loaded by annotation script) ─────────────────

app.get('/comments/:slug', (c) => {
  const { slug } = c.req.param()
  if (!validSlug(slug)) return c.json([])
  const comments = getComments(slug).filter(cm => !cm.resolved)
  return c.json(comments)
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
      const comments = getComments(d.name)
      const meta = getMeta(d.name)
      return {
        slug: d.name,
        files,
        commentCount: comments.filter(cm => !cm.resolved).length,
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

// ── Comments (admin) ──────────────────────────────────────────────────────────

app.get('/api/projects/:slug/comments', (c) => {
  const { slug } = c.req.param()
  if (!validSlug(slug)) return c.json({ error: 'Invalid slug' }, 400)
  return c.json(getComments(slug))
})

app.patch('/api/projects/:slug/comments/:id', async (c) => {
  const { slug, id } = c.req.param()
  if (!validSlug(slug)) return c.json({ error: 'Invalid slug' }, 400)

  const { resolved } = await c.req.json()
  const comments = getComments(slug)
  const comment = comments.find(cm => cm.id === id)
  if (!comment) return c.json({ error: 'Not found' }, 404)

  comment.resolved = Boolean(resolved)
  saveComments(slug, comments)
  return c.json({ ok: true })
})

app.delete('/api/projects/:slug/comments/:id', (c) => {
  const { slug, id } = c.req.param()
  if (!validSlug(slug)) return c.json({ error: 'Invalid slug' }, 400)

  const comments = getComments(slug).filter(cm => cm.id !== id)
  saveComments(slug, comments)
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

  // Password check
  const meta = getMeta(slug)
  if (meta.password) {
    const cookie = getCookie(c, `demo_${slug}`)
    if (cookie !== meta.password) return c.html(lockPage(slug))
  }

  const html = readFileSync(indexPath, 'utf-8')
  return c.html(injectScript(html, slug))
})

app.get('/:slug/:filename{.+}', (c) => {
  const { slug, filename } = c.req.param()
  if (!validSlug(slug)) return c.text('Not found', 404)

  // Password check for sub-files too
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
