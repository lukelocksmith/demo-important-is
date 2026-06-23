import { initSiteping } from '@siteping/widget'
import { StoreNotFoundError } from '@siteping/core'
import type {
  SitepingStore,
  FeedbackCreateInput,
  FeedbackRecord,
  FeedbackPage,
  FeedbackQuery,
  FeedbackUpdateInput,
} from '@siteping/core'

function createDemoStore(slug: string): SitepingStore {
  const base = location.origin

  return {
    async createFeedback(data: FeedbackCreateInput): Promise<FeedbackRecord> {
      const res = await fetch(`${base}/sp/feedback/${slug}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json()
    },

    async getFeedbacks(query: FeedbackQuery): Promise<FeedbackPage> {
      const p = new URLSearchParams({ page: String(query.page ?? 1), limit: String(query.limit ?? 50) })
      if (query.status) p.set('status', query.status)
      if (query.type) p.set('type', query.type)
      if (query.search) p.set('search', query.search)
      const res = await fetch(`${base}/sp/feedbacks/${slug}?${p}`)
      if (!res.ok) return { feedbacks: [], total: 0 }
      return res.json()
    },

    async findByClientId(clientId: string): Promise<FeedbackRecord | null> {
      const res = await fetch(`${base}/sp/feedback/${slug}/client/${encodeURIComponent(clientId)}`)
      if (res.status === 404) return null
      return res.json()
    },

    async updateFeedback(id: string, data: FeedbackUpdateInput): Promise<FeedbackRecord> {
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
    store: createDemoStore(slug),
    projectName: slug,
    position: 'bottom-right',
    identity: { name: 'Client', email: 'client@demo.important.is' },
    enableScreenshot: true,
    captureDiagnostics: { console: true, network: true },
  })
}
