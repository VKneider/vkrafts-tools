// StorageService — small values the browser keeps for the app: preferences,
// the last filters, a draft, a dismissed banner.
//
//   const prefs = await slice.build('StorageService', { singleton: true, sliceId: 'prefs', namespace: 'my-app' });
//   prefs.set('theme', 'dark');
//   prefs.get('theme', 'light');                      // 'dark', or 'light' when there is none
//   prefs.set('draft', text, { ttl: 24 * 3600_000 }); // forgotten after a day
//   prefs.watch('theme', this, (theme) => …);         // now, on every change, and from other tabs
//
// What it adds to localStorage / sessionStorage:
//   - values go in and come out as they were (JSON), not as strings;
//   - a namespace, so two apps on the same origin do not share keys, and
//     clear() removes only this app's;
//   - an expiry per value (ttl);
//   - a full storage (QuotaExceededError) is a `false` and a warning, not an
//     exception in the middle of a click;
//   - watch(): the same tab AND other tabs (the `storage` event), stopped when
//     the component is destroyed;
//   - storage the browser refuses (some private modes, blocked cookies) falls
//     back to memory for the session, with one warning, instead of throwing on
//     every call.
//
// For many records, or anything to query, use IndexedDbManager. For state the
// app's components share while it runs, slice.context (with `persist: true` if
// it must survive a reload).

const AREAS = ['local', 'session'];
// A value with an expiry is kept as { [EXPIRES]: ms, value }.
const EXPIRES = '__sliceExpires';
const MISSING = Symbol('missing');

// Every StorageService in the page: a write in one tells the watchers of the
// others (the `storage` event only reaches OTHER tabs).
const instances = new Set();
const unavailableWarned = new Set();

// In-memory stand-in with the Storage API, for when the browser refuses.
class MemoryStorage {
   constructor() { this._map = new Map(); }
   get length() { return this._map.size; }
   key(index) { return [...this._map.keys()][index] ?? null; }
   getItem(key) { return this._map.has(key) ? this._map.get(key) : null; }
   setItem(key, value) { this._map.set(key, String(value)); }
   removeItem(key) { this._map.delete(key); }
   clear() { this._map.clear(); }
}
const memoryAreas = { local: new MemoryStorage(), session: new MemoryStorage() };

