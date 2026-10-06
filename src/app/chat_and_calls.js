/* ============================ CHAT & CALLS ============================ */

/* ---------------- Chat entries & preview ---------------- */
function chatEntries() {
  const out = [];
  const seen = {};

  Object.keys(ST.me.contacts || {}).forEach(uid => {
    const u = ST.users[uid]; if (!u || isArchived(uid)) return;
    seen[uid] = true;
    out.push({ cid: chatIdFor(uid), type: 'direct', targetId: uid, other: u, at: (u.lastMsgAt || 0) });
  });

  Object.keys(ST.groups || {}).forEach(gid => {
    const g = ST.groups[gid];
    out.push({ cid: gid, type: 'group', targetId: gid, other: Object.assign({ uid: gid, name: g.name, photo: g.photo }, g), at: g.lastMsgAt || g.createdAt || 0 });
  });

  Object.keys(ST.unread || {}).forEach(cid => {
    if (out.some(x => x.cid === cid)) return;
    const peer = cid.split('_').find(x => x !== ST.me.uid);
    const u = ST.users[peer];
    if (u) out.push({ cid: cid, type: 'direct', targetId: peer, other: u, at: 0 });
  });

  return out.sort((a, b) => {
    const pa = isPinnedChat(a.cid) ? 1 : 0, pb = isPinnedChat(b.cid) ? 1 : 0;
    if (pa !== pb) return pb - pa;
    return (b.at || 0) - (a.at || 0);
  });
}

function renderChats() {
  const box = s('chat-list'); if (!box || !ST.me) return;
  const q = (s('main-search') && s('main-search').value || '').toLowerCase().trim();
  let list = chatEntries();
  if (q) list = list.filter(e => (userLabel(e.other) + ' ' + (e.other.username || '')).toLowerCase().indexOf(q) >= 0);

  const empty = s('chats-empty');
  if (!list.length) {
    box.innerHTML = '';
    if (empty) empty.style.display = 'flex';
    return;
  }
  if (empty) empty.style.display = 'none';

  box.innerHTML = list.slice(0, 60).map(e => {
    const u = e.other;
    const unread = Number(ST.unread[e.cid]) || 0;
    const online = isUserOnlineNow(u);
    const time = fmtWhen(e.at);
    const sub = chatPreviewCache[e.cid] || (e.type === 'group' ? 'Group chat' : (online ? 'Online now' : (u.username ? '@' + u.username : 'Tap to chat')));

    return `
      <div class="row" data-open="${esc(e.cid)}" data-type="${e.type}" data-target="${esc(e.targetId)}">
        <div class="presence ${online ? 'on' : ''}">${getAvatarHTML(u)}</div>
        <div class="mid">
          <div class="t1">
            <b>${esc(userLabel(u))}</b>
            ${isMuted(e.cid) ? '<span class="pillx" style="font-size:10px">muted</span>' : ''}
          </div>
          <div class="t2">${esc(sub)}</div>
        </div>
        <div class="end">
          ${time ? '<span class="time">' + esc(time) + '</span>' : ''}
          ${unread ? '<span class="dot">' + (unread > 99 ? '99+' : unread) + '</span>' : '<span style="height:20px"></span>'}
        </div>
      </div>
    `;
  }).join('');

  $$('[data-open]', box).forEach(el => {
    el.onclick = () => {
      const d = el.dataset;
      if (d.type === 'group') openChat(d.target, 'group', d.target);
      else attemptOpenChat(d.target);
    };
  });

  watchChatPreviews(list);
}

const chatPreviewCache = {};
const chatPreviewSlots = {};

function watchChatPreviews(list) {
  const keep = {};
  list.slice(0, 40).forEach(e => {
    keep[e.cid] = 1;
    if (chatPreviewSlots[e.cid]) return;
    const path = pathFor(e.cid, e.type);
    chatPreviewSlots[e.cid] = db.ref(path).limitToLast(1).on('child_added', sn => {
      const m = sn.val() || {};
      const who = e.type === 'group' && m.sender !== ST.me.uid ? (userLabel(ST.users[m.sender] || {}) + ': ') : '';
      const mine = m.sender === ST.me.uid ? 'You: ' : who;
      chatPreviewCache[e.cid] = mine + getPreviewText(m);
      const row = $('[data-open="' + e.cid + '"] .t2');
      if (row) row.textContent = chatPreviewCache[e.cid];
      const at = $('[data-open="' + e.cid + '"] .time');
      if (at && m.timestamp) at.textContent = fmtWhen(m.timestamp);
      if (e.other) e.other.lastMsgAt = Math.max(e.other.lastMsgAt || 0, m.timestamp || 0);
    });
    chatPreviewSlots[e.cid] = { ref: db.ref(path), fn: chatPreviewSlots[e.cid], path: path };
  });

  Object.keys(chatPreviewSlots).forEach(cid => {
    if (keep[cid]) return;
    try { chatPreviewSlots[cid].ref.off('child_added', chatPreviewSlots[cid]); } catch (e) {}
    delete chatPreviewSlots[cid];
  });
}

/* ---------------- Chat open / close ---------------- */
function attemptOpenChat(uid) {
  if (!uid) return;
  const u = ST.users[uid];
  const cid = chatIdFor(uid);
  if (isBlockedBy(u)) { toast('You blocked this account. Unblock to chat.'); return; }
  if (theyBlockedMe(u)) { toast('This user is not accepting messages.'); return; }
  if (u && !canMessageTarget(u)) { toast('This user only accepts messages from contacts.'); return; }
  openChat(uid, 'direct', cid);
}

function teardownChat() {
  unlistenAll('chat:');
  if (ST.chat && ST.chat.type === 'direct' && ST.me) {
    db.ref('typing/' + ST.chat.chatId + '/' + ST.me.uid).remove().catch(() => {});
  }
  Player.stopAll();
  Store.releaseAll();
}

