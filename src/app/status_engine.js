/* ============================ STATUS ENGINE (STORIES) ============================
   Architecture:
     status/{uid}/{statusId}       → authoritative status record
     statusIndex/{uid}/{statusId}  → lightweight index/metadata
     stories/{uid}/{statusId}      → legacy mirror for backward compatibility
     StatusEngine cache            → live reactive memory cache
   Users NEVER need to refresh to see new stories from contacts or self.
   ================================================================================== */

const StatusEngine = {
  cache: {},       // uid → [ { id, ... } ]
  indexSlots: {},  // uid → listener slot
  activeStory: null,

  init() {
    this.cache = {};
    if (!ST.me) return;
    /* 1. Listen to self status */
    this.subscribeUser(ST.me.uid);
    /* 2. Listen to all contacts */
    Object.keys(ST.me.contacts || {}).forEach(uid => this.subscribeUser(uid));
    /* 3. Listen to public statusIndex root */
    listen('status:index_root', 'statusIndex', 'child_added', sn => {
      const ownerUid = sn.key;
      if (ownerUid && !this.indexSlots[ownerUid]) {
        this.subscribeUser(ownerUid);
      }
    });
    this.startSweeper();
  },

  teardown() {
    unlistenAll('status:');
    this.indexSlots = {};
    this.cache = {};
  },

  subscribeUser(uid) {
    if (!uid || this.indexSlots[uid]) return;
    this.indexSlots[uid] = true;
    
    /* Listen to the lightweight index */
    listen('status:idx:' + uid, 'statusIndex/' + uid, 'value', sn => {
      const all = sn.val() || {};
      const active = [];
      const t = now();
      Object.keys(all).forEach(id => {
        const item = Object.assign({ id: id, ownerUid: uid }, all[id]);
        if (!item.expiresAt || item.expiresAt > t) {
          active.push(item);
        }
      });
      active.sort((a, b) => (a.ts || 0) - (b.ts || 0));
      this.cache[uid] = active;
      renderStatus();
    });

    /* Also check legacy stories if statusIndex is empty */
    db.ref('stories/' + uid).limitToLast(10).once('value').then(sn => {
      const all = sn.val() || {};
      const current = this.cache[uid] || [];
      const t = now();
      let added = false;
      Object.keys(all).forEach(id => {
        if (!current.some(x => x.id === id)) {
          const item = Object.assign({ id: id, ownerUid: uid }, all[id]);
          if (!item.expiresAt || item.expiresAt > t) {
            current.push(item);
            added = true;
          }
        }
      });
      if (added) {
        current.sort((a, b) => (a.ts || 0) - (b.ts || 0));
        this.cache[uid] = current;
        renderStatus();
      }
    }).catch(() => {});
  },

  /* Fetch the authoritative full media record if only index metadata was cached */
  async fetchAuthoritative(ownerUid, statusId) {
    let rec = await db.ref('status/' + ownerUid + '/' + statusId).once('value').then(s => s.val());
    if (!rec) {
      rec = await db.ref('stories/' + ownerUid + '/' + statusId).once('value').then(s => s.val());
    }
    return rec ? Object.assign({ id: statusId, ownerUid: ownerUid }, rec) : null;
  },

  getLiveStories(uid) {
    const list = this.cache[uid] || [];
    const t = now();
    return list.filter(x => !x.expiresAt || x.expiresAt > t);
  },

  isAudienceAllowed(owner, viewerUid) {
    if (!owner) return false;
    if (owner.uid === viewerUid) return true;
    const p = privacyOf(owner);
    if (p.storyAudience === 'everyone') return true;
    return !!((owner.contacts && owner.contacts[viewerUid]) || (ST.me && ST.me.contacts && ST.me.contacts[owner.uid]));
  },

  startSweeper() {
    clearInterval(ST._statusSweep);
    ST._statusSweep = setInterval(() => {
      if (!ST.me || document.hidden) return;
      const t = now();
      let changed = false;
      Object.keys(this.cache).forEach(uid => {
        const prev = this.cache[uid] || [];
        const filtered = prev.filter(x => !x.expiresAt || x.expiresAt > t);
        if (filtered.length !== prev.length) {
          this.cache[uid] = filtered;
          changed = true;
        }
      });
      if (changed) renderStatus();
    }, 10 * 60 * 1000);
  }
};

