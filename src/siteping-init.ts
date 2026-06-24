import { initSiteping } from '@siteping/widget'

declare global {
  interface Window { initDemoSiteping(slug: string): void }
}

window.initDemoSiteping = function (slug: string) {
  initSiteping({
    endpoint: `${location.origin}/sp/${slug}`,
    projectName: slug,
    position: 'bottom-right',
    identity: { name: 'Client', email: 'client@demo.important.is' },
    enableScreenshot: true,
    captureDiagnostics: { console: true, network: true },
  })
}