function syncChatHeader() {
  if (!ST.chat) return;
  const nameEl = s('chat-name'), stEl = s('chat-status'), avEl = s('chat-avatar');
  if (ST.chat.type === 'direct') {
    const u = ST.users[ST.chat.targetId];
    if (!u) return;
    ST.chat.user = u; ST.chat.name = userLabel(u);
    if (nameEl) nameEl.textContent = userLabel(u);
    if (avEl) avEl.innerHTML = getAvatarHTML(u, 'sm');
    if (stEl) {
      if (ST.partnerTyping) {
        stEl.innerHTML = '<span class="typing">typing…</span>';
      } else if (!canSee(u, 'status')) {
        stEl.textContent = u.username ? '@' + u.username : '';
      } else {
        const on = isUserOnlineNow(u);
        stEl.textContent = on ? 'Online' : (canSee(u, 'lastSeen') ? formatLastSeen(u.lastSeen, u.name) : (u.username ? '@' + u.username : ''));
        stEl.style.color = on ? 'var(--kr-ok)' : 'var(--kr-mut)';
      }
    }
    const a = s('btn-call-audio'), v = s('btn-call-video');
    if (a) a.style.display = 'flex';
    if (v) v.style.display = 'flex';
  } else {
    const g = ST.groups[ST.chat.targetId]; if (!g) return;
    ST.chat.name = g.name || 'Group';
    ST.chat.members = g.members || {};
    if (nameEl) nameEl.textContent = ST.chat.name;
    if (avEl) avEl.innerHTML = getAvatarHTML(Object.assign({ uid: g.id, name: g.name, photo: g.photo }, g), 'sm');
    if (stEl) stEl.textContent = Object.keys(g.members || {}).length + ' members';
    const a = s('btn-call-audio'), v = s('btn-call-video');
    if (a) a.style.display = 'none';
    if (v) v.style.display = 'none';
  }
}

function openChat(targetId, type, cid) {
  if (!ST.me) return;
  teardownChat();
  ST.chat = { targetId: targetId, type: type, chatId: cid, clearedAt: clearedAt(cid) };
  ST.partnerTyping = false;
  ST.chatMsgs = {};
  ST.pinned = {};
  ST.transferMeta = {};
  ST.msgLimit = 60;

  const box = s('chat-messages');
  if (box) box.innerHTML = '<div class="empty" id="chat-empty" style="display:none"></div>';
  const inp = s('composer-input');
  if (inp) {
    inp.value = savedDraft(cid);
    autoGrow(inp);
  }
  cancelReply();
  closeTray();

  db.ref('unreadCounts/' + ST.me.uid + '/' + cid).set(0).catch(() => {});

  if (type === 'direct') {
    listen('chat:peer', 'users/' + targetId, 'value', sn => {
      if (sn.val()) {
        ST.users[targetId] = Object.assign({ uid: targetId }, sn.val());
        syncChatHeader();
      }
    });
  }
  syncChatHeader();

  const path = pathFor(cid, type);
  attachMessageListeners(path);

  listen('chat:typing', 'typing/' + cid, 'value', sn => {
    const o = sn.val() || {};
    const others = Object.keys(o).filter(u => u !== ST.me.uid && (type !== 'direct' || u === targetId));
    ST.partnerTyping = others.length > 0;
    if (type === 'direct') syncChatHeader();
    else if (s('chat-status')) s('chat-status').innerHTML = ST.partnerTyping ? '<span class="typing">someone is typing…</span>' : (Object.keys(ST.chat.members || {}).length + ' members');
  });

  listen('chat:pins', 'pins/' + cid, 'value', sn => { ST.pinned = sn.val() || {}; });

  // Save current chat draft before switching
  if (ST.chat && s('chat-input')) {
    try { localStorage.setItem('klyro_draft_' + ST.chat.cid, s('chat-input').value); } catch (e) {}
  }

  Nav.go('chat', { targetId: targetId, type: type, cid: cid });

  // Restore draft for this chat
  if (s('chat-input')) {
    try { s('chat-input').value = localStorage.getItem('klyro_draft_' + cid) || ''; } catch (e) {}
  }

  setTimeout(() => scrollToBottom(), 80);
}

function attachMessageListeners(path) {
  const limit = ST.msgLimit || 60;
  listenLimited('chat:add', path, 'child_added', sn => {
    const m = sn.val() || {}; m.key = sn.key;
    if (m.timestamp && m.timestamp <= (ST.chat.clearedAt || 0)) return;
    if (m.expiresAt && m.expiresAt < now()) return;
    if (ST.chatMsgs[sn.key]) return;
    ST.chatMsgs[sn.key] = m;
    renderMessage(m);
    markSeen(sn, m);
    scrollToBottom();
  }, limit);

  listenLimited('chat:chg', path, 'child_changed', sn => {
    const m = sn.val() || {}; m.key = sn.key;
    const prev = ST.chatMsgs[sn.key];
    ST.chatMsgs[sn.key] = m;
    if (!prev) { renderMessage(m); return; }
    if (m.deleted !== prev.deleted || m.text !== prev.text || m.edited !== prev.edited ||
        JSON.stringify(m.reactions || {}) !== JSON.stringify(prev.reactions || {}) ||
        (m.media && m.media.state) !== (prev.media && prev.media.state)) {
      refreshMessage(sn.key);
    } else {
      updateMetaOnly(sn.key, m);
    }
    markSeen(sn, m);
  }, limit);

  listenLimited('chat:rm', path, 'child_removed', sn => {
    delete ST.chatMsgs[sn.key];
    const el = s('m-' + sn.key); if (el) el.remove();
    updateEmptyState();
  });
}

