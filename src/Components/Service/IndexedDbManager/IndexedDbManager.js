// IndexedDbManager — a database in the browser: many records, several stores,
// indexes to find them, and changes that happen together or not at all.
//
//   const db = await slice.build('IndexedDbManager', {
//     singleton: true, sliceId: 'db',
//     databaseName: 'my-app',
//     stores: {
//       notes: { keyPath: 'id', autoIncrement: true, indexes: { byUpdated: 'updatedAt', byTag: { keyPath: 'tags', multiEntry: true } } },
//       settings: { keyPath: 'key' },
//     },
//   });
//
//   const id = await db.store('notes').add({ title: 'Ideas', tags: ['work'], updatedAt: Date.now() });
//   const recent = await db.store('notes').query({ index: 'byUpdated', direction: 'prev', limit: 20 });
//   await db.transaction(['notes', 'settings'], 'readwrite', async ({ notes, settings }) => {
//     await notes.delete(id);
//     await settings.put({ key: 'lastDeleted', value: id });
//   });                                     // both, or neither
//
// What it takes care of:
//   - ONE connection, opened on first use and shared by every call;
//   - the stores and indexes you declare exist: created the first time, and
//     added later (a new store, a new index) without losing what is there;
//   - `version` + `upgrade(db, oldVersion, newVersion, tx)` when you need to
//     move data between versions yourself;
//   - another tab upgrading the database: this connection steps aside and
//     opens again on the next call, instead of blocking it;
//   - requests as promises, cursors as query({ index, from, to, limit… }).
//
// The old API (addItem, getItem, updateItem, deleteItem, getAllItems,
// clearItems on one store) still works and warns once that it is deprecated.

let warnedLegacy = false;

function promisify(request) {
   return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
   });
}

function finished(tx) {
   return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve(undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new DOMException('The transaction was aborted.', 'AbortError'));
   });
}

// { notes: { indexes: { byTag: 'tag' } } } or ['notes'] → full definitions.
function normalizeStores(stores, storeName) {
   const out = {};
   const list = Array.isArray(stores)
      ? stores.map((name) => [name, {}])
      : Object.entries(stores && typeof stores === 'object' ? stores : {});
   if (!list.length && storeName) list.push([storeName, {}]);
   for (const [name, def = {}] of list) {
      const keyPath = def.keyPath === undefined ? 'id' : def.keyPath;
      const indexes = {};
      for (const [indexName, index] of Object.entries(def.indexes || {})) {
         indexes[indexName] = typeof index === 'string' || Array.isArray(index)
            ? { keyPath: index, unique: false, multiEntry: false }
            : { keyPath: index.keyPath ?? indexName, unique: !!index.unique, multiEntry: !!index.multiEntry };
      }
      out[name] = {
         keyPath,
         // An auto key by default only when the key is the default `id`.
         autoIncrement: def.autoIncrement ?? (def.keyPath === undefined),
         indexes,
      };
   }
   return out;
}

// query({ equals }) / ({ from, to, excludeFrom, excludeTo }) → IDBKeyRange.
/** @param {{ equals?: any, from?: any, to?: any, excludeFrom?: boolean, excludeTo?: boolean }} range */
function toRange({ equals, from, to, excludeFrom = false, excludeTo = false }) {
   if (equals !== undefined) return IDBKeyRange.only(equals);
   if (from !== undefined && to !== undefined) return IDBKeyRange.bound(from, to, excludeFrom, excludeTo);
   if (from !== undefined) return IDBKeyRange.lowerBound(from, excludeFrom);
   if (to !== undefined) return IDBKeyRange.upperBound(to, excludeTo);
   return undefined;
}

// An object store inside a transaction, with promises.
function wrapStore(store) {
   return {
      name: store.name,
      get: (key) => promisify(store.get(key)),
      getAll: (query, count) => promisify(store.getAll(query, count)),
      getAllKeys: (query, count) => promisify(store.getAllKeys(query, count)),
      count: (query) => promisify(store.count(query)),
      /** Insert; fails if the key exists. Resolves with the key. */
      add: (value, key) => promisify(key === undefined ? store.add(value) : store.add(value, key)),
      /** Insert or replace. Resolves with the key. */
      put: (value, key) => promisify(key === undefined ? store.put(value) : store.put(value, key)),
      delete: (keyOrRange) => promisify(store.delete(keyOrRange)).then(() => undefined),
      clear: () => promisify(store.clear()).then(() => undefined),
      /**
       * Records in key or index order.
       * { index, equals | from/to (excludeFrom, excludeTo), direction: 'next'|'prev',
       *   filter(value), offset, limit }
       */
      query(options = {}) {
         const { index, direction = 'next', filter, offset = 0, limit = Infinity } = options;
         const source = index ? store.index(index) : store;
         return new Promise((resolve, reject) => {
            const out = [];
            let skipped = 0;
            const request = source.openCursor(toRange(options), direction);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
               const cursor = request.result;
               if (!cursor || out.length >= limit) {
                  resolve(out);
                  return;
               }
               if (!filter || filter(cursor.value)) {
                  if (skipped < offset) skipped += 1;
                  else out.push(cursor.value);
               }
               if (out.length >= limit) resolve(out);
               else cursor.continue();
            };
         });
      },
   };
}

