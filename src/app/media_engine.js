/* ============================ MEDIA ENGINE (P2P + COMPRESSION) ============================ */

/* ============================ UPLOAD / TRANSFER BAR ============================ */
const UpBar = {
  timer: null,
  show(name) {
    const b = s('upload-bar'); if (!b) return;
    const n = s('ub-name'), st = s('ub-state'), pr = s('ub-progress');
    if (n) n.textContent = name || 'Preparing…';
    if (st) st.textContent = '0%';
    if (pr) pr.style.width = '0%';
    b.classList.add('show');
  },
  set(pct, text) {
    const p = clamp(pct || 0, 0, 1);
    const i = s('ub-progress'); if (i) i.style.width = Math.round(p * 100) + '%';
    const st = s('ub-state');
    if (st) st.textContent = text || (Math.round(p * 100) + '%');
  },
  done(text, ms) {
    const b = s('upload-bar'); if (!b) return;
    const i = s('ub-progress'), st = s('ub-state');
    if (i) i.style.width = '100%';
    if (st) st.textContent = text || 'Sent';
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { if (b) b.classList.remove('show'); }, ms || 1600);
  },
  fail(text) {
    const b = s('upload-bar'); if (!b) return;
    const st = s('ub-state');
    if (st) st.textContent = text || 'Could not complete transfer';
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { if (b) b.classList.remove('show'); }, 3800);
  },
  hide() {
    const b = s('upload-bar'); if (b) b.classList.remove('show');
  }
};

function blobToDataURL(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(blob);
  });
}