function isQuotaError(error) {
   return error instanceof DOMException
      && (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED' || error.code === 22);
}

export default class StorageService {
   /**
    * @param {{ area?: 'local' | 'session', namespace?: string }} [props]
    */
   constructor(props = {}) {
      const options = props || {};
      this.area = AREAS.includes(options.area) ? options.area : 'local';
      this.namespace = typeof options.namespace === 'string' ? options.namespace : '';
      /** @type {Map<string, Map<object, any>>} key → watchers */
      this._watchers = new Map();
      this._storage = null;

      this._onStorage = (event) => {
         if (event.storageArea !== this._backend()) return;
         // key null: the other tab cleared everything.
         if (event.key === null) {
            for (const key of this._watchers.keys()) this._notify(key);
            return;
         }
         const key = this._ownKey(event.key);
         if (key !== null) this._notify(key);
      };
   }

   init() {
      instances.add(this);
      window.addEventListener('storage', this._onStorage);
      this.purge();
   }

   beforeDestroy() {
      instances.delete(this);
      window.removeEventListener('storage', this._onStorage);
      this._watchers.clear();
   }

   // ── Values ──────────────────────────────────────────────────────

   /** The value of `key`, or `fallback` when there is none (or it expired). */
   get(key, fallback = null) {
      const value = this._read(key);
      return value === MISSING ? fallback : value;
   }

   /**
    * Keep `value` under `key`. `undefined` removes it. With `ttl` (ms) it is
    * forgotten after that time. Returns false when it could not be kept (the
    * storage is full).
    * @param {string} key
    * @param {any} value
    * @param {{ ttl?: number }} [options]
    */
   set(key, value, { ttl } = {}) {
      if (value === undefined) return this.remove(key);
      const stored = Number.isFinite(ttl) && ttl > 0 ? { [EXPIRES]: Date.now() + ttl, value } : value;
      let text;
      try {
         text = JSON.stringify(stored);
      } catch (error) {
         slice.logger.error('StorageService', `"${key}" cannot be kept: it is not JSON (a cycle, a BigInt…).`, error);
         return false;
      }
      try {
         this._backend().setItem(this._fullKey(key), text);
      } catch (error) {
         if (!isQuotaError(error)) throw error;
         slice.logger.warn('StorageService', `The ${this.area} storage is full: "${key}" was not kept. Remove old values, or use IndexedDbManager for large data.`);
         return false;
      }
      this._broadcast(key);
      return true;
   }

   /**
    * set(key, updater(current)): change a value from what it is. (Not
    * `update`: that name is Slice's lifecycle hook.)
    */
   change(key, updater, fallback = null, options) {
      return this.set(key, updater(this.get(key, fallback)), options);
   }

   remove(key) {
      this._backend().removeItem(this._fullKey(key));
      this._broadcast(key);
      return true;
   }

   has(key) {
      return this._read(key) !== MISSING;
   }

   /** The keys of this namespace (without the prefix), expired ones left out. */
   keys() {
      return this._ownKeys().filter((key) => this.has(key));
   }

   /**
    * Remove every value of this namespace. Without a namespace, the whole
    * storage of the origin: give the service a namespace if other code shares it.
    */
   clear() {
      if (!this.namespace) {
         this._backend().clear();
      } else {
         for (const key of this._ownKeys()) this._backend().removeItem(this._fullKey(key));
      }
      for (const key of this._watchers.keys()) this._broadcast(key);
      return true;
   }

   /** Remove the expired values of this namespace (also done when it starts). */
   purge() {
      for (const key of this._ownKeys()) this._read(key);
   }

   /**
    * Call `callback(value)` now and whenever `key` changes, here or in another
    * tab, until `component` is destroyed. Returns a function to stop sooner.
    */
   watch(key, component, callback, fallback = null) {
      if (!component?.sliceId) throw new Error('watch(key, component, callback) needs a Slice component, to stop when it is destroyed.');
      if (typeof callback !== 'function') throw new Error('watch(key, component, callback) needs a callback.');
      if (!this._watchers.has(key)) this._watchers.set(key, new Map());
      const observer = { component, callback, fallback };
      this._watchers.get(key).set(observer, component);
      callback(this.get(key, fallback));
      return () => { this._watchers.get(key)?.delete(observer); };
   }

   // ── Inside ──────────────────────────────────────────────────────

   _fullKey(key) {
      return this.namespace ? `${this.namespace}:${key}` : String(key);
   }

   // The key without this namespace's prefix, or null when it is another's.
   _ownKey(fullKey) {
      if (!this.namespace) return fullKey;
      const prefix = `${this.namespace}:`;
      return fullKey.startsWith(prefix) ? fullKey.slice(prefix.length) : null;
   }

   _ownKeys() {
      const storage = this._backend();
      const keys = [];
      for (let i = 0; i < storage.length; i += 1) {
         const own = this._ownKey(storage.key(i));
         if (own !== null) keys.push(own);
      }
      return keys;
   }

   _read(key) {
      const text = this._backend().getItem(this._fullKey(key));
      if (text === null) return MISSING;
      let value;
      try {
         value = JSON.parse(text);
      } catch {
         return text;   // written as plain text by other code: give it as it is
      }
      if (value && typeof value === 'object' && EXPIRES in value) {
         if (Date.now() >= value[EXPIRES]) {
            this._backend().removeItem(this._fullKey(key));
            return MISSING;
         }
         return value.value;
      }
      return value;
   }

   // window.localStorage / sessionStorage, or memory when the browser refuses.
   _backend() {
      if (this._storage) return this._storage;
      try {
         const storage = window[`${this.area}Storage`];
         const probe = '__slice_storage_probe__';
         storage.setItem(probe, '1');
         storage.removeItem(probe);
         this._storage = storage;
      } catch (error) {
         // A full storage still works for reading: only a refusal falls back.
         if (isQuotaError(error)) {
            this._storage = window[`${this.area}Storage`];
         } else {
            if (!unavailableWarned.has(this.area)) {
               unavailableWarned.add(this.area);
               slice.logger.warn('StorageService', `The browser does not allow ${this.area}Storage here; values are kept in memory until the page closes.`);
            }
            this._storage = memoryAreas[this.area];
         }
      }
      return this._storage;
   }

   // Tell the watchers of `key` in every StorageService of this page that
   // shares the same storage and namespace.
   _broadcast(key) {
      const fullKey = this._fullKey(key);
      for (const service of instances) {
         if (service._backend() !== this._backend()) continue;
         const own = service._ownKey(fullKey);
         if (own !== null) service._notify(own);
      }
      if (!instances.has(this)) this._notify(key);
   }

   _notify(key) {
      const watchers = this._watchers.get(key);
      if (!watchers) return;
      for (const [observer, component] of [...watchers]) {
         // Gone with its component (the same check slice.events makes).
         if (slice.controller.activeComponents.get(component.sliceId) !== component) {
            watchers.delete(observer);
            continue;
         }
         try {
            observer.callback(this.get(key, observer.fallback));
         } catch (error) {
            slice.logger.error('StorageService', `A watcher of "${key}" failed`, error);
         }
      }
      if (!watchers.size) this._watchers.delete(key);
   }
}