/**
 * @typedef {string | string[] | { keyPath?: string | string[], unique?: boolean, multiEntry?: boolean }} IndexDefinition
 * @typedef {{ keyPath?: string | string[] | null, autoIncrement?: boolean, indexes?: Record<string, IndexDefinition> }} StoreDefinition
 * @typedef {{
 *   databaseName?: string,
 *   version?: number,
 *   stores?: Record<string, StoreDefinition> | string[],
 *   storeName?: string,
 *   upgrade?: (db: IDBDatabase, oldVersion: number, newVersion: number | null, tx: IDBTransaction) => void,
 * }} IndexedDbOptions
 */

export default class IndexedDbManager {
   /** @param {IndexedDbOptions | string} [props] */
   constructor(props = {}) {
      // The old positional form: new IndexedDbManager(databaseName, storeName).
      /** @type {IndexedDbOptions} */
      const options = typeof props === 'string' ? { databaseName: props, storeName: arguments[1] } : (props || {});
      this.databaseName = options.databaseName || '';
      this.version = Number.isInteger(options.version) && options.version > 0 ? options.version : undefined;
      this.stores = normalizeStores(options.stores, options.storeName);
      // The store used when none is named (and by the old API).
      this.storeName = options.storeName || Object.keys(this.stores)[0] || '';
      this.upgrade = typeof options.upgrade === 'function' ? options.upgrade : null;
      /** @type {IDBDatabase | null} */
      this.db = null;
      this._opening = null;
   }

   beforeDestroy() {
      this.close();
   }

   // ── Connection ──────────────────────────────────────────────────

   /** The open database (opened once, shared by every call). */
   open() {
      if (this.db) return Promise.resolve(this.db);
      if (!this._opening) {
         this._opening = this._connect().finally(() => { this._opening = null; });
      }
      return this._opening;
   }

   close() {
      this.db?.close();
      this.db = null;
   }

   /** Delete the whole database (sign-out, reset). Opens again on the next call. */
   async deleteDatabase() {
      this.close();
      const request = indexedDB.deleteDatabase(this.databaseName);
      request.onblocked = () => this._warnBlocked();
      await promisify(request);
   }

   // ── Data ────────────────────────────────────────────────────────

   /**
    * One store, each call in its own transaction:
    * get, getAll, getAllKeys, count, add, put, delete, clear, query.
    */
   store(name = this.storeName) {
      const call = (mode, method) => (...args) => this.transaction(name, mode, (store) => store[method](...args));
      return {
         name,
         get: call('readonly', 'get'),
         getAll: call('readonly', 'getAll'),
         getAllKeys: call('readonly', 'getAllKeys'),
         count: call('readonly', 'count'),
         query: call('readonly', 'query'),
         add: call('readwrite', 'add'),
         put: call('readwrite', 'put'),
         delete: call('readwrite', 'delete'),
         clear: call('readwrite', 'clear'),
      };
   }

   /**
    * Several operations that happen together or not at all. `fn` receives the
    * store (one name) or { name: store } (an array). If it throws, nothing it
    * did is kept. Inside, await only these stores' calls: waiting for anything
    * else (a fetch, a timer) lets the browser close the transaction.
    * @template T
    * @param {string | string[]} names
    * @param {'readonly' | 'readwrite'} mode
    * @param {(stores: any) => Promise<T> | T} fn
    * @returns {Promise<T>}
    */
   async transaction(names, mode, fn) {
      const list = Array.isArray(names) ? names : [names];
      const db = await this.open();
      const tx = db.transaction(list, mode);
      const done = finished(tx);
      const stores = Object.fromEntries(list.map((name) => [name, wrapStore(tx.objectStore(name))]));
      try {
         const result = await fn(Array.isArray(names) ? stores : stores[list[0]]);
         await done;
         return result;
      } catch (error) {
         done.catch(() => {});
         try { tx.abort(); } catch { /* already finished */ }
         throw error;
      }
   }