function dataURLToBlob(d) {
  const parts = String(d).split(','), mime = (parts[0].match(/:(.*?);/) || [])[1] || 'application/octet-stream';
  const bin = atob(parts[1] || '');
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

function loadImage(blob) {
  return new Promise((res, rej) => {
    if (window.createImageBitmap) {
      createImageBitmap(blob).then(res).catch(() => legacy());
    } else legacy();

    function legacy() {
      const img = new Image(), u = URL.createObjectURL(blob);
      img.onload = () => { URL.revokeObjectURL(u); res(img); };
      img.onerror = () => { URL.revokeObjectURL(u); rej(new Error('decode-failed')); };
      img.src = u;
    }
  });
}

async function compressImage(file, maxSide, quality, byteBudget) {
  let bm = await loadImage(file);
  let w = bm.width || bm.naturalWidth, h = bm.height || bm.naturalHeight;
  const scale = Math.min(1, maxSide / Math.max(w, h));
  w = Math.max(1, Math.round(w * scale));
  h = Math.max(1, Math.round(h * scale));
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const cx = cv.getContext('2d');
  cx.fillStyle = '#fff';
  cx.fillRect(0, 0, w, h);
  cx.drawImage(bm, 0, 0, w, h);
  if (bm.close) { try { bm.close(); } catch (e) {} }

  let q = quality || 0.75;
  let blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', q));
  if (byteBudget) {
    let guard = 0;
    while (blob && blob.size > byteBudget && guard++ < 6) {
      if (q > 0.35) {
        q -= 0.12;
      } else {
        w = Math.round(w * 0.82);
        h = Math.round(h * 0.82);
        cv.width = w; cv.height = h;
        const c2 = cv.getContext('2d');
        c2.fillStyle = '#fff';
        c2.fillRect(0, 0, w, h);
        c2.drawImage(bm, 0, 0, w, h);
      }
      blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', Math.max(0.28, q)));
      if (!blob) break;
    }
  }
  return { blob: blob, w: w, h: h };
}

function probeDuration(blob, kind) {
  return new Promise(res => {
    const url = URL.createObjectURL(blob);
    const el = document.createElement(kind === 'audio' ? 'audio' : 'video');
    const done = v => {
      clearTimeout(t);
      try { URL.revokeObjectURL(url); } catch (e) {}
      res(v);
    };
    const t = setTimeout(() => done(0), 6000);
    el.preload = 'metadata';
    el.onloadedmetadata = () => done(isFinite(el.duration) ? el.duration : 0);
    el.onerror = () => done(0);
    el.src = url;
  });
}

function looksLikeDeclaredType(file) {
  if (!/^image\//.test(file.type || '')) return Promise.resolve(true);
  return new Promise(res => {
    const fr = new FileReader();
    fr.onload = () => {
      const b = new Uint8Array(fr.result);
      const jpg = b[0] === 0xFF && b[1] === 0xD8;
      const png = b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E;
      const gif = b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46;
      const webp = b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42;
      res(jpg || png || gif || webp);
    };
    fr.onerror = () => res(false);
    fr.readAsArrayBuffer(file.slice(0, 16));
  });
}

function kindOf(file) {
  const t = (file.type || '').toLowerCase();
  if (/^image\//.test(t)) return 'image';
  if (/^video\//.test(t)) return 'video';
  if (/^audio\//.test(t)) return 'audio';
  const n = (file.name || '').toLowerCase();
  if (/\.(png|jpe?g|gif|webp|avif|bmp)$/.test(n)) return 'image';
  if (/\.(mp4|webm|mov|m4v|mkv|avi)$/.test(n)) return 'video';
  if (/\.(mp3|m4a|aac|wav|ogg|opus|flac)$/.test(n)) return 'audio';
  return 'file';
}

function fileEmoji(name) {
  const e = String(name || '').split('.').pop().toLowerCase();
  if (e === 'pdf') return '📕';
  if (['doc','docx','rtf','odt'].indexOf(e) >= 0) return '📄';
  if (['xls','xlsx','csv','ods'].indexOf(e) >= 0) return '📊';
  if (['ppt','pptx','odp'].indexOf(e) >= 0) return '📽️';
  if (['zip','rar','7z','tar','gz'].indexOf(e) >= 0) return '🗜️';
  if (['txt','md','json'].indexOf(e) >= 0) return '📝';
  if (['mp4','webm','mov','mkv'].indexOf(e) >= 0) return '🎬';
  if (['mp3','m4a','wav','ogg'].indexOf(e) >= 0) return '🎵';
  return '📎';
}

function downloadBlobUrl(url, name) {
  const a = document.createElement('a');
  a.href = url;
  a.download = name || 'klyro-file';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

async function sha256(blob) {
  if (!(window.crypto && crypto.subtle)) return '';
  try {
    const buf = await blob.arrayBuffer();
    const d = await crypto.subtle.digest('SHA-256', buf);
    return Array.prototype.map.call(new Uint8Array(d), b => b.toString(16).padStart(2, '0')).join('');
  } catch (e) { return ''; }
}

const MediaEngine = {
  cfg: KLYRO_CONFIG.transfer,
  servers: { iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }] },
  links: {},
  out: {},
  inn: {},
  ready: false,

  init() {
    if (this.ready || !ST.me) return;
    this.ready = true;
    const uid = ST.me.uid;
    listen('eng:box', 'p2pInbox/' + uid, 'child_added', sn => {
      const v = sn.val() || {};
      sn.ref.remove().catch(() => {});
      this.signal(v);
    });
    listen('eng:req', 'transferRequests/' + uid, 'child_added', sn => {
      const v = sn.val() || {};
      sn.ref.remove().catch(() => {});
      if (v.transferId && this.out[v.transferId]) {
        const t = this.out[v.transferId];
        t.cancelled = false;
        t.tries = 0;
        this.arm(t);
        toast('Resending “' + (t.name || 'file') + '”…');
      } else {
        toast('The sender no longer has that file — ask them to send it again.');
      }
    });

    Object.keys(this.out).forEach(id => {
      const t = this.out[id];
      if (t && t.blob && (t.state === 'queued' || t.state === 'waiting')) this.arm(t);
    });
  },

  teardown() {
    Object.keys(this.links).forEach(p => this.drop(p));
    this.links = {};
    this.ready = false;
  },

  sig(peer, payload) {
    payload.from = ST.me.uid;
    payload.rid = peer + ':' + now().toString(36) + Math.random().toString(36).slice(2, 6);
    db.ref('p2pInbox/' + peer).push(payload).catch(() => {});
  },

  async signal(v) {
    const peer = v.from;
    if (!peer || peer === ST.me.uid) return;
    const l = this.links[peer] = this.links[peer] || {};
    try {
      if (v.type === 'offer') {
        if (l.pc && l.pendingOut && String(ST.me.uid) > String(peer)) return;
        if (l.pc && l.pendingOut) { try { l.pc.close(); } catch (e) {} this.drop(peer, true); }
        const l2 = this.links[peer] = this.links[peer] || {};
        const pc = new RTCPeerConnection(this.servers);
        l2.pc = pc; l2.answerer = true;
        pc.onicecandidate = e => { if (e.candidate) this.sig(peer, { type: 'ice', candidate: e.candidate.toJSON() }); };
        pc.ondatachannel = e => this.bind(l2, e.channel);
        pc.onconnectionstatechange = () => {
          if (['failed', 'closed', 'disconnected'].indexOf(pc.connectionState) >= 0) this.drop(peer);
        };
        await pc.setRemoteDescription(new RTCSessionDescription(v.sdp));
        const ans = await pc.createAnswer();
        await pc.setLocalDescription(ans);
        this.sig(peer, { type: 'answer', sdp: { type: ans.type, sdp: ans.sdp } });
      } else if (v.type === 'answer') {
        if (l.pc && l.pc.signalingState !== 'stable') await l.pc.setRemoteDescription(new RTCSessionDescription(v.sdp));
      } else if (v.type === 'ice') {
        if (l.pc && v.candidate) { try { await l.pc.addIceCandidate(new RTCIceCandidate(v.candidate)); } catch (e) {} }
      }
    } catch (e) { DBG('signal error', e && e.message); }
  },

  bind(l, dc) {
    l.dc = dc;
    dc.binaryType = 'arraybuffer';
    try { dc.bufferedAmountLowThreshold = this.cfg.lowWater; } catch (e) {}
    dc.onopen = () => {
      l.open = true;
      clearTimeout(l.timer);
      if (l.resolve) { l.resolve(dc); l.resolve = null; }
      this.flush(l);
    };
    dc.onclose = () => {
      l.open = false;
      if (l.in) this.abortIncoming(l, 'The connection closed mid-transfer.');
      this.flush(l);
    };
    dc.onerror = () => { l.open = false; };
    dc.onmessage = e => this.onData(l, dc, e.data);
  },

  channel(peer) {
    const l = this.links[peer] = this.links[peer] || {};
    if (l.open && l.dc && l.dc.readyState === 'open') return Promise.resolve(l.dc);
    if (l.pending) return l.pending;
    l.pending = new Promise((res, rej) => {
      const pc = new RTCPeerConnection(this.servers);
      l.pc = pc; l.pendingOut = true;
      pc.onicecandidate = e => { if (e.candidate) this.sig(peer, { type: 'ice', candidate: e.candidate.toJSON() }); };
      pc.onconnectionstatechange = () => { if (['failed', 'closed'].indexOf(pc.connectionState) >= 0) this.drop(peer); };
      pc.ondatachannel = e => this.bind(l, e.channel);
      const dc = pc.createDataChannel('klyro', { ordered: true });
      this.bind(l, dc);
      l.resolve = res; l.reject = rej;
      pc.createOffer().then(o => pc.setLocalDescription(o)).then(() => {
        this.sig(peer, { type: 'offer', sdp: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } });
      }).catch(err => { l.pendingOut = false; rej(err); });
      clearTimeout(l.timer);
      l.timer = setTimeout(() => {
        if (!l.open) { l.pendingOut = false; rej(new Error('connect-timeout')); }
      }, this.cfg.connectTimeout);
    }).then(dc => { l.pending = null; l.pendingOut = false; return dc; })
      .catch(err => { l.pending = null; l.pendingOut = false; throw err; });
    return l.pending;
  },

  drop(peer, quiet) {
    const l = this.links[peer]; if (!l) return;
    clearTimeout(l.timer);
    try { if (l.dc) l.dc.close(); } catch (e) {}
    try { if (l.pc) l.pc.close(); } catch (e) {}
    if (l.in) this.abortIncoming(l, 'Connection lost.');
    (l.queue || []).forEach(t => {
      if (t.state === 'transferring' || t.state === 'preparing') {
        this.setState(t, 'failed', 'Connection dropped before the file finished.');
      }
    });
    delete this.links[peer];
    if (!quiet) DBG('link dropped', peer);
  },

  flush(l) {
    if (l.busy) return;
    const t = (l.queue || [])[0];
    if (!t) return;
    l.busy = true;
    this.run(l, t).then(() => {
      l.queue = (l.queue || []).filter(x => x !== t);
      l.busy = false;
      setTimeout(() => this.flush(l), 40);
    }).catch(() => {
      l.queue = (l.queue || []).filter(x => x !== t);
      l.busy = false;
      setTimeout(() => this.flush(l), 40);
    });
  },

  async send(peer, chatId, msgId, blob, kind, meta) {
    const id = 'tr' + now().toString(36) + Math.random().toString(36).slice(2, 7);
    const t = {
      id: id, msgId: msgId, peer: peer, chatId: chatId, blob: blob, kind: kind,
      name: (meta && meta.name) || 'file', mime: (meta && meta.mime) || blob.type || 'application/octet-stream',
      dur: (meta && meta.dur) || 0, size: blob.size, sent: 0, tries: 0, cancelled: false,
      state: 'queued', checksum: '', t0: now()
    };
    this.out[id] = t;
    this.publish(t, { state: 'preparing', transferId: id });
    this.setState(t, 'preparing');
    if (this.cfg.verifyChecksum) t.checksum = await sha256(blob);
    Store.put(msgId, blob, { chatId: chatId, name: t.name, mime: t.mime, size: t.size, transferId: id, mine: true });
    try {
      localStorage.setItem('kr_out_' + id, JSON.stringify({ id: id, msgId: msgId, peer: peer, chatId: chatId, kind: kind, name: t.name, size: t.size, mime: t.mime, dur: t.dur }));
    } catch (e) {}
    this.arm(t);
    return t;
  },

  arm(t) {
    if (!ST.me || t.cancelled) return;
    const go = () => {
      const l = this.links[t.peer] = this.links[t.peer] || {};
      l.queue = l.queue || [];
      if (l.queue.indexOf(t) < 0) l.queue.push(t);
      this.flush(l);
    };
    db.ref('users/' + t.peer + '/status').once('value').then(sn => {
      if (sn.val() === 'online') { go(); return; }
      this.setState(t, 'waiting', 'Waiting for ' + this.peerName(t.peer) + ' to come online');
      unlisten('eng:peer:' + t.peer);
      listen('eng:peer:' + t.peer, 'users/' + t.peer + '/status', 'value', s2 => {
        if (s2.val() === 'online' && !t.cancelled) {
          unlisten('eng:peer:' + t.peer);
          go();
        }
      });
    }).catch(() => go());
  },

  peerName(uid) {
    const u = ST.users[uid];
    return (u && (u.name || u.username)) || 'recipient';
  },

  async run(l, t) {
    if (t.cancelled) { this.setState(t, 'cancelled'); return; }
    this.setState(t, 'preparing', null, 'Connecting…');
    let dc;
    try {
      dc = await this.channel(t.peer);
    } catch (e) {
      if (t.tries < this.cfg.maxRetries) {
        t.tries++;
        this.setState(t, 'retrying', null, 'Reconnecting… (attempt ' + (t.tries + 1) + ')');
        await new Promise(r => setTimeout(r, 1200));
        return this.run(l, t);
      }
      return this.setState(t, 'failed', 'Could not reach ' + this.peerName(t.peer) + '. They may be offline.');
    }
    if (t.cancelled) {
      try { dc.send(JSON.stringify({ t: 'cancel', id: t.id })); } catch (e) {}
      this.setState(t, 'cancelled');
      return;
    }

    l.in = null;
    dc.send(JSON.stringify({
      t: 'begin', id: t.id, msgId: t.msgId, chatId: t.chatId, kind: t.kind,
      name: t.name, size: t.size, mime: t.mime, dur: t.dur, checksum: t.checksum
    }));
    this.setState(t, 'transferring', 0);

    const CH = this.cfg.chunkSize;
    let off = 0, lastTick = now(), lastBytes = 0;
    const idle = setTimeout(() => { t.stalled = true; }, this.cfg.idleTimeout);

    while (off < t.size) {
      if (t.cancelled) {
        try { dc.send(JSON.stringify({ t: 'cancel', id: t.id })); } catch (e) {}
        clearTimeout(idle);
        return this.setState(t, 'cancelled');
      }
      if (dc.readyState !== 'open') {
        clearTimeout(idle);
        return this.setState(t, 'failed', 'The connection closed before the file finished.');
      }
      if (t.stalled) {
        clearTimeout(idle);
        return this.setState(t, 'failed', 'The transfer stalled — tap to retry.');
      }
      if (dc.bufferedAmount > this.cfg.highWater) {
        await new Promise(res => {
          const bail = setTimeout(res, 6000);
          const h = () => { clearTimeout(bail); try { dc.removeEventListener('bufferedamountlow', h); } catch (e) {} res(); };
          try { dc.addEventListener('bufferedamountlow', h); } catch (e) { clearTimeout(bail); res(); }
        });
        continue;
      }
      const buf = await t.blob.slice(off, off + CH).arrayBuffer();
      dc.send(buf);
      off += buf.byteLength;
      t.sent = off; t.stalled = false;
      const nowT = now();
      if (nowT - lastTick > 220 || off >= t.size) {
        const pct = t.size ? off / t.size : 1;
        const speed = Math.round((off - lastBytes) / Math.max(1, (nowT - lastTick) / 1000));
        lastTick = nowT; lastBytes = off;
        this.setState(t, 'transferring', pct, null, speed);
      }
    }
    clearTimeout(idle);
    dc.send(JSON.stringify({ t: 'end', id: t.id }));
    this.setState(t, 'verifying', 1, 'Checking file integrity…');
    const confirmed = await this.awaitAck(t);
    if (confirmed) {
      this.publish(t, { state: 'completed', checksum: t.checksum });
      this.setState(t, 'completed', 1);
      delete this.out[t.id];
      try { localStorage.removeItem('kr_out_' + t.id); } catch (e) {}
    } else {
      this.setState(t, 'failed', 'No confirmation from receiver — tap to retry.');
    }
  },

  awaitAck(t) {
    return new Promise(res => {
      const to = setTimeout(() => { t._ack = null; res(false); }, 20000);
      t._ack = ok => { clearTimeout(to); t._ack = null; res(!!ok); };
    });
  },

  cancel(id) {
    const t = this.out[id]; if (!t) return;
    t.cancelled = true;
    const l = this.links[t.peer];
    if (l && l.dc && l.dc.readyState === 'open') {
      try { l.dc.send(JSON.stringify({ t: 'cancel', id: id })); } catch (e) {}
    }
    if (l) l.queue = (l.queue || []).filter(x => x !== t);
    if (t.state !== 'transferring') this.setState(t, 'cancelled');
    UpBar.fail('Transfer cancelled');
  },

  retry(id) {
    const t = this.out[id];
    if (!t) { this.resume(id); return; }
    t.cancelled = false; t.tries = 0; t.sent = 0; t._done = false;
    this.setState(t, 'queued', 0, 'Preparing…');
    this.arm(t);
  },

  resume(id) {
    let rec = null;
    try { rec = JSON.parse(localStorage.getItem('kr_out_' + id) || 'null'); } catch (e) {}
    if (!rec) { toast('That transfer is no longer on this device.'); return; }
    Store.get(rec.msgId).then(e => {
      if (!e || !e.blob) { toast('File was cleared from this device — please pick it again.'); return; }
      this.out[id] = {
        id: id, msgId: rec.msgId, peer: rec.peer, chatId: rec.chatId, blob: e.blob, kind: rec.kind,
        name: rec.name, mime: rec.mime, dur: rec.dur || 0, size: e.blob.size, sent: 0, tries: 0,
        cancelled: false, state: 'queued', checksum: '', t0: now()
      };
      this.retry(id);
    });
  },

  requestResend(tid, fromUid) {
    if (!tid || !fromUid) return;
    db.ref('transferRequests/' + fromUid + '/' + tid).set({ ts: now(), transferId: tid, by: ST.me.uid })
      .then(() => toast('Resend requested — sender will retry.'))
      .catch(() => toast('Could not send the request.'));
  },

  onData(l, dc, data) {
    if (typeof data === 'string') {
      let c = null;
      try { c = JSON.parse(data); } catch (e) { return; }
      if (c.t === 'begin') {
        const T = {
          id: c.id, msgId: c.msgId, chatId: c.chatId, kind: c.kind, name: c.name, size: c.size,
          mime: c.mime, dur: c.dur || 0, checksum: c.checksum || '', chunks: [], got: 0, last: now()
        };
        this.inn[c.id] = T; l.in = T;
        db.ref('messages/' + c.chatId + '/' + c.msgId + '/media').update({
          kind: 'p2p', transferId: c.id, name: c.name, size: c.size, mime: c.mime, dur: c.dur || 0, state: 'receiving'
        }).catch(() => {});
        this.setState({ msgId: c.msgId, id: c.id, name: c.name, peer: c.from, kind: c.kind, size: c.size }, 'receiving', 0);
      } else if (c.t === 'end') {
        const T = (l.in && l.in.id === c.id) ? l.in : this.inn[c.id];
        if (T) this.complete(l, T, dc);
      } else if (c.t === 'done') {
        const t = this.out[c.id];
        if (t && t._ack) t._ack(!!c.ok);
      } else if (c.t === 'cancel') {
        if (l.in && l.in.id === c.id) {
          const mid = l.in.msgId;
          this.abortIncoming(l, 'Sender cancelled the transfer.');
          this.setState({ msgId: mid, id: c.id }, 'cancelled');
        } else {
          const t = this.out[c.id];
          if (t) { t.cancelled = true; this.setState(t, 'cancelled'); }
        }
      }
      return;
    }
    const T = l.in;
    if (!T) return;
    T.chunks.push(data); T.got += data.byteLength; T.last = now();
    if (now() - (T.tick || 0) > 220) {
      T.tick = now();
      this.setState({ msgId: T.msgId, id: T.id, name: T.name, peer: T.from, kind: T.kind, size: T.size }, 'receiving', T.size ? T.got / T.size : 0);
    }
  },

  async complete(l, T, dc) {
    l.in = null;
    delete this.inn[T.id];
    const blob = new Blob(T.chunks, { type: T.mime || 'application/octet-stream' });
    T.chunks = null;
    if (T.size && blob.size !== T.size) {
      this.setState({ msgId: T.msgId, id: T.id, name: T.name }, 'failed', 'The file arrived incomplete.');
      try { dc.send(JSON.stringify({ t: 'done', id: T.id, ok: false })); } catch (e) {}
      return;
    }
    if (T.checksum && this.cfg.verifyChecksum) {
      const sum = await sha256(blob);
      if (sum && sum !== T.checksum) {
        this.setState({ msgId: T.msgId, id: T.id, name: T.name }, 'failed', 'File did not arrive intact — ask sender to retry.');
        try { dc.send(JSON.stringify({ t: 'done', id: T.id, ok: false })); } catch (e) {}
        return;
      }
    }
    await Store.put(T.msgId, blob, { chatId: T.chatId, name: T.name, mime: T.mime, size: blob.size, transferId: T.id });
    db.ref('messages/' + T.chatId + '/' + T.msgId + '/media/state').set('completed').catch(() => {});
    try { dc.send(JSON.stringify({ t: 'done', id: T.id, ok: true, msgId: T.msgId })); } catch (e) {}
    this.setState({ msgId: T.msgId, id: T.id, name: T.name, size: T.size }, 'completed', 1);
    if (!ST.chat || ST.chat.chatId !== T.chatId) notify('File received', T.name || 'New media');
  },

  abortIncoming(l, why) {
    const T = l.in; if (!T) return;
    l.in = null; delete this.inn[T.id];
    this.setState({ msgId: T.msgId, id: T.id, name: T.name }, 'failed', why);
  },

  publish(t, extra) {
    const patch = Object.assign({}, extra || {}, { ts: now() });
    db.ref('transfers/' + t.peer + '/' + t.id).update(patch).catch(() => {});
    if (t.chatId && t.msgId) {
      db.ref('messages/' + t.chatId + '/' + t.msgId + '/media').update(Object.assign({
        kind: 'p2p', transferId: t.id, name: t.name, size: t.size, mime: t.mime, dur: t.dur || 0
      }, patch)).catch(() => {});
    }
  },

  setState(t, state, pct, note, speed) {
    const key = t.msgId;
    if (!key) return;
    const meta = ST.transferMeta[key] = ST.transferMeta[key] || {};
    meta.state = state;
    meta.pct = pct === undefined ? meta.pct : clamp(pct, 0, 1);
    meta.note = note || '';
    meta.speed = speed || 0;
    meta.id = t.id || meta.id;
    if (state === 'completed') meta.pct = 1;

    const bar = s('mb-' + key), txt = s('ms-' + key);
    if (bar) {
      bar.style.width = Math.round((meta.pct || 0) * 100) + '%';
      if (bar.parentNode) bar.parentNode.style.display = state === 'completed' ? 'none' : 'block';
    }
    if (txt) txt.textContent = MediaUI.label(state, meta.pct, meta.note, meta.speed);
    if (state === 'completed' && ST.chatMsgs[key]) {
      Store.get(key).then(rec => { if (rec && rec.blob) refreshMessage(key); });
    }
    if (ST.activeTransfer && ST.activeTransfer.id === t.id) {
      if (state === 'completed') UpBar.done('Transfer complete');
      else if (state === 'failed' || state === 'cancelled') UpBar.fail(meta.note || 'Transfer failed');
      else UpBar.set(meta.pct || 0, MediaUI.label(state, meta.pct, meta.note, meta.speed));
    }
  }
};

const MediaUI = {
  label(state, pct, note, speed) {
    const pc = Math.round((pct || 0) * 100);
    switch (state) {
      case 'queued': return 'Preparing…';
      case 'preparing': return note || 'Preparing…';
      case 'waiting': return note || 'Waiting for receiver…';
      case 'connecting': return 'Connecting…';
      case 'transferring': return 'Sending ' + pc + '%' + (speed ? ' · ' + fmtSize(speed) + '/s' : '');
      case 'receiving': return 'Receiving ' + pc + '%';
      case 'verifying': return note || 'Verifying integrity…';
      case 'completed': return 'Transfer complete';
      case 'retrying': return note || 'Retrying…';
      case 'cancelled': return 'Cancelled';
      case 'unavailable': return note || 'Media unavailable';
      default: return note || 'Transfer failed';
    }
  },

  actions(m, meta) {
    const mine = m.sender === ST.me.uid;
    const st = (m.media && m.media.state) || meta.state || 'queued';
    const tid = (m.media && m.media.transferId) || meta.id || '';
    const out = [];
    if (mine && ['queued', 'preparing', 'waiting', 'connecting', 'transferring', 'retrying'].indexOf(st) >= 0)
      out.push(`<button data-tcancel="${esc(tid)}">Cancel</button>`);
    if (mine && ['failed', 'cancelled', 'unavailable'].indexOf(st) >= 0)
      out.push(`<button data-tretry="${esc(tid)}">Retry</button>`);
    if (!mine && ['failed', 'cancelled', 'unavailable'].indexOf(st) >= 0)
      out.push(`<button data-trequest="${esc(tid)}" data-tfrom="${esc(m.sender)}">Request again</button>`);
    return out.length ? `<div class="mactions">${out.join('')}</div>` : '';
  }
};

/* ============================ MEDIA VIEWER ============================ */
const Viewer = {
  current: null,

  open(opts) {
    const body = s('media-body'); if (!body) return;
    const url = safeMedia(opts.url);
    if (!url) { toast('That media is not available on this device.'); return; }
    this.current = opts.key || null;
    if (opts.kind === 'video') {
      body.innerHTML = `<video src="${esc(url)}" controls autoplay playsinline preload="metadata"></video>`;
      const v = $('video', body);
      if (v) v.onerror = () => { body.innerHTML = '<div style="color:#fff;text-align:center;padding:24px">Could not play this video on this device.</div>'; };
    } else if (opts.kind === 'audio') {
      body.innerHTML = `<div style="background:var(--kr-elev);border-radius:18px;padding:22px;min-width:min(340px,88vw);text-align:center">
        <div style="font-size:36px">🎵</div>
        <div style="font-weight:650;margin:8px 0 14px">${esc(opts.name || 'Audio')}</div>
        <audio controls autoplay preload="metadata" src="${esc(url)}" style="width:100%"></audio></div>`;
    } else {
      body.innerHTML = `<img src="${esc(url)}" alt="${esc(opts.name || '')}" style="max-width:94vw;max-height:80vh;border-radius:12px">`;
    }
    Nav.open('ov-media');
  },

  close() {
    const body = s('media-body');
    if (body) {
      const v = $('video', body), a = $('audio', body);
      if (v) { try { v.pause(); } catch (e) {} }
      if (a) { try { a.pause(); } catch (e) {} }
      body.innerHTML = '';
    }
    if (this.current) Store.release(this.current);
    this.current = null;
  }
};