function scrollToBottom() {
  const b = s('chat-messages'); if (!b) return;
  b.scrollTop = b.scrollHeight;
}

function updateEmptyState() {
  const b = s('chat-messages'); if (!b) return;
  const has = b.querySelector('.mwrap');
  const e = s('chat-empty');
  if (e) {
    e.style.display = has ? 'none' : 'flex';
  }
}

function markSeen(snap, m) {
  if (!m || m.sender === ST.me.uid) return;
  const mineReads = privacyOf(ST.me).readReceipts !== false;
  if (ST.chat.type === 'direct') {
    if (mineReads && m.status !== 'seen') snap.ref.update({ status: 'seen', seenAt: now() }).catch(() => {});
    else if (!mineReads && m.status !== 'delivered') snap.ref.update({ status: 'delivered' }).catch(() => {});
  } else if (mineReads) {
    snap.ref.child('readBy/' + ST.me.uid).set(now()).catch(() => {});
  }
}

/* ---------------- Message rendering ---------------- */
function tick(read) {
  return read
    ? '<svg class="tick read" viewBox="0 0 16 16"><path d="M15 3.3l-.5-.4a.4.4 0 00-.5.1L8.7 9.9a.3.3 0 01-.5 0l-.4-.3a.3.3 0 00-.5 0l-.4.5a.4.4 0 000 .5l1.3 1.3c.2.1.4.1.5 0l6.3-8a.4.4 0 000-.6zm-4.1 0l-.5-.4a.4.4 0 00-.5.1L4.6 9.9a.3.3 0 01-.5 0L1.9 7.8a.4.4 0 00-.5 0l-.4.5a.4.4 0 000 .5l3.2 3.2c.2.1.4.1.5 0l6.3-8a.4.4 0 000-.6z"/></svg>'
    : '<svg class="tick" viewBox="0 0 16 16"><path d="M6.4 12.3l-3.8-3.8-1.4 1.4 5.2 5.2 10-10-1.4-1.4z"/></svg>';
}

function linkify(text) {
  return esc(text).replace(/(https?:\/\/[^\s<]+)/g, u => '<a href="' + u + '" target="_blank" rel="noopener noreferrer">' + u + '</a>');
}

function metaHTML(m) {
  const mine = m.sender === ST.me.uid;
  const direct = !ST.chat || ST.chat.type === 'direct';
  const read = m.status === 'seen';
  const ts = m.timestamp || m.createdAt || now();
  const timeStr = fmtTime(ts);
  const fullTime = fmtFullTime(ts);
  return `<div class="meta" title="Sent ${esc(fullTime)}" onclick="event.stopPropagation();openMessageDetails('${esc(m.key)}')">${esc(timeStr)}${m.edited ? ' · edited' : ''}${mine && direct ? ' ' + tick(read) : ''}</div>`;
}

function reactionsHTML(m) {
  const r = m.reactions || {};
  const counts = {};
  Object.keys(r).forEach(u => { counts[r[u]] = (counts[r[u]] || 0) + 1; });
  const keys = Object.keys(counts);
  if (!keys.length) return '';
  return '<div class="reacts">' + keys.map(e =>
    `<span class="rpill" data-react="${esc(m.key)}" data-emoji="${esc(e)}">${esc(e)}${counts[e] > 1 ? ' ' + counts[e] : ''}</span>`).join('') + '</div>';
}

function bodyHTML(m) {
  if (m.deleted) return '<span class="txt" style="opacity:0.65;font-style:italic">This message was deleted</span>';
  if (m.type === 'gif') {
    const url = safeMedia(m.gifUrl || (m.media && m.media.url));
    if (!url) return '<span class="txt">🎞️ GIF unavailable</span>';
    const preview = safeMedia(m.gifPreview) || url;
    return `
      <img class="msgimg" style="width:220px;background:var(--kr-elev)" src="${esc(preview)}" data-view="${esc(url)}" data-vkind="image" data-vname="GIF" alt="GIF" loading="lazy">
      <div style="font-size:10.5px;opacity:0.75;margin-top:4px">via ${esc(m.gifProvider || 'giphy')}</div>
    `;
  }
  if (m.type === 'sticker') return `<div style="font-size:46px;line-height:1.1">${esc(m.sticker || '🙂')}</div>`;
  if (m.type === 'game_invite') {
    return `<div style="font-size:13px;opacity:0.85;padding:4px 0">${esc(m.text || 'Game match invite')}</div>`;
  }
  if (m.type === 'poll' && m.poll) return pollHTML(m);
  if (['image','video','audio','voice','file'].indexOf(m.type) >= 0) {
    const md = m.media || {};
    const inline = safeMedia(md.url);
    if (md.kind === 'inline' && inline) return bubbleInlineHTML(m, inline);
    return bubbleMediaHTML(m, '');
  }
  return `<span class="txt">${linkify(m.text || '')}</span>`;
}

function bubbleInlineHTML(m, url) {
  const dur = (m.media && m.media.dur) || 0;
  const name = (m.media && m.media.name) || 'file';
  if (m.type === 'image') return `<img class="msgimg" style="max-width:260px" src="${esc(url)}" data-view="${esc(url)}" data-vkind="image" data-vname="Photo" alt="Photo">`;
  if (m.type === 'video') return `<video controls playsinline preload="metadata" src="${esc(url)}" style="max-width:260px;border-radius:14px;display:block"></video>`;
  if (m.type === 'voice') return `<div class="vmsg"><button class="vbtn" data-inline-audio="${esc(m.key)}">▶</button>${waveHTML(m.key)}<span style="font-size:11.5px;opacity:0.85" id="vt-${esc(m.key)}">${esc(fmtClock(dur))}</span></div>`;
  if (m.type === 'audio') return `<div style="min-width:210px"><div class="mhead"><span class="ico">🎵</span><span><span class="nm">${esc(name)}</span><small style="display:block">${esc(fmtClock(dur))}</small></span></div><audio controls preload="metadata" src="${esc(url)}" style="width:100%"></audio></div>`;
  return `<div class="media-card" data-file="${esc(url)}" data-name="${esc(name)}" style="cursor:pointer"><div class="mhead"><span class="ico">${fileEmoji(name)}</span><span><span class="nm">${esc(name)}</span><small style="display:block">${esc(fmtSize((m.media && m.media.size) || 0))} · tap to open</small></span></div></div>`;
}

