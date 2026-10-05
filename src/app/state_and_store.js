/* ============================ STATE & NAVIGATION ============================ */

/* Auth State Machine */
const AuthState = {
  BOOTING: 'BOOTING',
  SIGNED_OUT: 'SIGNED_OUT',
  AUTHENTICATING: 'AUTHENTICATING',
  SIGNED_IN_PROFILE_LOADING: 'SIGNED_IN_PROFILE_LOADING',
  PROFILE_INCOMPLETE: 'PROFILE_INCOMPLETE',
  READY: 'READY',
  current: 'BOOTING',

  set(state, meta) {
    this.current = state;
    DBG('AuthState →', state, meta || {});
    switch (state) {
      case this.BOOTING:
        Nav.go('loading', null, { replace: true });
        break;
      case this.SIGNED_OUT:
        Nav.go('auth', null, { replace: true, force: true });
        switchAuth('login');
        break;
      case this.AUTHENTICATING:
        break;
      case this.SIGNED_IN_PROFILE_LOADING:
        if (Nav.current !== 'loading') {
          const t = s('loading-text');
          if (t) t.textContent = 'Loading your profile…';
        }
        break;
      case this.PROFILE_INCOMPLETE:
        showSetupProfile();
        break;
      case this.READY:
        Nav.go('main', { tab: Nav.tab || 'chats' }, { replace: true });
        break;
    }
  }
};

const ST = {
  me: null,
  users: {},
  groups: {},
  chat: null,
  chatMsgs: {},
  pinned: {},
  partnerTyping: false,
  requests: {},
  unread: {},
  listeners: [],
  slots: {},
  call: null,
  pc: null,
  localStream: null,
  mediaRec: null,
  recStream: null,
  recChunks: [],
  recStart: 0,
  recTimer: null,
  recCancel: false,
  uploads: {},
  transferMeta: {},
  drafts: {},
  onlinePool: {}
};
window.KLYRO_DEBUG = false;

/* ============================ CENTRAL NAVIGATION STATE ============================
   Every route knows its predecessor; every overlay is cleanly stacked;
   closing any overlay or ending any call restores the exact previous screen.
   ================================================================================== */
