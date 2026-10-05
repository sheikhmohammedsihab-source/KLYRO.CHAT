/* ============================ GIF ENGINE (GIPHY & TENOR) ============================
   Architecture:
     GifEngine.search()
     GifEngine.trending()
     GifEngine.categories()
     GifEngine.loadMore()
     GifEngine.send()
     GifEngine.normalize()
   Follows official GIPHY integration requirements:
   - "Powered by GIPHY" attribution clearly visible.
   - Normalized metadata saved to chat message: { type: 'gif', gifUrl, gifPreview, gifProvider, gifId, gifTitle }.
   - If key is not configured, shows clean setup instructions without breaking the app.
   ================================================================================== */

const GifEngine = {
  cfg: KLYRO_CONFIG.gif,
  cache: {},
  page: {},
  active: 'trending',

  categories() {
    return [
      { id: 'trending', label: 'Trending', q: '' },
      { id: 'reactions', label: 'Reactions', q: 'reaction' },
      { id: 'funny', label: 'Funny', q: 'funny' },
      { id: 'love', label: 'Love', q: 'love' },
      { id: 'laugh', label: 'Laugh', q: 'laughing' },
      { id: 'sad', label: 'Sad', q: 'sad' },
      { id: 'angry', label: 'Angry', q: 'angry' },
      { id: 'celebration', label: 'Celebration', q: 'celebration' },
      { id: 'anime', label: 'Anime', q: 'anime' },
      { id: 'random', label: 'Random', q: 'random' }
    ];
  },

  configured() {
    return !!(this.cfg.giphyKey || this.cfg.tenorKey);
  },

  provider() {
    if (this.cfg.provider === 'tenor' && this.cfg.tenorKey) return 'tenor';
    if (this.cfg.giphyKey) return 'giphy';
    if (this.cfg.tenorKey) return 'tenor';
    return 'none';
  },

  async fetch(q, offset) {
    const p = this.provider();
    if (p === 'giphy') return this.giphy(q, offset || 0);
    if (p === 'tenor') return this.tenor(q, offset || 0);
    throw new Error('no-provider');
  },

  async giphy(q, offset) {
    const key = this.cfg.giphyKey;
    const base = q ? 'https://api.giphy.com/v1/gifs/search' : 'https://api.giphy.com/v1/gifs/trending';
    const url = base + '?api_key=' + encodeURIComponent(key) + '&limit=' + this.cfg.limit + '&offset=' + (offset || 0) +
      '&rating=' + encodeURIComponent(this.cfg.rating || 'pg-13') + (q ? '&q=' + encodeURIComponent(q) : '') + '&lang=en';
    const r = await fetch(url);
    if (!r.ok) throw new Error('giphy-' + r.status);
    const j = await r.json();
    return (j.data || []).map(g => {
      const im = g.images || {};
      const fixed = im.fixed_height || im.downsized || im.original || {};
      const small = im.fixed_height_small || im.preview_gif || fixed;
      return {
        provider: 'giphy',
        id: g.id,
        title: (g.title || '').slice(0, 120),
        preview: (small && small.url) || '',
        url: (fixed && fixed.url) || (im.original && im.original.url) || '',
        w: Number(fixed && fixed.width) || 0,
        h: Number(fixed && fixed.height) || 0,
        page: g.url || ('https://giphy.com/gifs/' + g.id)
      };
    }).filter(g => g.url && g.preview);
  },

  async tenor(q, offset) {
    const url = 'https://tenor.googleapis.com/v2/' + (q ? 'search' : 'featured') +
      '?key=' + encodeURIComponent(this.cfg.tenorKey) + '&limit=' + this.cfg.limit +
      (offset ? '&pos=' + encodeURIComponent(offset) : '') + '&media_filter=tinygif,gif&contentfilter=high' +
      (q ? '&q=' + encodeURIComponent(q) : '');
    const r = await fetch(url);
    if (!r.ok) throw new Error('tenor-' + r.status);
    const j = await r.json();
    return (j.results || []).map(g => {
      const mf = g.media_formats || {};
      const tiny = mf.tinygif || mf.gif || {};
      const full = mf.gif || mf.tinygif || {};
      return {
        provider: 'tenor',
        id: g.id,
        title: (g.content_description || '').slice(0, 120),
        preview: tiny.url || '',
        url: full.url || '',
        w: Number(full.dims && full.dims[0]) || 0,
        h: Number(full.dims && full.dims[1]) || 0,
        page: g.itemurl || ''
      };
    }).filter(g => g.url && g.preview);
  },

  trayHTML() {
    const cats = this.categories();
    return `
      <div class="tray-tabs" id="gif-cats">
        ${cats.map(c => `<button class="chip ${c.id === 'trending' ? 'on' : ''}" data-gifcat="${c.id}">${esc(c.label)}</button>`).join('')}
      </div>
      <div style="display:flex;gap:8px;padding:8px 12px">
        <input id="gif-q" class="inp" style="height:38px;border-radius:99px" placeholder="Search GIFs…" autocomplete="off">
        <button class="btn sm" id="gif-go" style="height:38px;border-radius:99px">Search</button>
      </div>
      <div class="tray-body">
        <div id="gif-grid"></div>
        <div class="attrib" id="gif-attrib"></div>
      </div>
    `;
  },

  wireTray() {
    const tray = s('sticker-tray'); if (!tray) return;
    const gq = s('gif-q');
    if (gq) {
      let h = null;
      gq.addEventListener('input', () => {
        clearTimeout(h);
        h = setTimeout(() => {
          this.active = gq.value.trim() ? 'search' : 'trending';
          $$('#gif-cats .chip').forEach(c => c.classList.remove('on'));
          this.load(gq.value.trim(), true);
        }, 420);
      });
      gq.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.load(gq.value.trim(), true);
        }
      });
    }

    const go = s('gif-go');
    if (go) go.onclick = () => this.load((s('gif-q') && s('gif-q').value.trim()) || '', true);

    $$('#gif-cats .chip').forEach(chip => {
      chip.onclick = () => {
        $$('#gif-cats .chip').forEach(c => c.classList.remove('on'));
        chip.classList.add('on');
        const cat = this.categories().find(c => c.id === chip.dataset.gifcat);
        if (gq) gq.value = cat && cat.q ? cat.q : '';
        this.active = chip.dataset.gifcat;
        this.load(cat ? cat.q : '', true);
      };
    });

    this.load('', true);
  },

  async load(q, reset) {
    const grid = s('gif-grid'); if (!grid) return;
    const attrib = s('gif-attrib');
    const prov = this.provider();
    if (attrib) attrib.textContent = prov === 'giphy' ? 'POWERED BY GIPHY' : (prov === 'tenor' ? 'POWERED BY TENOR' : '');

    if (!this.configured()) {
      grid.innerHTML = `
        <div class="empty" style="padding:28px 14px">
          <div class="big">🎞️</div>
          <div style="font-weight:700;color:var(--kr-txt);font-size:15px">GIPHY Integration Ready</div>
          <div style="font-size:13px;line-height:1.5;max-width:320px;color:var(--kr-mut)">
            KLYRO includes the complete official GIPHY architecture. Enter your free API key in Settings → GIF provider (or in KLYRO_CONFIG) to activate live trending and search.
          </div>
          <button class="btn sm" id="gif-config-btn" style="margin-top:8px">Configure Key</button>
        </div>
      `;
      const btn = s('gif-config-btn');
      if (btn) btn.onclick = () => openGifConfigModal();
      return;
    }

    const key = prov + ':' + q;
    if (reset) {
      this.page[key] = 0;
      grid.innerHTML = '<div class="spin"></div>';
    }
    const off = this.page[key] || 0;

    try {
      const results = await this.fetch(q, off);
      if (!off) grid.innerHTML = '';
      if (!results.length && !off) {
        grid.innerHTML = '<div class="empty" style="padding:30px 12px"><div class="big">🔍</div><div>No GIFs found for that search.</div></div>';
        return;
      }

      results.forEach(g => {
        const item = document.createElement('div');
        item.className = 'gitem';
        item.innerHTML = `<img src="${esc(g.preview)}" loading="lazy" width="${g.w || 200}" height="${g.h || 200}" alt="${esc(g.title || 'GIF')}">`;
        const img = $('img', item);
        img.onclick = () => sendGif(g);
        img.onerror = () => { item.style.display = 'none'; };
        grid.appendChild(item);
      });

      this.page[key] = off + results.length;

      let more = s('gif-more');
      if (!more) {
        more = document.createElement('button');
        more.id = 'gif-more';
        more.className = 'btn ghost sm';
        more.style.cssText = 'display:block;margin:10px auto;border-radius:99px';
        more.textContent = 'Load more';
        more.onclick = () => {
          more.textContent = 'Loading…';
          this.load(q, false).then(() => { more.textContent = 'Load more'; });
        };
        grid.parentNode.insertBefore(more, grid.nextSibling);
      }
      more.style.display = results.length >= 10 ? 'block' : 'none';
    } catch (e) {
      grid.innerHTML = `
        <div class="empty" style="padding:24px 12px">
          <div class="big">📡</div>
          <div>Could not load GIFs right now.</div>
          <button class="btn sm" id="gif-retry" style="margin-top:6px">Retry</button>
        </div>
      `;
      const r = s('gif-retry');
      if (r) r.onclick = () => this.load(q, true);
    }
  }
};