function pollHTML(m) {
  const opts = (m.poll && m.poll.options) || [];
  const total = opts.reduce((a, o) => a + Object.keys((o && o.votes) || {}).length, 0);
  return `<div style="min-width:220px"><div style="font-weight:700;margin-bottom:8px">${esc(m.poll.question || 'Poll')}</div>` +
    opts.map((o, i) => {
      const votes = Object.keys((o && o.votes) || {});
      const mine = votes.indexOf(ST.me.uid) >= 0;
      const pc = total ? Math.round(votes.length / total * 100) : 0;
      return `<button data-vote="${i}" style="display:block;width:100%;text-align:left;margin-bottom:6px;position:relative;padding:8px 12px;border-radius:11px;background:rgba(127,127,127,0.16);overflow:hidden">
        <span style="position:absolute;left:0;top:0;bottom:0;width:${pc}%;background:rgba(127,127,127,0.24)"></span>
        <span style="position:relative;display:flex;justify-content:space-between;gap:8px">
          <span style="font-size:13.5px;font-weight:${mine ? '700' : '500'}">${mine ? '✓ ' : ''}${esc(o.text || '')}</span>
          <span style="font-size:12px;opacity:0.75">${pc}%</span>
        </span></button>`;
    }).join('') + `<div style="font-size:11.5px;opacity:0.7">${total} vote${total === 1 ? '' : 's'}</div></div>`;
}

function renderMessage(m) {
  const box = s('chat-messages'); if (!box || !m) return;
  const mine = m.sender === ST.me.uid;
  const ts = m.timestamp || m.createdAt || now();
  const dateStr = fmtMessageDate(ts);
  const prevSep = box.querySelector('.daysep:last-of-type');
  const sepHTML = (prevSep && prevSep.textContent === dateStr) ? '' : `<div class="daysep">${esc(dateStr)}</div>`;
  const senderName = (!mine && ST.chat && ST.chat.type === 'group')
    ? `<div class="sender">${esc(userLabel(ST.users[m.sender] || { uid: m.sender }))}</div>` : '';
  const reply = m.replyTo ? `<div class="reply-q" onclick="scrollToMsg('${esc(m.replyTo.key)}')" title="Tap to jump to quoted message"><b>${esc(m.replyTo.name || 'Reply')}</b><span>${esc(m.replyTo.text || 'Attachment')}</span></div>` : '';
  const fwd = m.forwarded ? '<div style="font-size:11px;opacity:0.8;font-style:italic;margin-bottom:3px">↪ Forwarded</div>' : '';
  const isMedia = ['image','video','audio','voice','file'].indexOf(m.type) >= 0;

  const html = `${sepHTML}<div class="mwrap ${mine ? 'me' : 'them'}" id="m-${esc(m.key)}">
      ${senderName}
      <div class="bub ${isMedia ? 'media' : ''}" data-key="${esc(m.key)}">${reply}${fwd}${bodyHTML(m)}${metaHTML(m)}</div>
      ${reactionsHTML(m)}
    </div>`;

  const existing = s('m-' + m.key);
  if (existing) existing.outerHTML = html;
  else box.insertAdjacentHTML('beforeend', html);

  const el = s('m-' + m.key);
  if (el) {
    let pressTimer = null;
    el.oncontextmenu = e => { e.preventDefault(); openMessageMenu(m.key); };
    el.addEventListener('touchstart', () => { pressTimer = setTimeout(() => openMessageMenu(m.key), 500); }, { passive: true });
    ['touchend','touchmove','touchcancel'].forEach(ev => el.addEventListener(ev, () => clearTimeout(pressTimer), { passive: true }));
    if (m.media && (m.media.kind === 'p2p' || m.media.kind === 'inline')) hydrateMedia(m);
  }
  updateEmptyState();
}

function scrollToMsg(key) {
  if (!key) return;
  const el = s('m-' + key);
  if (!el) {
    toast('Original message is not in current view or was deleted.');
    return;
  }
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.add('highlight-msg');
  setTimeout(() => el.classList.remove('highlight-msg'), 1600);
}