function storySrc(st) {
  if (!st) return '';
  if (st.url) return safeMedia(st.url);
  if (st.data) return safeMedia(st.data);
  return '';
}

function renderStatus() {
  if (!ST.me) return;
  const mine = StatusEngine.getLiveStories(ST.me.uid);
  const others = [];

  Object.keys(ST.users).forEach(uid => {
    if (uid === ST.me.uid) return;
    const u = ST.users[uid];
    if (!u || isBlockedBy(u)) return;
    const list = StatusEngine.getLiveStories(uid);
    if (list.length && StatusEngine.isAudienceAllowed(u, ST.me.uid)) {
      others.push({
        uid: uid,
        u: u,
        list: list,
        seen: list.every(x => x.views && x.views[ST.me.uid])
      });
    }
  });

  const mineBubble = mine.length
    ? `<div class="sbub" data-story-mine="1">
         <div class="ring">
           <div class="av" style="background:${esc(ST.me.color || colorFor(ST.me.uid))}">${esc(initials(userLabel(ST.me)))}</div>
         </div>
         <span>My status</span>
       </div>`
    : '';

  const bubbles = mineBubble + others.map(o => `
    <div class="sbub" data-story-of="${esc(o.uid)}">
      <div class="ring ${o.seen ? 'seen' : ''}">${getAvatarHTML(o.u, '', 'width:100%;height:100%')}</div>
      <span>${esc(userLabel(o.u).split(' ')[0])}</span>
    </div>
  `).join('') + `<div class="sbub" data-story-add="1"><div class="ring add">＋</div><span>Add status</span></div>`;

  const strip = s('stories-strip');
  if (strip) {
    strip.innerHTML = bubbles;
    $$('[data-story-of]', strip).forEach(el => el.onclick = () => StoryViewer.open(el.dataset.storyOf));
    $$('[data-story-mine]', strip).forEach(el => el.onclick = () => StoryViewer.open(ST.me.uid));
    $$('[data-story-add]', strip).forEach(el => el.onclick = openStatusComposer);
  }

  const sstrip = s('status-strip');
  if (sstrip) {
    sstrip.innerHTML = bubbles;
    $$('[data-story-of]', sstrip).forEach(el => el.onclick = () => StoryViewer.open(el.dataset.storyOf));
    $$('[data-story-mine]', sstrip).forEach(el => el.onclick = () => StoryViewer.open(ST.me.uid));
    $$('[data-story-add]', sstrip).forEach(el => el.onclick = openStatusComposer);
  }

  const list = s('status-list');
  if (list) {
    list.innerHTML = others.length ? others.map(o => {
      const views = o.list.reduce((n, x) => n + Object.keys(x.views || {}).length, 0);
      return `<div class="row" data-status-of="${esc(o.uid)}">
        ${getAvatarHTML(o.u)}
        <div class="mid">
          <div class="t1"><b>${esc(userLabel(o.u))}</b></div>
          <div class="t2">${o.list.length} update${o.list.length > 1 ? 's' : ''} · ${esc(fmtWhen(o.list[o.list.length - 1].ts))}${views ? ' · ' + views + ' views' : ''}</div>
        </div>
        <div class="ring ${o.seen ? 'seen' : ''}" style="width:46px;height:46px;padding:2px;border-radius:50%;background:${o.seen ? 'var(--kr-line)' : 'linear-gradient(135deg,var(--kr-brand),var(--kr-accent))'}">
          ${getAvatarHTML(o.u, '', 'width:100%;height:100%')}
        </div>
      </div>`;
    }).join('') : `<div class="empty"><div class="big">✨</div><div>No status updates from your contacts in the last 24 hours.</div></div>`;
    $$('[data-status-of]', list).forEach(el => el.onclick = () => StoryViewer.open(el.dataset.statusOf));
  }

  const box = s('status-mine');
  if (box) {
    box.innerHTML = mine.length ? `<div class="grid3" style="padding:0">` + mine.map(st => {
      const inner = st.type === 'text'
        ? `<div style="display:flex;align-items:center;justify-content:center;height:100%;background:${esc(st.bg || 'var(--kr-brand)')};color:#fff;font-size:12px;padding:8px;text-align:center;overflow:hidden">${esc((st.text || '').slice(0, 60))}</div>`
        : st.type === 'video'
          ? `<div style="display:flex;align-items:center;justify-content:center;height:100%;font-size:28px;background:var(--kr-bg2)">🎬</div>`
          : `<img src="${esc(storySrc(st) || '')}" loading="lazy" alt="" style="width:100%;height:100%;object-fit:cover">`;
      return `<div class="gcell" data-open-status="${esc(st.id)}">
        ${inner}
        <div class="cap">${Object.keys(st.views || {}).length} views · ${esc(fmtWhen(st.ts))}</div>
      </div>`;
    }).join('') + `</div>`
      : `<p style="color:var(--kr-mut);font-size:13.5px">You have no active status. Status updates disappear automatically after 24 hours.</p>`;
    $$('[data-open-status]', box).forEach(el => el.onclick = () => StoryViewer.open(ST.me.uid));
  }
}