   // Shortcuts on the default store.
   get(key) { return this.store().get(key); }
   getAll(query, count) { return this.store().getAll(query, count); }
   count(query) { return this.store().count(query); }
   query(options) { return this.store().query(options); }
   add(value, key) { return this.store().add(value, key); }
   put(value, key) { return this.store().put(value, key); }
   delete(key) { return this.store().delete(key); }
   clear() { return this.store().clear(); }

   // ── Opening and upgrading ───────────────────────────────────────

   async _connect() {
      if (!this.databaseName) throw new Error('IndexedDbManager needs a databaseName.');
      let db = await this._request(this.version);
      const missing = this._missing(db);
      if (missing.length) {
         if (this.version) {
            db.close();
            throw new Error(`IndexedDbManager: ${missing.join(', ')} not in "${this.databaseName}" v${db.version}. Raise \`version\` to create them.`);
         }
         // Declared after the database was created: one version more adds them.
         const next = db.version + 1;
         db.close();
         db = await this._request(next);
      }
      // Another tab wants to upgrade: step aside; the next call opens again.
      db.onversionchange = () => {
         db.close();
         if (this.db === db) this.db = null;
      };
      this.db = db;
      return db;
   }

   _request(version) {
      return new Promise((resolve, reject) => {
         const request = version ? indexedDB.open(this.databaseName, version) : indexedDB.open(this.databaseName);
         request.onupgradeneeded = (event) => {
            const db = request.result;
            const tx = /** @type {IDBTransaction} */ (request.transaction);
            try {
               this._createDeclared(db, tx);
               this.upgrade?.(db, event.oldVersion, event.newVersion, tx);
            } catch (error) {
               tx.abort();
               reject(error);
            }
         };
         request.onsuccess = () => resolve(request.result);
         request.onerror = () => reject(request.error);
         request.onblocked = () => this._warnBlocked();
      });
   }

   _createDeclared(db, tx) {
      for (const [name, def] of Object.entries(this.stores)) {
         const store = db.objectStoreNames.contains(name)
            ? tx.objectStore(name)
            : db.createObjectStore(name, { keyPath: def.keyPath, autoIncrement: def.autoIncrement });
         for (const [indexName, index] of Object.entries(def.indexes)) {
            if (!store.indexNames.contains(indexName)) {
               store.createIndex(indexName, index.keyPath, { unique: index.unique, multiEntry: index.multiEntry });
            }
         }
      }
   }

   // Declared stores and indexes the open database does not have.
   _missing(db) {
      const missing = [];
      const present = Object.keys(this.stores).filter((name) => {
         if (db.objectStoreNames.contains(name)) return true;
         missing.push(`store "${name}"`);
         return false;
      });
      if (!present.length) return missing;
      const tx = db.transaction(present, 'readonly');
      for (const name of present) {
         const store = tx.objectStore(name);
         for (const indexName of Object.keys(this.stores[name].indexes)) {
            if (!store.indexNames.contains(indexName)) missing.push(`index "${name}.${indexName}"`);
         }
      }
      return missing;
   }

   _warnBlocked() {
      slice.logger.warn('IndexedDbManager', `"${this.databaseName}" is open in another tab that does not let it change; close that tab to finish.`);
   }

   // ── The old API ─────────────────────────────────────────────────

   _legacy(name) {
      if (warnedLegacy) return;
      warnedLegacy = true;
      slice.logger.warn('IndexedDbManager', `${name}() is deprecated: use store(name).add/get/put/delete/getAll/clear (or the same names on the service for its default store).`);
   }

   /** @deprecated open() */
   openDatabase() { return this.open(); }
   /** @deprecated close() */
   closeDatabase() { this.close(); }
   /** @deprecated add() */
   addItem(item) { this._legacy('addItem'); return this.add(item); }
   /** @deprecated put() */
   updateItem(item) { this._legacy('updateItem'); return this.put(item); }
   /** @deprecated get() */
   getItem(id) { this._legacy('getItem'); return this.get(id); }
   /** @deprecated delete() */
   deleteItem(id) { this._legacy('deleteItem'); return this.delete(id); }
   /** @deprecated getAll() */
   getAllItems() { this._legacy('getAllItems'); return this.getAll(); }
   /** @deprecated clear() */
   clearItems() { this._legacy('clearItems'); return this.clear(); }
}