function openMessageDetails(key) {
  const m = (ST.chatMsgs && ST.chatMsgs[key]) || null;
  if (!m) return;
  const mine = m.sender === ST.me.uid;
  const author = mine ? 'You' : userLabel(ST.users[m.sender] || { uid: m.sender });
  const ts = m.timestamp || m.createdAt || now();
  const statusStr = mine ? (m.status === 'seen' ? '✓✓ Seen / Read' : m.status === 'delivered' ? '✓✓ Delivered' : '✓ Sent') : 'Received';
  const seenStr = m.seenAt ? ` · read at ${fmtTime(m.seenAt)}` : '';

  openModal(`
    <div class="pad">
      <h3 style="margin:0 0 16px;font-size:17px">Message Details</h3>
      <div style="display:flex;flex-direction:column;gap:14px;font-size:14px">
        <div>
          <div style="font-size:11.5px;color:var(--kr-mut);text-transform:uppercase;font-weight:700">Sender</div>
          <div style="font-weight:700;margin-top:2px">${esc(author)}</div>
        </div>
        <div>
          <div style="font-size:11.5px;color:var(--kr-mut);text-transform:uppercase;font-weight:700">Sent Timestamp</div>
          <div style="font-weight:600;margin-top:2px">${esc(fmtFullTime(ts))}</div>
        </div>
        <div>
          <div style="font-size:11.5px;color:var(--kr-mut);text-transform:uppercase;font-weight:700">Status</div>
          <div style="font-weight:600;margin-top:2px">${esc(statusStr + seenStr)}</div>
        </div>
        <div>
          <div style="font-size:11.5px;color:var(--kr-mut);text-transform:uppercase;font-weight:700">Message Type</div>
          <div style="font-weight:600;margin-top:2px;text-transform:capitalize">${esc(m.type || 'text')}</div>
        </div>
        ${m.replyTo ? `
          <div>
            <div style="font-size:11.5px;color:var(--kr-mut);text-transform:uppercase;font-weight:700">Reply Target</div>
            <div style="padding:10px 12px;background:var(--kr-bg2);border-radius:12px;border-left:3px solid var(--kr-brand);margin-top:4px">
              <div style="font-weight:700;font-size:13px">${esc(m.replyTo.name || 'Message')}</div>
              <div style="font-size:13px;color:var(--kr-mut);margin-top:2px">${esc(m.replyTo.text || '')}</div>
            </div>
          </div>
        ` : ''}
      </div>
      <button class="btn block ghost" onclick="Nav.close('ov-modal')" style="margin-top:20px">Close</button>
    </div>
  `);
}

function refreshMessage(key) {
  const m = ST.chatMsgs[key];
  if (m && s('m-' + key)) renderMessage(m);
}

function updateMetaOnly(key, m) {
  const el = s('m-' + key); if (!el) return;
  const meta = $('.meta', el);
  if (meta && m.sender === ST.me.uid) meta.outerHTML = metaHTML(m);
  const rx = $('.reacts', el);
  const want = reactionsHTML(m);
  if (rx && !want) rx.remove();
  else if (rx && want && rx.outerHTML !== want) rx.outerHTML = want;
  else if (!rx && want) $('.bub', el).insertAdjacentHTML('beforeend', want);
}

function hydrateMedia(m) {
  const md = m.media || {};
  if (md.kind === 'inline') return;
  Store.get(m.key).then(rec => {
    if (!rec || !rec.blob) return;
    const url = Store.url(m.key, rec.blob);
    mountLocalMedia(m, url);
  });
}

function mountLocalMedia(m, url) {
  const el = s('m-' + m.key);
  if (!el || !url) return;
  const bub = $('.bub', el);
  if (!bub) return;
  Store.hold(m.key);
  bub.innerHTML = bubbleMediaHTML(m, url) + metaHTML(m);
}

function bubbleMediaHTML(m, url) {
  const md = m.media || {};
  const meta = ST.transferMeta[m.key] || {};
  const name = md.name || (m.type === 'voice' ? 'Voice message' : 'File');
  const dur = md.dur || 0;
  const st = md.state || meta.state || 'queued';
  const done = !!url || st === 'completed';
  const kind = m.type;

  const head = `<div class="mhead"><span class="ico">${kind === 'video' ? '🎬' : kind === 'audio' ? '🎵' : kind === 'voice' ? '🎤' : fileEmoji(name)}</span>
      <span style="min-width:0"><span class="nm">${esc(name)}</span>
      <small style="display:block">${esc(fmtSize(md.size))}${dur ? ' · ' + fmtClock(dur) : ''}</small></span></div>`;

  if (url) {
    if (kind === 'image')
      return `<img class="msgimg" style="max-width:260px" src="${esc(url)}" alt="${esc(name)}" data-view="${esc(url)}" data-vkind="image" data-vname="${esc(name)}" data-mkey="${esc(m.key)}" loading="lazy">`;
    if (kind === 'video')
      return `<video controls playsinline preload="metadata" src="${esc(url)}" style="max-width:260px;border-radius:14px;display:block"></video>
        <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 4px 2px;gap:8px">
          <span style="font-size:11px;opacity:0.8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:160px">${esc(name)}</span>
          <button data-save="${esc(m.key)}" style="font-size:12px;font-weight:650">Save</button></div>`;
    if (kind === 'audio')
      return `<div style="min-width:220px">${head}<audio controls preload="metadata" src="${esc(url)}" style="width:100%"></audio>
        <div style="display:flex;justify-content:space-between;padding:6px 2px 0"><span style="font-size:11px;opacity:0.75">${esc(fmtClock(dur))}</span>
        <button data-save="${esc(m.key)}" style="font-size:12px;font-weight:650">Save</button></div></div>`;
    if (kind === 'voice')
      return `<div class="vmsg"><button class="vbtn" data-voice="${esc(m.key)}" data-url="${esc(url)}">▶</button>
        ${waveHTML(m.key)}<span style="font-size:11.5px;opacity:0.85;font-variant-numeric:tabular-nums" id="vt-${esc(m.key)}">${esc(fmtClock(dur))}</span></div>`;
    return `<div class="media-card" data-file="${esc(url)}" data-name="${esc(name)}" style="cursor:pointer">${head}
      <div style="font-size:11.5px;opacity:0.75">Tap to open</div></div>`;
  }

  const mine = m.sender === ST.me.uid;
  const thumb = safeMedia(md.thumb);
  const tone = (st === 'failed' || st === 'cancelled' || st === 'unavailable') ? 'bad' : (st === 'waiting' ? 'warn' : '');
  const stateLabel = MediaUI.label(st, meta.pct, meta.note, meta.speed);

  return `<div class="media-card" id="mc-${esc(m.key)}">
      ${thumb && kind === 'image' ? `<img class="msgimg" style="max-width:230px;max-height:230px;margin-bottom:6px" src="${esc(thumb)}" alt="" loading="lazy">` : head}
      <div class="mstate" style="justify-content:space-between">
        <span class="pillx ${tone}">${esc(stateLabel)}</span>
        <span style="font-size:10.5px;opacity:0.7">${mine ? 'P2P transfer' : 'incoming'}</span>
      </div>
      <div class="bar"><i id="mb-${esc(m.key)}" style="width:${Math.round((meta.pct || 0) * 100)}%"></i></div>
      <div class="mstate" id="ms-${esc(m.key)}">${esc(stateLabel)}</div>
      ${MediaUI.actions(m, meta)}
    </div>`;
}