const Nav = {
  current: 'loading',
  stack: [],         // [{ view, params, tab }]
  overlays: [],      // IDs of open overlays in stack order
  tab: 'chats',
  params: {},

  go(view, params, opts) {
    opts = opts || {};
    if (this.current === view && !opts.force) {
      if (params) this._apply(view, params);
      return;
    }
    if (!opts.replace && this.current && this.current !== 'loading') {
      this.stack.push({ view: this.current, params: this.params, tab: this.tab });
    }
    if (this.stack.length > 16) this.stack.shift();
    this.params = params || {};
    this._apply(view, this.params);
    this._render();
    DBG('Nav.go →', view, params || {});
  },

  back(fallback) {
    const prev = this.stack.pop();
    const target = prev ? prev.view : (fallback || 'main');
    this.params = prev ? (prev.params || {}) : {};
    if (prev && prev.tab) this.tab = prev.tab;
    this._apply(target, this.params);
    this._render();
    DBG('Nav.back →', target, this.params);
  },

  _apply(view, params) {
    if (view !== 'chat' && this.current === 'chat' && typeof teardownChat === 'function') {
      teardownChat();
    }
    this.current = view;
    if (view === 'main' && params && params.tab) {
      this.tab = params.tab;
    }
  },

  _render() {
    const views = $$('.view');
    const idx = views.map(v => v.id).indexOf('view-' + (this.current === 'story' ? 'main' : this.current));
    views.forEach((v, i) => {
      v.classList.toggle('active', i === idx);
      v.classList.toggle('behind', idx >= 0 && i < idx);
    });
    if (this.current === 'main') this._renderTab();
  },

  _renderTab() {
    $$('.panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + this.tab));
    $$('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.tab === this.tab));
    const titles = { chats: 'Chats', status: 'Status', people: 'Discover', settings: 'Settings' };
    if (s('main-title')) s('main-title').textContent = titles[this.tab] || 'KLYRO';
    if (s('search-wrap')) s('search-wrap').style.display = (this.tab === 'chats' || this.tab === 'people') ? 'block' : 'none';
    if (s('fab')) s('fab').style.display = (this.tab === 'chats' || this.tab === 'people' || this.tab === 'status') ? 'flex' : 'none';
    
    if (this.tab === 'chats') renderChats();
    if (this.tab === 'status') renderStatus();
    if (this.tab === 'people') renderPeople();
    if (this.tab === 'settings') renderSettings();
  },

  tab_(name) {
    this.tab = name;
    if (this.current !== 'main') {
      this.go('main', { tab: name });
      return;
    }
    this._renderTab();
  },

  /* Overlays */
  open(id) {
    const el = s(id); if (!el) return;
    if (this.overlays.indexOf(id) < 0) this.overlays.push(id);
    el.classList.add('open');
    document.body.style.overflow = 'hidden';
  },

  close(id) {
    const i = this.overlays.indexOf(id);
    if (i >= 0) this.overlays.splice(i, 1);
    const el = s(id); if (el) el.classList.remove('open');
    if (!this.overlays.length) document.body.style.overflow = '';

    if (id === 'ov-media') {
      const b = s('media-body'); if (b) b.innerHTML = '';
      if (Viewer && typeof Viewer.close === 'function') Viewer.close();
    }
    if (id === 'ov-story' && typeof StoryViewer !== 'undefined' && StoryViewer.stop) {
      StoryViewer.stop();
    }
  },

  closeTop() {
    const id = this.overlays[this.overlays.length - 1];
    if (id) {
      this.close(id);
      return true;
    }
    return false;
  },

  isOpen(id) {
    return this.overlays.indexOf(id) >= 0;
  }
};

/* ============================ REALTIME LISTENERS ============================ */
function listen(slot, path, ev, fn) {
  if (ST.slots[slot]) {
    try { ST.slots[slot].ref.off(ST.slots[slot].ev, ST.slots[slot].fn); } catch (e) {}
  }
  const ref = db.ref(path);
  ref.on(ev, fn);
  ST.slots[slot] = { ref: ref, path: path, ev: ev, fn: fn };
  return ref;
}

function listenLimited(slot, path, ev, fn, limit) {
  if (ST.slots[slot]) {
    try { ST.slots[slot].ref.off(ST.slots[slot].ev, ST.slots[slot].fn); } catch (e) {}
  }
  const ref = limit ? db.ref(path).limitToLast(limit) : db.ref(path);
  ref.on(ev, fn);
  ST.slots[slot] = { ref: ref, path: path, ev: ev, fn: fn };
  return ref;
}

function unlisten(slot) {
  const l = ST.slots[slot]; if (!l) return;
  try { l.ref.off(l.ev, l.fn); } catch (e) {}
  delete ST.slots[slot];
}

function unlistenAll(prefix) {
  Object.keys(ST.slots).forEach(k => {
    if (!prefix || k.indexOf(prefix) === 0) unlisten(k);
  });
}

/* ============================ INDEXEDDB MEDIA STORE ============================
   Persists received files locally with blob lifecycle management. Object URLs
   are held and released cleanly to prevent memory leaks.
   ============================================================================== */
const Store = {
  db: null,
  _opening: null,
  urls: {},
  refs: {},

  open() {
    if (this.db) return Promise.resolve(this.db);
    if (this._opening) return this._opening;
    this._opening = new Promise((res, rej) => {
      if (!('indexedDB' in window)) return rej(new Error('no-indexeddb'));
      let rq;
      try { rq = indexedDB.open('klyro-media', 1); } catch (e) { return rej(e); }
      rq.onupgradeneeded = () => {
        const d = rq.result;
        if (!d.objectStoreNames.contains('media')) d.createObjectStore('media', { keyPath: 'id' });
      };
      rq.onsuccess = () => { this.db = rq.result; res(this.db); };
      rq.onerror = () => rej(rq.error || new Error('idb-open-failed'));
    });
    return this._opening;
  },

  put(id, blob, meta) {
    return this.open().then(d => new Promise(res => {
      try {
        const tx = d.transaction('media', 'readwrite');
        tx.objectStore('media').put(Object.assign({ id: id, blob: blob, size: blob.size, ts: now() }, meta || {}));
        tx.oncomplete = () => res(true);
        tx.onerror = () => res(false);
        tx.onabort = () => res(false);
      } catch (e) { res(false); }
    })).catch(() => false);
  },

  get(id) {
    if (!id) return Promise.resolve(null);
    return this.open().then(d => new Promise(res => {
      try {
        const rq = d.transaction('media', 'readonly').objectStore('media').get(id);
        rq.onsuccess = () => res(rq.result || null);
        rq.onerror = () => res(null);
      } catch (e) { res(null); }
    })).catch(() => null);
  },

  del(id) {
    this.release(id);
    return this.open().then(d => new Promise(res => {
      try {
        const tx = d.transaction('media', 'readwrite');
        tx.objectStore('media').delete(id);
        tx.oncomplete = () => res(true);
        tx.onerror = () => res(false);
      } catch (e) { res(false); }
    })).catch(() => false);
  },

  url(id, blob) {
    if (this.urls[id]) return this.urls[id];
    try {
      const u = URL.createObjectURL(blob);
      this.urls[id] = u;
      return u;
    } catch (e) { return ''; }
  },

  hold(id) {
    if (!id) return;
    this.refs[id] = (this.refs[id] || 0) + 1;
  },

  release(id) {
    if (!id || !this.urls[id]) return;
    this.refs[id] = Math.max(0, (this.refs[id] || 1) - 1);
    if (this.refs[id] === 0) {
      try { URL.revokeObjectURL(this.urls[id]); } catch (e) {}
      delete this.urls[id];
    }
  },

  releaseAll() {
    Object.keys(this.urls).forEach(id => {
      this.refs[id] = 0;
      this.release(id);
    });
  },

  cleanup(cap) {
    const budget = cap || KLYRO_CONFIG.cache.maxBytes;
    return this.open().then(d => new Promise(res => {
      try {
        const rq = d.transaction('media', 'readonly').objectStore('media').getAll();
        rq.onsuccess = () => {
          const rows = (rq.result || []).sort((a, b) => (a.ts || 0) - (b.ts || 0));
          let total = rows.reduce((n, r) => n + (r.size || (r.blob && r.blob.size) || 0), 0);
          const gone = [];
          while (total > budget && rows.length > 1) {
            const r = rows.shift();
            total -= (r.size || 0);
            gone.push(r.id);
          }
          if (!gone.length) return res(0);
          const tx = d.transaction('media', 'readwrite');
          gone.forEach(id => tx.objectStore('media').delete(id));
          tx.oncomplete = () => res(gone.length);
          tx.onerror = () => res(0);
        };
        rq.onerror = () => res(0);
      } catch (e) { res(0); }
    })).catch(() => 0);
  }
};