function sendGif(g) {
  if (!ST.chat || !g || !isHttp(g.url)) {
    toast('That GIF cannot be sent.');
    return;
  }
  closeTray();
  pushMessage(buildMessage({
    type: 'gif',
    gifUrl: g.url,
    gifPreview: g.preview,
    gifProvider: g.provider || 'giphy',
    gifId: g.id || '',
    gifTitle: (g.title || '').slice(0, 120),
    gifPage: g.page || ''
  })).then(() => {
    toast('GIF sent');
  }).catch(() => toast('Could not send the GIF.'));
}

function openGifConfigModal() {
  openModal(`
    <div class="pad">
      <h3>GIF Provider Configuration</h3>
      <p style="color:var(--kr-mut);font-size:13.5px;margin:0 0 14px">
        KLYRO connects directly to GIPHY. Get a free API key at <b>developers.giphy.com</b> and enter it below:
      </p>
      <div class="field">
        <label>GIPHY API Key</label>
        <input id="cfg-giphy-key" class="inp" placeholder="Paste your GIPHY API key here" value="${esc(KLYRO_CONFIG.gif.giphyKey || '')}">
      </div>
      <div style="display:flex;gap:10px;margin-top:16px">
        <button class="btn ghost" id="cfg-gif-close" style="flex:1">Cancel</button>
        <button class="btn" id="cfg-gif-save" style="flex:1">Save Key</button>
      </div>
    </div>
  `);

  s('cfg-gif-close').onclick = () => Nav.close('ov-modal');
  s('cfg-gif-save').onclick = () => {
    const key = s('cfg-giphy-key').value.trim();
    KLYRO_CONFIG.gif.giphyKey = key;
    try { localStorage.setItem('kr_giphy_key', key); } catch (e) {}
    Nav.close('ov-modal');
    toast(key ? 'GIPHY key configured!' : 'Key cleared');
    if (Nav.isOpen('sticker-tray') || s('sticker-tray').classList.contains('open')) {
      GifEngine.load('', true);
    }
  };
}

/* Load saved key from localStorage on start if available */
try {
  const savedGiphy = localStorage.getItem('kr_giphy_key');
  if (savedGiphy) KLYRO_CONFIG.gif.giphyKey = savedGiphy;
} catch (e) {}