function openStatusComposer() {
  const p = privacyOf(ST.me);
  s('compose-body').innerHTML = `
    <h3>New Status Update</h3>
    <p style="color:var(--kr-mut);font-size:13px;margin:0 0 14px">
      Visible for 24 hours · Audience: <b id="sc-aud">${esc(p.storyAudience)}</b>
      <button class="btn sm ghost" id="sc-aud-btn" style="margin-left:6px;height:26px;padding:0 8px">Change</button>
    </p>
    <div class="field">
      <label>Status Text / Caption</label>
      <textarea id="sc-text" class="inp" placeholder="What's on your mind?" maxlength="280"></textarea>
    </div>
    <div class="field">
      <label>Background Colour (for text status)</label>
      <div id="sc-bgs" style="display:flex;gap:8px;flex-wrap:wrap"></div>
    </div>
    <div class="field">
      <label>Photo or Short Video (Max 15s)</label>
      <button class="btn block outline" id="sc-pick">Select Photo or Short Video</button>
      <div id="sc-meta" style="font-size:12px;color:var(--kr-mut);margin-top:6px"></div>
    </div>
    <div id="sc-prev" style="margin-top:10px"></div>
    <div class="err" id="sc-err"></div>
    <div style="display:flex;gap:10px;margin-top:16px">
      <button class="btn ghost" id="sc-cancel" style="flex:1">Cancel</button>
      <button class="btn" id="sc-post" style="flex:1">Post Status</button>
    </div>
  `;

  const BGS = ['#2563EB','#7C3AED','#E11D48','#16A34A','#D97706','#0F172A','#0891B2','#DB2777'];
  let bg = BGS[0], chosen = null;
  s('sc-bgs').innerHTML = BGS.map((c, i) =>
    `<div class="bgswatch ${i === 0 ? 'on' : ''}" data-bg="${c}" style="background:${c}"></div>`).join('');
  $$('[data-bg]').forEach(el => el.onclick = () => {
    bg = el.dataset.bg;
    $$('[data-bg]').forEach(x => x.classList.remove('on'));
    el.classList.add('on');
  });

  s('sc-cancel').onclick = () => Nav.close('ov-compose');
  s('sc-aud-btn').onclick = () => openSheet('Status Audience', [
    { icon: p.storyAudience === 'contacts' ? '✅' : '•', label: 'Contacts Only', sub: 'Only people you are connected with', run: () => setAudience('contacts') },
    { icon: p.storyAudience === 'everyone' ? '✅' : '•', label: 'Everyone', sub: 'Anyone who views your profile', run: () => setAudience('everyone') }
  ]);

  function setAudience(v) {
    db.ref('users/' + ST.me.uid + '/privacy/storyAudience').set(v).catch(() => {});
    ST.me.privacy = Object.assign(privacyOf(ST.me), { storyAudience: v });
    if (s('sc-aud')) s('sc-aud').textContent = v;
    toast('Audience updated');
  }

  const inp = s('story-input');
  s('sc-pick').onclick = () => { inp.value = ''; inp.click(); };
  inp.onchange = async () => {
    const f = inp.files && inp.files[0];
    if (!f) return;
    const isVid = /^video\//.test(f.type) || /\.(mp4|webm|mov|mkv)$/i.test(f.name || '');
    const cap = isVid ? KLYRO_CONFIG.limits.storyVideo : KLYRO_CONFIG.limits.storyImage;
    s('sc-err').textContent = '';
    s('sc-meta').textContent = 'Preparing media… ' + fmtSize(f.size);

    try {
      if (isVid) {
        if (f.size > 10 * 1024 * 1024) {
          chosen = null; s('sc-meta').textContent = '';
          s('sc-err').textContent = 'Video file too large (' + fmtSize(f.size) + '). Maximum allowed is 10 MB.';
          return;
        }
        const dur = await probeDuration(f, 'video');
        if (dur > 15.5) {
          chosen = null; s('sc-meta').textContent = '';
          s('sc-err').textContent = 'Status videos must be 15 seconds or less (yours is ' + Math.round(dur) + 's).';
          return;
        }
        chosen = { file: f, kind: 'video', dur: dur };
        s('sc-meta').textContent = 'Video · ' + fmtSize(f.size) + ' · ' + Math.round(dur) + 's';
        s('sc-prev').innerHTML = '<div class="pillx ok">✓ Short video attached (' + Math.round(dur) + 's)</div>';
      } else {
        const out = await compressImage(f, 1080, 0.65, cap);
        const b64 = await blobToDataURL(out.blob);
        if (b64.length > cap) {
          chosen = null;
          s('sc-err').textContent = 'Photo exceeds the status size limit (' + fmtSize(b64.length) + '). Limit is ' + fmtSize(cap) + '.';
          s('sc-meta').textContent = '';
          return;
        }
        chosen = { data: b64, kind: 'image', w: out.w, h: out.h, size: b64.length };
        s('sc-meta').textContent = 'Photo · ' + fmtSize(b64.length) + ' (limit: ' + fmtSize(cap) + ')';
        s('sc-prev').innerHTML = `<img src="${esc(b64)}" style="max-height:160px;border-radius:12px;display:block" alt="">`;
      }
    } catch (e) {
      chosen = null;
      s('sc-err').textContent = 'Could not process that file — please select another.';
      s('sc-meta').textContent = '';
    }
  };

  s('sc-post').onclick = () => postStatus(chosen, s('sc-text').value.trim(), bg);
  Nav.open('ov-compose');
}

