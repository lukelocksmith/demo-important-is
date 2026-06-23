import { initSiteping } from '@siteping/widget'

// Types defined inline — @siteping/core is not published on npm separately
class StoreNotFoundError extends Error {
  constructor(message: string) { super(message); this.name = 'StoreNotFoundError' }
}

interface Annotation {
  id?: string; feedbackId?: string
  cssSelector: string; xpath: string; textSnippet: string
  elementTag: string; elementId?: string | null
  textPrefix: string; textSuffix: string; fingerprint: string
  neighborText: string; anchorKey?: string | null
  xPct: number; yPct: number; wPct: number; hPct: number
  scrollX: number; scrollY: number; viewportW: number; viewportH: number; devicePixelRatio: number
  createdAt?: string
}

interface Feedback {
  id: string; clientId: string; projectName: string
  type: string; message: string; status: string
  url: string; urlPattern?: string | null
  authorName: string; authorEmail: string
  viewport: string; userAgent: string
  resolvedAt?: string | null; createdAt: string; updatedAt: string
  annotations: Annotation[]
  screenshotUrl?: string | null; diagnostics?: unknown
}

interface FeedbackPage { feedbacks: Feedback[]; total: number }

function createDemoStore(slug: string) {
  const base = location.origin

  return {
    async createFeedback(data: Record<string, unknown>): Promise<Feedback> {
      const res = await fetch(`${base}/sp/feedback/${slug}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json()
    },

    async getFeedbacks(query: Record<string, unknown>): Promise<FeedbackPage> {
      const p = new URLSearchParams({ page: String(query.page ?? 1), limit: String(query.limit ?? 50) })
      if (query.status) p.set('status', String(query.status))
      if (query.type) p.set('type', String(query.type))
      if (query.search) p.set('search', String(query.search))
      const res = await fetch(`${base}/sp/feedbacks/${slug}?${p}`)
      if (!res.ok) return { feedbacks: [], total: 0 }
      return res.json()
    },

    async findByClientId(clientId: string): Promise<Feedback | null> {
      const res = await fetch(`${base}/sp/feedback/${slug}/client/${encodeURIComponent(clientId)}`)
      if (res.status === 404) return null
      return res.json()
    },

    async updateFeedback(id: string, data: Record<string, unknown>): Promise<Feedback> {
      const res = await fetch(`${base}/sp/feedback/${slug}/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (res.status === 404) throw new StoreNotFoundError(`Not found: ${id}`)
      return res.json()
    },

    async deleteFeedback(id: string): Promise<void> {
      const res = await fetch(`${base}/sp/feedback/${slug}/${id}`, { method: 'DELETE' })
      if (res.status === 404) throw new StoreNotFoundError(`Not found: ${id}`)
    },

    async deleteAllFeedbacks(_: string): Promise<void> {
      await fetch(`${base}/sp/feedbacks/${slug}`, { method: 'DELETE' })
    },
  }
}

declare global {
  interface Window { initDemoSiteping(slug: string): void }
}

window.initDemoSiteping = function (slug: string) {
  initSiteping({
    store: createDemoStore(slug) as any,
    projectName: slug,
    position: 'bottom-right',
    identity: { name: 'Client', email: 'client@demo.important.is' },
    enableScreenshot: true,
    captureDiagnostics: { console: true, network: true },
  })
}