function waveHTML(key) {
  let bars = '';
  for (let i = 0; i < 24; i++) {
    bars += `<i style="height:${6 + Math.round(Math.abs(Math.sin((i + 1) * 1.37)) * 16)}px"></i>`;
  }
  return `<span class="wave" id="wv-${esc(key)}">${bars}</span>`;
}

/* ---------------- Audio Player ---------------- */
const Player = {
  audio: null, btn: null,
  stopAll() {
    if (this.audio) { try { this.audio.pause(); } catch (e) {} this.audio = null; }
    if (this.btn) { this.btn.textContent = '▶'; this.btn = null; }
  }
};

function playVoice(key, url, btn) {
  const a = Player.audio;
  if (a && a.dataset.key === key) {
    if (a.paused) { a.play().catch(() => {}); btn.textContent = '⏸'; }
    else { a.pause(); btn.textContent = '▶'; }
    return;
  }
  Player.stopAll();
  const el = new Audio(url);
  el.dataset.key = key;
  Player.audio = el; Player.btn = btn;
  btn.textContent = '⏸';

  el.onended = () => {
    btn.textContent = '▶';
    const w = s('wv-' + key);
    if (w) $$('i', w).forEach(i => i.classList.remove('on'));
  };
  el.onerror = () => { btn.textContent = '▶'; toast('Could not play voice message.'); };
  el.ontimeupdate = () => {
    const w = s('wv-' + key);
    const dur = s('vt-' + key);
    if (dur && el.duration) dur.textContent = fmtClock(el.currentTime);
    if (w) {
      const bars = $$('i', w);
      const idx = Math.floor((el.currentTime / (el.duration || 1)) * bars.length);
      bars.forEach((b, i) => b.classList.toggle('on', i <= idx));
    }
  };
  el.play().catch(() => toast('Tap again to play.'));
}

/* ---------------- Voice Recorder ---------------- */
const Voice = {
  supported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
  },

  mime() {
    if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return 'audio/webm';
    const c = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/aac', 'audio/ogg;codecs=opus', 'audio/ogg'];
    for (let i = 0; i < c.length; i++) {
      try { if (MediaRecorder.isTypeSupported(c[i])) return c[i]; } catch (e) {}
    }
    return '';
  },

  start() {
    if (!ST.chat) return;
    if (!this.supported()) {
      toast('Voice recording is not supported in this browser.');
      return;
    }

    navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }).then(stream => {
      const mime = this.mime();
      let rec;
      try { rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined); }
      catch (e) {
        try { rec = new MediaRecorder(stream); }
        catch (e2) {
          stream.getTracks().forEach(t => t.stop());
          toast('Voice recording unavailable.');
          return;
        }
      }

      ST.mediaRec = rec; ST.recStream = stream; ST.recStart = now(); ST.recChunks = []; ST.recCancel = false;
      rec.ondataavailable = e => { if (e.data && e.data.size) ST.recChunks.push(e.data); };
      rec.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        ST.recStream = null;
        const dur = (now() - ST.recStart) / 1000;
        const blob = new Blob(ST.recChunks, { type: (rec.mimeType || mime || 'audio/webm').split(';')[0] });
        ST.recChunks = []; ST.mediaRec = null;
        this.ui(false);

        if (ST.recCancel) { ST.recCancel = false; return; }
        if (dur < 0.8 || blob.size < 800) { toast('Recording too short.'); return; }
        if (blob.size > KLYRO_CONFIG.limits.voice) { toast('Voice note exceeded limit (' + fmtSize(KLYRO_CONFIG.limits.voice) + ').'); return; }
        this.send(blob, dur, rec.mimeType || mime);
      };

      rec.onerror = () => { this.ui(false); toast('Recording failed.'); };
      rec.start(250);
      this.ui(true);
    }).catch(err => {
      const n = err && err.name;
      toast(n === 'NotAllowedError' ? 'Microphone blocked. Allow mic access in your browser settings and try again.'
        : 'Microphone access failed.', 4500);
    });
  },

  stop() {
    if (ST.mediaRec && ST.mediaRec.state === 'recording') ST.mediaRec.stop();
  },

  cancel() {
    ST.recCancel = true;
    if (ST.mediaRec && ST.mediaRec.state === 'recording') { try { ST.mediaRec.stop(); } catch (e) {} }
    if (ST.recStream) { ST.recStream.getTracks().forEach(t => t.stop()); ST.recStream = null; }
    ST.recChunks = []; ST.mediaRec = null;
    this.ui(false);
  },

  ui(on) {
    const bar = s('rec-bar');
    if (bar) bar.classList.toggle('show', !!on);
    const mic = s('btn-mic');
    if (mic) {
      mic.innerHTML = on
        ? '<span style="font-size:16px;color:var(--kr-danger)">⏹</span>'
        : '<svg viewBox="0 0 24 24"><path d="M12 14a3 3 0 003-3V5a3 3 0 00-6 0v6a3 3 0 003 3zm5-3a5 5 0 01-10 0H5a7 7 0 006 6.9V21h2v-3.1A7 7 0 0019 11z"/></svg>';
    }
    clearInterval(ST.recTimer);
    if (on) {
      ST.recTimer = setInterval(() => {
        const el = s('rec-timer');
        if (el) el.textContent = fmtClock((now() - ST.recStart) / 1000);
      }, 250);
    } else {
      const el = s('rec-timer');
      if (el) el.textContent = '0:00';
    }
  },

  async send(blob, dur, mime) {
    if (!ST.chat) return;
    const ext = /mp4|aac|m4a/.test(mime || blob.type || '') ? 'm4a' : (/ogg/.test(mime || '') ? 'ogg' : 'webm');
    const name = 'voice-' + fmtClock(dur).replace(':', 'm') + 's.' + ext;

    if (ST.chat.type !== 'direct') {
      toast('Voice notes can be sent in direct chats.');
      return;
    }

    if (blob.size <= KLYRO_CONFIG.limits.inlineBytes) {
      try {
        const b64 = await blobToDataURL(blob);
        const media = { kind: 'inline', url: b64, size: blob.size, mime: mime || blob.type, name: name, dur: Math.round(dur) };
        await pushMessage(buildMessage({ type: 'voice', media: media }));
        return;
      } catch (e) {}
    }

    const msg = buildMessage({ type: 'voice', media: { kind: 'p2p', name: name, size: blob.size, mime: mime || blob.type, dur: Math.round(dur), state: 'queued' } });
    let ref;
    try {
      ref = await pushMessage(msg);
    } catch (e) { toast('Could not send voice message.'); return; }
    
    ST.activeTransfer = await MediaEngine.send(ST.chat.targetId, ST.chat.chatId, ref.key, blob, 'voice', { name: name, mime: mime || blob.type, dur: dur });
  }
};