async function postStatus(chosen, text, bg) {
  const errEl = s('sc-err');
  const btn = s('sc-post');
  if (!chosen && !text) {
    if (errEl) errEl.textContent = 'Add some text or select a photo/video first.';
    return;
  }
  if (btn) { btn.disabled = true; btn.textContent = 'Posting…'; }
  if (errEl) errEl.textContent = '';

  const statusId = db.ref('status/' + ST.me.uid).push().key;
  const audience = privacyOf(ST.me).storyAudience || 'contacts';
  const expiresAt = now() + KLYRO_CONFIG.storyTtlMs;
  const base = {
    uid: ST.me.uid,
    statusId: statusId,
    ts: now(),
    expiresAt: expiresAt,
    audience: audience,
    views: {},
    reactions: {}
  };

  let fullRecord = null;
  let indexRecord = null;

  try {
    if (!chosen) {
      fullRecord = Object.assign({}, base, { type: 'text', text: text, bg: bg || '#2563EB' });
      indexRecord = { id: statusId, statusId: statusId, ownerUid: ST.me.uid, type: 'text', ts: base.ts, expiresAt: expiresAt, audience: audience, textPreview: text.slice(0, 80), bg: bg || '#2563EB' };
    } else if (chosen.kind === 'image') {
      fullRecord = Object.assign({}, base, { type: 'image', data: chosen.data, mime: 'image/jpeg', w: chosen.w || 0, h: chosen.h || 0, size: chosen.size, text: text || '' });
      indexRecord = { id: statusId, statusId: statusId, ownerUid: ST.me.uid, type: 'image', ts: base.ts, expiresAt: expiresAt, audience: audience, textPreview: (text || '').slice(0, 80) };
    } else {
      const b64 = await blobToDataURL(chosen.file);
      const cap = KLYRO_CONFIG.limits.storyVideo;
      if (b64.length > cap) {
        if (errEl) errEl.textContent = 'Encoded video size (' + fmtSize(b64.length) + ') exceeds limit of ' + fmtSize(cap) + '. Please use a shorter clip.';
        if (btn) { btn.disabled = false; btn.textContent = 'Post Status'; }
        return;
      }
      fullRecord = Object.assign({}, base, { type: 'video', data: b64, mime: chosen.file.type || 'video/mp4', dur: chosen.dur || 0, size: b64.length, text: text || '' });
      indexRecord = { id: statusId, statusId: statusId, ownerUid: ST.me.uid, type: 'video', ts: base.ts, expiresAt: expiresAt, audience: audience, dur: chosen.dur || 0, textPreview: (text || '').slice(0, 80) };
    }

    /* Atomic Multi-Path Write */
    const updates = {};
    updates['status/' + ST.me.uid + '/' + statusId] = fullRecord;
    updates['statusIndex/' + ST.me.uid + '/' + statusId] = indexRecord;
    updates['stories/' + ST.me.uid + '/' + statusId] = fullRecord; // Legacy node mirror

    await db.ref().update(updates);

    /* Update memory cache immediately */
    const current = StatusEngine.cache[ST.me.uid] || [];
    current.push(Object.assign({ id: statusId, ownerUid: ST.me.uid }, fullRecord));
    StatusEngine.cache[ST.me.uid] = current;

    Nav.close('ov-compose');
    renderStatus();
    toast('Status posted');
  } catch (e) {
    /* Rollback on failure */
    try {
      await db.ref('status/' + ST.me.uid + '/' + statusId).remove();
      await db.ref('statusIndex/' + ST.me.uid + '/' + statusId).remove();
      await db.ref('stories/' + ST.me.uid + '/' + statusId).remove();
    } catch (e2) {}

    const msg = 'Could not post status — check your connection.';
    if (errEl) errEl.textContent = msg;
    toast(msg, 4000);
  }

  if (btn) { btn.disabled = false; btn.textContent = 'Post Status'; }
}

