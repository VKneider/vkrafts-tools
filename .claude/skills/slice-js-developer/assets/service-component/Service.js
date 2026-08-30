/**
 * SLICE_TEMPLATE: Service Component
 *
 * A Service is a plain ES class — no HTMLElement, no static props, no lifecycle hooks,
 * no customElements.define. Slice still builds it via slice.build('MyService', ...).
 *
 * Common uses:
 *   - API clients (fetch wrappers with auth headers)
 *   - Persistence helpers (localStorage, IndexedDB)
 *   - Business logic / domain services
 *   - Cross-cutting utilities (analytics, formatters)
 *
 * Build once at app startup with a stable sliceId:
 *   const auth = await slice.build('AuthService', { sliceId: 'AuthService' });
 *   // Anywhere later:
 *   slice.controller.getComponent('AuthService');
 */

export default class MyService {
  constructor(props = {}) {
    // Service constructors receive whatever was passed to slice.build, minus id/sliceId
    this.baseUrl = props.baseUrl ?? slice.getEnv('SLICE_PUBLIC_API_URL', '/api');
    this.token = null;
  }

  // ──────────────────────────────────────────────────────────────────
  // Public methods
  // ──────────────────────────────────────────────────────────────────

  async fetchSomething(id) {
    try {
      const res = await fetch(`${this.baseUrl}/something/${id}`, {
        headers: this.buildHeaders()
      });
      if (!res.ok) {
        slice.logger.logWarning('MyService', `fetchSomething(${id}) → ${res.status}`);
        return null;
      }
      const data = await res.json();
      slice.logger.logInfo('MyService', `Fetched something ${id}`);
      return data;
    } catch (error) {
      slice.logger.logError('MyService', `fetchSomething(${id}) failed`, error);
      throw error;
    }
  }

  setToken(token) {
    this.token = token;
    slice.events.emit('myservice:token-changed', { hasToken: !!token });
  }

  // ──────────────────────────────────────────────────────────────────
  // Private helpers
  // ──────────────────────────────────────────────────────────────────

  buildHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    return headers;
  }
}