/* ---------------- WebRTC Voice & Video Calls ---------------- */
const Calls = {
  pc: null, local: null, id: null, isVideo: false, peer: null, other: null,
  returnTo: 'main', returnParams: null, timer: null, answered: false,

  ui(state) {
    const out = s('call-controls-out'), inc = s('call-controls-in');
    if (out && out.style) out.style.display = state === 'outgoing' ? 'flex' : 'none';
    if (inc && inc.style) inc.style.display = state === 'incoming' ? 'flex' : 'none';
  },

  async start(isVideo) {
    if (!ST.chat || ST.chat.type !== 'direct') { toast('Calls are available in direct chats.'); return; }
    if (ST.call || this.pc) { toast('A call is already in progress.'); return; }

    /* CRITICAL: Remember EXACT previous route to restore upon ending */
    this.returnTo = Nav.current === 'chat' ? 'chat' : 'main';
    this.returnParams = Object.assign({}, Nav.params);

    const peer = ST.chat.targetId;
    this.peer = peer; this.other = ST.users[peer]; this.isVideo = !!isVideo;
    this.id = db.ref('calls').push().key;

    try {
      this.local = await navigator.mediaDevices.getUserMedia({ audio: true, video: !!isVideo });
    } catch (e) {
      toast('Could not access microphone/camera. Please grant permissions and retry.');
      return;
    }

    const lv = s('local-video');
    if (lv) { lv.srcObject = this.local; lv.style.display = isVideo ? 'block' : 'none'; }
    const rv = s('remote-video');
    if (rv) rv.style.display = isVideo ? 'block' : 'none';

    this.pc = new RTCPeerConnection(MediaEngine.servers);
    this.local.getTracks().forEach(t => this.pc.addTrack(t, this.local));
    this.pc.onicecandidate = e => {
      if (e.candidate) db.ref('calls/' + this.id + '/callerIce').push(e.candidate.toJSON()).catch(() => {});
    };
    this.pc.ontrack = e => {
      const el = s(this.isVideo ? 'remote-video' : 'remote-audio');
      if (el) el.srcObject = e.streams[0];
    };

    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    ST.call = { id: this.id, caller: ST.me.uid, callee: peer, isVideo: !!isVideo };

    await db.ref('calls/' + peer).set({
      id: this.id, caller: ST.me.uid, callerName: userLabel(ST.me), callee: peer,
      isVideo: !!isVideo, state: 'ringing', startedAt: now(),
      offer: { type: offer.type, sdp: offer.sdp }
    });

    this.listenIce('calleeIce');
    this.paintCallUI(this.other || {}, isVideo ? 'Video calling…' : 'Voice calling…');
    this.ui('outgoing');
    Nav.go('call', { callId: this.id });
    this.watchAnswer();

    this.timer = setTimeout(() => {
      if (ST.call && !this.answered) {
        toast(userLabel(this.other || {}) + ' did not answer.');
        this.end();
      }
    }, 45000);
  },

  paintCallUI(user, status) {
    const av = s('call-avatar');
    if (av) av.innerHTML = getAvatarHTML(user || {}, 'xl');
    if (s('call-name')) s('call-name').textContent = userLabel(user || {});
    if (s('call-status')) s('call-status').textContent = status;
  },

  watchAnswer() {
    unlisten('call:answer');
    listen('call:answer', 'calls/' + this.id, 'value', sn => {
      const d = sn.val();
      if (!d) { if (this.pc) this.end(); return; }
      if (d.answer && this.pc && this.pc.signalingState !== 'stable') {
        this.pc.setRemoteDescription(new RTCSessionDescription(d.answer)).then(() => {
          this.answered = true;
          clearTimeout(this.timer);
          if (s('call-status')) s('call-status').textContent = 'Connected';
        }).catch(() => {});
      }
      if (d.state === 'declined' && !this.answered) { toast('Call declined'); this.end(); }
      if (d.state === 'ended') this.end();
    });
  },

  listenCalls() {
    unlisten('call:in');
    listen('call:in', 'calls/' + ST.me.uid, 'value', sn => {
      const d = sn.val();
      if (d && d.offer && !this.pc && !ST.call) {
        ST.call = { id: d.id, caller: d.caller, callee: ST.me.uid, isVideo: !!d.isVideo, offer: d.offer };
        this.other = ST.users[d.caller] || { name: 'Caller' };
        this.paintCallUI(this.other, 'Incoming ' + (d.isVideo ? 'video' : 'voice') + ' call');
        const rv = s('remote-video');
        if (rv) rv.style.display = d.isVideo ? 'block' : 'none';
        this.ui('incoming');

        /* Preserve previous screen */
        this.returnTo = Nav.current === 'chat' ? 'chat' : 'main';
        this.returnParams = Object.assign({}, Nav.params);

        Nav.go('call', { incoming: d.id });
        const r = s('ringtone');
        if (r) { r.currentTime = 0; r.play().catch(() => {}); }
        notify('Incoming Call', userLabel(this.other) + ' is calling you.');
      }
    });
  },

  async accept() {
    const r = s('ringtone'); if (r) { r.pause(); r.currentTime = 0; }
    if (!ST.call || !ST.call.offer) return;
    const { id, isVideo, offer, caller } = ST.call;
    this.isVideo = !!isVideo; this.id = id; this.peer = caller;

    try {
      this.local = await navigator.mediaDevices.getUserMedia({ audio: true, video: !!isVideo });
    } catch (e) {
      toast('Microphone/camera access denied.');
      this.decline();
      return;
    }

    const lv = s('local-video');
    if (lv) { lv.srcObject = this.local; lv.style.display = isVideo ? 'block' : 'none'; }
    this.pc = new RTCPeerConnection(MediaEngine.servers);
    this.local.getTracks().forEach(t => this.pc.addTrack(t, this.local));
    this.pc.onicecandidate = e => {
      if (e.candidate) db.ref('calls/' + id + '/calleeIce').push(e.candidate.toJSON()).catch(() => {});
    };
    this.pc.ontrack = e => {
      const el = s(isVideo ? 'remote-video' : 'remote-audio');
      if (el) el.srcObject = e.streams[0];
    };

    try {
      await this.pc.setRemoteDescription(new RTCSessionDescription(offer));
      const ans = await this.pc.createAnswer();
      await this.pc.setLocalDescription(ans);
      await db.ref('calls/' + id).update({ answer: { type: ans.type, sdp: ans.sdp }, state: 'active', answeredAt: now() });
      this.listenIce('callerIce');
      this.answered = true;
      this.paintCallUI(this.other, 'Connected');
      this.ui('outgoing');
    } catch (e) {
      toast('Could not connect call.');
      this.end();
    }
  },

  listenIce(which) {
    unlisten('call:ice:' + which);
    listen('call:ice:' + which, 'calls/' + this.id + '/' + which, 'child_added', sn => {
      const c = sn.val(); if (!c || !this.pc) return;
      try { this.pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {}); } catch (e) {}
    });
  },

  toggleMute() {
    if (!this.local) return;
    const t = this.local.getAudioTracks()[0]; if (!t) return;
    t.enabled = !t.enabled;
    const b = s('btn-mute');
    if (b) b.style.background = t.enabled ? 'rgba(255,255,255,0.18)' : 'var(--kr-danger)';
    toast(t.enabled ? 'Microphone on' : 'Microphone muted');
  },

  toggleCam() {
    if (!this.local || !this.isVideo) { toast('No camera stream.'); return; }
    const t = this.local.getVideoTracks()[0]; if (!t) return;
    t.enabled = !t.enabled;
    const b = s('btn-cam');
    if (b) b.style.background = t.enabled ? 'rgba(255,255,255,0.18)' : 'var(--kr-danger)';
  },

  decline() {
    const r = s('ringtone'); if (r) { r.pause(); r.currentTime = 0; }
    const id = ST.call && ST.call.id;
    const caller = ST.call && ST.call.caller;
    if (id) {
      db.ref('calls/' + id).update({ state: 'declined' }).catch(() => {});
      if (caller) db.ref('calls/' + caller).remove().catch(() => {});
    }
    this.end();
  },

  end(silent) {
    try {
      const r = s('ringtone');
      if (r && typeof r.pause === 'function') {
        r.pause();
        r.currentTime = 0;
      }
    } catch (e) {}

    if (!ST.call && !this.pc && !this.id) {
      return;
    }

    const id = this.id || (ST.call && ST.call.id);
    if (id && this.pc) {
      db.ref('calls/' + id).update({ state: 'ended', endedAt: now() }).catch(() => {});
    }
    if (ST.call && ST.call.caller === ST.me.uid && ST.call.callee) {
      db.ref('calls/' + ST.call.callee).remove().catch(() => {});
    } else if (ST.call && ST.call.callee === ST.me.uid) {
      db.ref('calls/' + ST.me.uid).remove().catch(() => {});
    }

    clearTimeout(this.timer);
    unlisten('call:answer'); unlisten('call:ice:callerIce'); unlisten('call:ice:calleeIce');
    if (this.pc) { try { this.pc.close(); } catch (e) {} this.pc = null; }
    if (this.local) { this.local.getTracks().forEach(t => t.stop()); this.local = null; }

    const rv = s('remote-video'), ra = s('remote-audio'), lv = s('local-video');
    if (rv) { rv.srcObject = null; rv.style.display = 'none'; }
    if (ra) ra.srcObject = null;
    if (lv) { lv.srcObject = null; lv.style.display = 'none'; }

    this.ui('none');
    ST.call = null;
    this.answered = false;

    /* CRITICAL: RESTORE EXACT SCREEN USER WAS ON BEFORE THE CALL */
    const target = this.returnTo === 'chat' && ST.chat ? 'chat' : 'main';
    const params = this.returnParams || {};
    this.returnTo = 'main';
    Nav.go(target, params, { replace: true, force: true });
    if (!silent) toast('Call ended');
  }
};
