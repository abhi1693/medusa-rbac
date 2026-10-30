import "@testing-library/jest-dom/vitest"
import { afterEach, vi } from "vitest"
import { cleanup } from "@testing-library/react"

// Public Dashboard components receive these compile-time globals from Medusa's
// Vite bundler. Neutral values preserve the normal SDK defaults in jsdom.
Object.assign(globalThis, {
  __BASE__: "/app",
  __BACKEND_URL__: undefined,
  __AUTH_TYPE__: undefined,
  __JWT_TOKEN_STORAGE_KEY__: undefined,
  __MAX_UPLOAD_FILE_SIZE__: undefined,
  __STOREFRONT_URL__: undefined,
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
}
// The native paginated Combobox observes its list sentinel; jsdom has no layout observer.
globalThis.IntersectionObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof IntersectionObserver
window.HTMLElement.prototype.scrollIntoView = () => {}
window.HTMLElement.prototype.scroll = () => {}
window.HTMLElement.prototype.hasPointerCapture = () => false
window.HTMLElement.prototype.setPointerCapture = () => {}
window.HTMLElement.prototype.releasePointerCapture = () => {}
window.matchMedia = (query) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener() {},
  removeListener() {},
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent: () => true,
})