function deleteStatus(statusId) {
  const updates = {};
  updates['status/' + ST.me.uid + '/' + statusId] = null;
  updates['statusIndex/' + ST.me.uid + '/' + statusId] = null;
  updates['stories/' + ST.me.uid + '/' + statusId] = null;
  
  db.ref().update(updates).then(() => {
    const list = StatusEngine.cache[ST.me.uid] || [];
    StatusEngine.cache[ST.me.uid] = list.filter(x => x.id !== statusId);
    toast('Status deleted');
    renderStatus();
  }).catch(() => toast('Could not delete status.'));
}

/* ============================ STORY VIEWER ============================ */
const StoryViewer = {
  ctx: null,
  timer: null,

  async open(uid) {
    const owner = uid === ST.me.uid ? ST.me : ST.users[uid];
    if (!owner) { toast('Status not available.'); return; }
    const list = StatusEngine.getLiveStories(uid);
    if (!list.length) { toast('No active status from this user.'); return; }
    if (uid !== ST.me.uid && !StatusEngine.isAudienceAllowed(owner, ST.me.uid)) {
      toast('This status update is private.');
      return;
    }

    this.ctx = { uid: uid, owner: owner, list: list, idx: 0 };
    const prog = s('story-progress');
    prog.innerHTML = list.map(() => '<i><b></b></i>').join('');
    
    const ov = s('ov-story');
    ov.onclick = e => {
      if (!e.target.closest('.st-foot') && !e.target.closest('.st-head') && e.target.tagName !== 'INPUT' && !e.target.closest('button')) {
        const x = e.clientX, w = window.innerWidth;
        if (x < w * 0.35) this.prev();
        else this.next();
      }
    };

    Nav.open('ov-story');
    await this.show(0);
  },

  async show(i) {
    const c = this.ctx; if (!c) return;
    if (i >= c.list.length) { this.close(); return; }
    if (i < 0) i = 0;
    c.idx = i;
    
    let st = c.list[i];
    const owner = c.owner;
    const mine = c.uid === ST.me.uid;

    /* If media data is not yet loaded, fetch authoritative record */
    if (st.type !== 'text' && !storySrc(st)) {
      const full = await StatusEngine.fetchAuthoritative(c.uid, st.id);
      if (full) {
        st = Object.assign(st, full);
        c.list[i] = st;
      }
    }

    s('story-head').innerHTML = `
      ${getAvatarHTML(owner, '', 'width:40px;height:40px')}
      <div class="who" style="flex:1;min-width:0">
        <b style="display:block;font-size:15px">${esc(userLabel(owner))}${mine ? ' · You' : ''}</b>
        <small style="opacity:0.8;font-size:12px">${esc(fmtWhen(st.ts))}${mine ? ' · ' + Object.keys(st.views || {}).length + ' views' : ''}</small>
      </div>
      ${mine ? '<button class="st-react" id="st-del" aria-label="Delete status">🗑️</button>' : ''}
      <button class="st-react" id="st-close" aria-label="Close">✕</button>
    `;

    if (s('st-close')) s('st-close').onclick = e => { e.stopPropagation(); this.close(); };
    if (s('st-del')) s('st-del').onclick = e => {
      e.stopPropagation();
      confirmSheet('Delete Status', 'Remove this status update for everyone?', 'Delete', () => {
        deleteStatus(st.id);
        this.close();
      }, true);
    };

    const body = s('story-body');
    const src = storySrc(st);
    if (st.type === 'text') {
      body.innerHTML = `<div class="st-text" style="background:${esc(st.bg || 'var(--kr-brand)')}">${esc(st.text || '')}</div>`;
    } else if (st.type === 'video') {
      body.innerHTML = `<video src="${esc(src)}" autoplay playsinline controls preload="metadata"></video>`;
    } else {
      body.innerHTML = `<img src="${esc(src)}" alt="Status">`;
    }

    s('story-caption').textContent = (st.type === 'text') ? '' : (st.text || '');
    const foot = s('story-foot');

    if (mine) {
      const viewsCount = Object.keys(st.views || {}).length;
      foot.innerHTML = `
        <div style="flex:1;color:rgba(255,255,255,0.85);font-size:13.5px;font-weight:600">
          👁️ ${viewsCount} viewer${viewsCount === 1 ? '' : 's'}
        </div>
        <button class="btn sm ghost" id="st-viewers-btn" style="color:#fff;background:rgba(255,255,255,0.2)">Viewers</button>
      `;
      if (s('st-viewers-btn')) s('st-viewers-btn').onclick = e => {
        e.stopPropagation();
        this.showViewers(st);
      };
    } else {
      foot.innerHTML = `
        <input id="st-reply" placeholder="Reply to ${esc(userLabel(owner))}…">
        <button class="st-react" id="st-react" aria-label="React">❤️</button>
      `;
      const rep = s('st-reply');
      if (rep) {
        rep.onkeydown = e => {
          if (e.key === 'Enter') {
            e.preventDefault();
            this.reply(c.uid, rep.value);
          }
        };
      }
      if (s('st-react')) {
        s('st-react').onclick = e => {
          e.stopPropagation();
          this.react(c.uid, st.id, '❤️');
        };
      }
      /* Mark viewed */
      db.ref('status/' + c.uid + '/' + st.id + '/views/' + ST.me.uid).set(now()).catch(() => {});
      db.ref('stories/' + c.uid + '/' + st.id + '/views/' + ST.me.uid).set(now()).catch(() => {});
    }

    this.progress(i);
    this.autoAdvance(st);
  },

  progress(i) {
    const bars = $$('#story-progress i b');
    bars.forEach((b, idx) => {
      b.style.width = idx < i ? '100%' : (idx === i ? '0%' : '0%');
    });
    clearInterval(this.timer);
    const total = (this.ctx && this.ctx.list[i] && this.ctx.list[i].type === 'video') ? 15000 : 6000;
    const t0 = now();
    this.timer = setInterval(() => {
      const pct = clamp((now() - t0) / total, 0, 1);
      if (bars[i]) bars[i].style.width = Math.round(pct * 100) + '%';
      if (pct >= 1) {
        clearInterval(this.timer);
        this.next();
      }
    }, 90);
  },

  autoAdvance(st) {
    if (st.type !== 'video') return;
    const v = $('video', s('story-body'));
    if (!v) return;
    v.onended = () => this.next();
  },

  next() {
    if (!this.ctx) return;
    clearInterval(this.timer);
    this.show(this.ctx.idx + 1);
  },

  prev() {
    if (!this.ctx) return;
    clearInterval(this.timer);
    this.show(Math.max(0, this.ctx.idx - 1));
  },

  close() {
    clearInterval(this.timer);
    this.timer = null;
    const v = $('video', s('story-body'));
    if (v) { try { v.pause(); } catch (e) {} }
    const b = s('story-body'); if (b) b.innerHTML = '';
    this.ctx = null;
    Nav.close('ov-story');
    renderStatus();
  },

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    const v = $('video', s('story-body'));
    if (v) { try { v.pause(); } catch (e) {} }
  },

  react(uid, id, emoji) {
    db.ref('status/' + uid + '/' + id + '/reactions/' + ST.me.uid).set(emoji).catch(() => {});
    toast('Sent reaction ' + emoji);
  },

  reply(uid, text) {
    if (!text || !text.trim()) return;
    const cid = chatIdFor(uid);
    db.ref('messages/' + cid).push({
      sender: ST.me.uid,
      timestamp: now(),
      status: 'sent',
      type: 'text',
      text: text.trim().slice(0, 1000),
      replyTo: { name: 'Status', text: 'Replied to status update' }
    }).then(() => {
      bumpUnread(uid, cid);
      toast('Reply sent');
      this.close();
    }).catch(() => toast('Could not send reply.'));
  },

  showViewers(st) {
    const views = st.views || {};
    const viewerUids = Object.keys(views);
    if (!viewerUids.length) {
      toast('No one has viewed this status yet.');
      return;
    }
    openSheet('Viewed by (' + viewerUids.length + ')', viewerUids.map(uid => {
      const u = ST.users[uid] || { uid: uid };
      return {
        icon: '👁️',
        label: userLabel(u),
        sub: fmtWhen(views[uid]),
        run: () => openProfile(uid)
      };
    }));
  }
};
