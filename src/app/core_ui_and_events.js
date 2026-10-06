/* ============================ CORE UI & EVENT DELEGATION ============================ */

const DEFAULT_PRIVACY = {
  profileVisibility: 'everyone',
  showEmail: false,
  showCountry: true,
  showCity: false,
  showOnline: true,
  showLastSeen: true,
  readReceipts: true,
  typingIndicator: true,
  storyAudience: 'contacts',
  findableByUsername: true
};

const DEFAULT_SETTINGS = {
  enterToSend: true,
  mediaAutoDownload: 'wifi',
  bubbleStyle: 'normal',
  fontScale: 1,
  disappearSeconds: 0
};

function privacyOf(u) { return Object.assign({}, DEFAULT_PRIVACY, (u && u.privacy) || {}); }
function settingsOf(u) { return Object.assign({}, DEFAULT_SETTINGS, (u && u.settings) || {}); }
function userLabel(u) { return (u && (u.name || u.username)) || 'KLYRO User'; }
function handleFrom(u) { return u && u.username ? '@' + u.username : ''; }

function getAvatarHTML(u, cls, style) {
  u = u || {};
  const pic = safeMedia(u.photo);
  const box = style ? ' style="' + esc(style) + '"' : '';
  if (pic) return `<div class="av ${cls || ''}"${box}><img src="${esc(pic)}" alt="" loading="lazy" referrerpolicy="no-referrer"></div>`;
  const bg = u.color || colorFor(u.uid || u.name || '?');
  return `<div class="av ${cls || ''}"${box} data-initials="${esc(initials(userLabel(u)))}" style="background:${esc(bg)};${style || ''}">${esc(initials(userLabel(u)))}</div>`;
}

function canSee(u, field) {
  if (!u) return false;
  if (u.uid === ST.me.uid) return true;
  const p = privacyOf(u);
  if (field === 'status') return p.showOnline !== false;
  if (field === 'lastSeen') return p.showLastSeen !== false;
  if (field === 'country') return p.showCountry !== false;
  if (field === 'city') return p.showCity !== false;
  if (field === 'email') return p.showEmail === true;
  return true;
}

function isBlockedBy(u) { return !!(u && ST.me && ST.me.blocked && ST.me.blocked[u.uid]); }
function theyBlockedMe(u) { return !!(u && u.blocked && u.blocked[ST.me.uid]); }

function canSeeProfile(u) {
  if (!u || u.uid === ST.me.uid) return true;
  const p = privacyOf(u);
  if (p.profileVisibility === 'contacts') return !!(ST.me.contacts && ST.me.contacts[u.uid]);
  return true;
}

function canMessageTarget(u) {
  if (!u) return true;
  const p = privacyOf(u);
  if (p.messagePrivacy === 'contacts') return !!(ST.me.contacts && ST.me.contacts[u.uid]);
  return true;
}

function formatLastSeen(ts, who) {
  if (!ts) return 'offline';
  const d = now() - ts;
  if (d < 60000) return 'last seen just now';
  if (d < 3600000) return 'last seen ' + Math.floor(d / 60000) + ' min ago';
  if (d < 864e5) return 'last seen ' + Math.floor(d / 3600000) + ' h ago';
  return 'last seen ' + (who || 'recently');
}

function chatIdFor(other) { return [ST.me.uid, other].sort().join('_'); }
function pathFor(cid, type) { return type === 'group' ? 'groupMessages/' + cid : 'messages/' + cid; }
function isMuted(cid) { return !!(ST.me && ST.me.muted && ST.me.muted[cid]); }
function isArchived(cid) { return !!(ST.me && ST.me.archived && ST.me.archived[cid]); }
function isPinnedChat(cid) { return !!(ST.me && ST.me.pinnedChats && ST.me.pinnedChats[cid]); }
function clearedAt(cid) { return (ST.me && ST.me.clearedChats && ST.me.clearedChats[cid]) || 0; }

function autoGrow(el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 132) + 'px';
}

function savedDraft(cid) { return (ST.drafts[cid] || (ST.me && ST.me.drafts && ST.me.drafts[cid])) || ''; }
function saveDraft(cid, text) {
  ST.drafts[cid] = text;
  clearTimeout(ST._draftT);
  ST._draftT = setTimeout(() => {
    if (!ST.me) return;
    if (text) db.ref('users/' + ST.me.uid + '/drafts/' + cid).set(text.slice(0, 2000)).catch(() => {});
    else db.ref('users/' + ST.me.uid + '/drafts/' + cid).remove().catch(() => {});
  }, 800);
}

function getPreviewText(m) {
  if (!m) return '';
  if (m.deleted) return 'This message was deleted';
  if (m.type === 'image') return '📷 Photo';
  if (m.type === 'video') return '🎬 Video';
  if (m.type === 'audio') return '🎵 Audio';
  if (m.type === 'voice') return '🎤 Voice message';
  if (m.type === 'file') return '📎 ' + ((m.media && m.media.name) || 'Document');
  if (m.type === 'gif') return '🎞️ GIF';
  if (m.type === 'sticker') return 'Sticker';
  if (m.type === 'poll') return '📊 ' + ((m.poll && m.poll.question) || 'Poll');
  return m.text || '';
}

function buildMessage(extra) {
  const base = { sender: ST.me.uid, timestamp: now(), status: 'sent' };
  const st = settingsOf(ST.me);
  if (st.disappearSeconds > 0) base.expiresAt = now() + st.disappearSeconds * 1000;
  if (ST.replying) {
    base.replyTo = { key: ST.replying.key, name: ST.replying.name, text: ST.replying.text };
    cancelReply();
  }
  return Object.assign(base, extra || {});
}

function pushMessage(msg) {
  if (!ST.chat) return Promise.reject(new Error('no-chat'));
  const { type, chatId, targetId } = ST.chat;

  // Canonical server-safe timestamp
  msg.timestamp = msg.timestamp || now();
  msg.createdAt = msg.timestamp;

  return db.ref(pathFor(chatId, type)).push(msg).then(ref => {
    const msgId = ref.key;
    if (type === 'direct') {
      db.ref('users/' + ST.me.uid + '/lastMsgAt').set(now()).catch(() => {});
      bumpUnread(targetId, chatId);
      dispatchMessageNotification(targetId, chatId, msgId, msg);
    } else {
      Object.keys(ST.chat.members || {}).forEach(uid => {
        if (uid !== ST.me.uid) {
          bumpUnread(uid, chatId);
          dispatchMessageNotification(uid, chatId, msgId, msg);
        }
      });
    }
    return ref;
  });
}

function dispatchMessageNotification(recipientUid, conversationId, messageId, msg) {
  if (!recipientUid || !ST.me || recipientUid === ST.me.uid) return;
  const preview = getPreviewText(msg);
  db.ref('userNotifications/' + recipientUid + '/' + messageId).set({
    id: messageId,
    messageId: messageId,
    conversationId: conversationId,
    senderId: ST.me.uid,
    senderName: ST.me.name || 'Friend',
    senderPhoto: ST.me.photo || '',
    text: preview || 'New message',
    type: msg.type || 'text',
    createdAt: now(),
    status: 'unread'
  }).catch(() => {});
}

function sendText() {
  const inp = s('composer-input');
  if (!ST.chat || !inp) return;
  const text = inp.value.trim();
  if (!text) return;
  if (text.length > 4000) { toast('Message too long.'); return; }
  inp.value = '';
  autoGrow(inp);
  saveDraft(ST.chat.chatId, '');
  db.ref('typing/' + ST.chat.chatId + '/' + ST.me.uid).remove().catch(() => {});
  pushMessage(buildMessage({ type: 'text', text: text })).catch(() => toast('Could not send message.'));
}

function setReply(m) {
  ST.replying = { key: m.key, name: m.sender === ST.me.uid ? 'You' : userLabel(ST.users[m.sender] || {}), text: getPreviewText(m).slice(0, 120) };
  const p = s('reply-preview');
  if (p) {
    p.classList.add('show');
    s('reply-author').textContent = ST.replying.name;
    s('reply-text').textContent = ST.replying.text;
  }
  const inp = s('composer-input'); if (inp) inp.focus();
}

function cancelReply() {
  ST.replying = null;
  const p = s('reply-preview'); if (p) p.classList.remove('show');
}

function toggleReaction(key, emoji) {
  const m = ST.chatMsgs[key]; if (!m || !ST.chat) return;
  const ref = db.ref(pathFor(ST.chat.chatId, ST.chat.type) + '/' + key + '/reactions/' + ST.me.uid);
  if ((m.reactions || {})[ST.me.uid] === emoji) ref.remove().catch(() => {});
  else ref.set(emoji).catch(() => {});
}

function togglePin(key) {
  if (!ST.chat) return;
  const ref = db.ref('pins/' + ST.chat.chatId + '/' + key);
  if (ST.pinned[key]) ref.remove().then(() => toast('Unpinned')).catch(() => {});
  else ref.set({ ts: now(), by: ST.me.uid }).then(() => toast('Pinned')).catch(() => {});
}

function editMessage(m) {
  openModal('<div class="pad"><h3>Edit Message</h3>' + textarea('ed-text', 'Message', m.text || '', '', 4000) +
    '<div style="display:flex;gap:10px;margin-top:14px"><button class="btn ghost" id="ed-no" style="flex:1">Cancel</button>' +
    '<button class="btn" id="ed-yes" style="flex:1">Save</button></div></div>');
  s('ed-no').onclick = () => Nav.close('ov-modal');
  s('ed-yes').onclick = () => {
    const v = s('ed-text').value.trim();
    if (!v) { toast('Message cannot be empty.'); return; }
    db.ref(pathFor(ST.chat.chatId, ST.chat.type) + '/' + m.key).update({ text: v, edited: true }).then(() => {
      Nav.close('ov-modal'); toast('Message updated');
    }).catch(() => toast('Could not update message.'));
  };
}

function deleteMessage(key) {
  if (!ST.chat) return;
  confirmSheet('Delete Message', 'This will delete the message for everyone in the chat.', 'Delete', () => {
    db.ref(pathFor(ST.chat.chatId, ST.chat.type) + '/' + key)
      .update({ deleted: true, text: '', media: null, img: null, gifUrl: null, sticker: null, poll: null, reactions: null })
      .then(() => { Store.del(key); toast('Message deleted'); })
      .catch(() => toast('Could not delete message.'));
  }, true);
}

function forwardMessage(m) {
  const contacts = Object.keys(ST.me.contacts || {});
  if (!contacts.length) { toast('No contacts to forward to.'); return; }
  openModal('<div class="pad"><h3>Forward Message</h3><div id="fw-list" style="max-height:46vh;overflow:auto">' +
    contacts.map(uid => {
      const u = ST.users[uid] || { uid: uid };
      return `<div class="row" style="padding:10px 0" data-fw="${esc(uid)}">${getAvatarHTML(u, 'sm')}
        <div class="mid"><div class="t1"><b>${esc(userLabel(u))}</b></div></div><span class="pillx">Send</span></div>`;
    }).join('') + '</div><button class="btn block ghost" id="fw-close" style="margin-top:12px">Cancel</button></div>');
  s('fw-close').onclick = () => Nav.close('ov-modal');
  $$('[data-fw]').forEach(el => el.onclick = () => {
    const uid = el.dataset.fw, cid = chatIdFor(uid);
    const payload = { sender: ST.me.uid, timestamp: now(), status: 'sent', forwarded: true };
    if (m.text) { payload.type = 'text'; payload.text = m.text; }
    if (m.gifUrl) { payload.type = 'gif'; payload.gifUrl = m.gifUrl; payload.gifPreview = m.gifPreview; payload.gifProvider = m.gifProvider; payload.gifId = m.gifId; }
    if (m.sticker) { payload.type = 'sticker'; payload.sticker = m.sticker; }
    if (m.media && m.media.kind === 'inline') { payload.type = m.type; payload.media = m.media; }
    if (!payload.type) { toast('This attachment cannot be forwarded.'); return; }
    db.ref('messages/' + cid).push(payload).then(() => bumpUnread(uid, cid));
    Nav.close('ov-modal'); toast('Message forwarded');
  });
}

function messageInfo(m) {
  const rows = [
    ['Sender', m.sender === ST.me.uid ? 'You' : userLabel(ST.users[m.sender] || {})],
    ['Type', m.type || 'text'],
    ['Sent', new Date(m.timestamp || now()).toLocaleString()],
    ['Status', m.status || 'sent']
  ];
  if (m.media && m.media.size) rows.push(['Size', fmtSize(m.media.size)]);
  if (m.seenAt) rows.push(['Read by recipient', new Date(m.seenAt).toLocaleString()]);
  openModal('<div class="pad"><h3>Message Details</h3>' +
    rows.map(r => `<div class="row" style="padding:8px 0"><div class="mid"><div class="t2">${esc(r[0])}</div><div class="t1"><b>${esc(r[1])}</b></div></div></div>`).join('') +
    '<button class="btn block ghost" id="mi-close" style="margin-top:12px">Close</button></div>');
  s('mi-close').onclick = () => Nav.close('ov-modal');
}

function openMessageMenu(key) {
  const m = ST.chatMsgs[key]; if (!m) return;
  const mine = m.sender === ST.me.uid;
  const items = [
    { icon: '↩️', label: 'Reply', run: () => setReply(m) },
    { icon: '❤️', label: 'React', run: () => reactPicker(key) },
    { icon: '📋', label: 'Copy text', run: () => copyMessage(m), disabled: !m.text },
    { icon: '↪️', label: 'Forward', run: () => forwardMessage(m), disabled: !!(m.media && m.media.kind === 'p2p') },
    { icon: '📌', label: ST.pinned[key] ? 'Unpin message' : 'Pin message', run: () => togglePin(key) },
    { icon: 'ℹ️', label: 'Message details', run: () => messageInfo(m) }
  ];
  if (mine && !m.deleted) {
    if (m.type === 'text' && m.text) items.push({ icon: '✏️', label: 'Edit', run: () => editMessage(m) });
    items.push({ icon: '🗑️', label: 'Delete', run: () => deleteMessage(key), danger: true });
  }
  if (!mine) items.push({ icon: '🚩', label: 'Report', run: () => reportUser(m.sender, 'message'), danger: true });
  openSheet('Message Options', items);
}

function copyMessage(m) {
  const text = m.text || getPreviewText(m);
  if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => toast('Copied')).catch(() => toast(text));
  else toast(text, 4000);
}

function reactPicker(key) {
  const m = ST.chatMsgs[key]; if (!m) return;
  const set = ['❤️','😂','👍','🔥','😮','😢','🙏'];
  openSheet('React to Message', set.map(e => ({
    icon: e, label: e + ((m.reactions || {})[ST.me.uid] === e ? '  ✓' : ''),
    run: () => toggleReaction(key, e)
  })));
}

function votePoll(key, index) {
  const m = ST.chatMsgs[key]; if (!m || !m.poll || !ST.chat) return;
  const opts = m.poll.options || [];
  const updates = {};
  opts.forEach((o, i) => {
    updates[pathFor(ST.chat.chatId, ST.chat.type) + '/' + key + '/poll/options/' + i + '/votes/' + ST.me.uid] = (i === index) ? now() : null;
  });
  db.ref().update(updates).catch(() => toast('Could not register vote.'));
}

/* ---------------- Attachments Handling ---------------- */
function openAttachSheet() {
  const hasCamera = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  openSheet('Send Attachment', [
    { icon: '🖼️', label: 'Photo', sub: 'High-quality compressed photo', run: () => pickFile('image') },
    { icon: '🎬', label: 'Video', sub: 'Fast P2P video transfer', run: () => pickFile('video') },
    { icon: '🎵', label: 'Audio file', run: () => pickFile('audio') },
    { icon: '📎', label: 'Document', run: () => pickFile('file') },
    { icon: '🎤', label: 'Voice message', sub: Voice.supported() ? 'Record a voice note' : 'Unavailable', run: () => Voice.supported() ? Voice.start() : toast('Voice recording is not supported in this browser.') },
    { icon: '🎞️', label: 'GIF', sub: 'Trending & search via GIPHY', run: () => openTray('gifs') },
    { icon: '📊', label: 'Poll', run: openPollComposer },
    { icon: '📍', label: 'Location', sub: 'Share current GPS location', run: shareLocation },
    { icon: '📷', label: 'Camera', sub: hasCamera ? 'Take photo now' : 'Unavailable', disabled: !hasCamera, run: capturePhoto },
    { icon: '📝', label: 'New status', sub: 'Post 24h status update', run: openStatusComposer }
  ]);
}

function pickFile(kind) {
  const inp = s('file-input');
  if (!inp) return;
  inp.accept = kind === 'image' ? 'image/*' : kind === 'video' ? 'video/*' : kind === 'audio' ? 'audio/*'
    : '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,.rar,.7z,.json,.md';
  inp.dataset.kind = kind;
  inp.value = '';
  inp.click();
}

function shareLocation() {
  if (!navigator.geolocation) { toast('Geolocation not supported on this device.'); return; }
  toast('Locating…');
  navigator.geolocation.getCurrentPosition(p => {
    const la = p.coords.latitude.toFixed(5), lo = p.coords.longitude.toFixed(5);
    pushMessage(buildMessage({ type: 'text', text: '📍 My Location: https://maps.google.com/?q=' + la + ',' + lo }))
      .then(() => toast('Location sent')).catch(() => toast('Could not send location.'));
  }, () => toast('Location permission denied.'), { timeout: 9000 });
}

function capturePhoto() {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/*'; inp.capture = 'environment';
  inp.onchange = () => { if (inp.files && inp.files[0]) sendPhoto(inp.files[0]); };
  inp.click();
}

async function handlePickedFile(input) {
  const f = input.files && input.files[0];
  if (!f || !ST.chat) return;
  const declared = input.dataset.kind || 'media';
  const kind = declared === 'file' ? 'file' : (declared === 'media' ? kindOf(f) : declared);
  const max = KLYRO_CONFIG.limits[kind] || KLYRO_CONFIG.limits.file;
  if (f.size > max) {
    toast('File too large (' + fmtSize(f.size) + '). Maximum limit is ' + fmtSize(max) + '.', 4500);
    return;
  }
  if (kind === 'image') {
    const ok = await looksLikeDeclaredType(f);
    if (!ok) { toast('File is not a valid image format.'); return; }
    return sendPhoto(f);
  }
  return sendFileP2P(f, kind);
}

async function sendPhoto(file) {
  UpBar.show(file.name);
  UpBar.set(0.04, 'Compressing…');
  let out;
  try { out = await compressImage(file, 1440, 0.78); }
  catch (e) { UpBar.fail('Could not compress photo'); return; }

  let thumb = '';
  try {
    const t = await compressImage(out.blob, 260, 0.5, 16000);
    thumb = await blobToDataURL(t.blob);
    if (thumb.length > 24000) thumb = '';
  } catch (e) {}

  const name = (file.name || 'photo.jpg').replace(/[^\w.\-]+/g, '_').slice(-60);
  const media = { kind: 'p2p', name: name, size: out.blob.size, mime: 'image/jpeg', w: out.w, h: out.h, state: 'queued' };
  if (thumb) media.thumb = thumb;

  if (out.blob.size <= KLYRO_CONFIG.limits.inlineBytes) {
    try {
      media.kind = 'inline';
      media.url = await blobToDataURL(out.blob);
      await pushMessage(buildMessage({ type: 'image', media: media }));
      UpBar.done('Sent');
      return;
    } catch (e) { media.kind = 'p2p'; delete media.url; }
  }

  if (ST.chat.type !== 'direct') {
    UpBar.fail('Direct chat needed for large media');
    toast('Large media is transferred peer-to-peer, which requires a direct chat.', 4500);
    return;
  }

  const msg = buildMessage({ type: 'image', media: media });
  let ref;
  try { ref = await pushMessage(msg); } catch (e) { UpBar.fail('Send failed'); return; }
  Store.put(ref.key, out.blob, { chatId: ST.chat.chatId, name: name, mime: 'image/jpeg', size: out.blob.size, mine: true });
  ST.activeTransfer = await MediaEngine.send(ST.chat.targetId, ST.chat.chatId, ref.key, out.blob, 'image', { name: name, mime: 'image/jpeg' });
}

async function sendFileP2P(file, kind) {
  if (!ST.chat) return;
  const name = (file.name || 'file').replace(/[^\w.\-]+/g, '_').slice(-70);
  const mime = file.type || 'application/octet-stream';
  UpBar.show(name);
  UpBar.set(0.05, 'Reading file…');
  let dur = 0;
  if (kind === 'video' || kind === 'audio') dur = await probeDuration(file, kind);

  if (file.size <= KLYRO_CONFIG.limits.inlineBytes) {
    try {
      const b64 = await blobToDataURL(file);
      const media = { kind: 'inline', url: b64, size: file.size, mime: mime, name: name, dur: Math.round(dur) };
      await pushMessage(buildMessage({ type: 'file', media: media }));
      UpBar.done('Sent');
      return;
    } catch (e) {}
  }

  if (ST.chat.type !== 'direct') {
    UpBar.fail('Direct chat needed for large files');
    toast('Large files are transferred peer-to-peer, which requires a direct chat.', 4500);
    return;
  }

  const msg = buildMessage({ type: kind, media: { kind: 'p2p', name: name, size: file.size, mime: mime, dur: Math.round(dur), state: 'queued' } });
  let ref;
  try { ref = await pushMessage(msg); } catch (e) { UpBar.fail('Send failed'); return; }
  Store.put(ref.key, file, { chatId: ST.chat.chatId, name: name, mime: mime, size: file.size, mine: true });
  ST.activeTransfer = await MediaEngine.send(ST.chat.targetId, ST.chat.chatId, ref.key, file, kind, { name: name, mime: mime, dur: dur });
}

function openPollComposer() {
  openModal(`
    <div class="pad">
      <h3>Create a Poll</h3>
      ${field('po-q', 'Question', '', 'text', 'What do you think?')}
      ${field('po-1', 'Option 1', '', 'text', 'Option 1')}
      ${field('po-2', 'Option 2', '', 'text', 'Option 2')}
      ${field('po-3', 'Option 3 (optional)', '', 'text', 'Option 3')}
      <div class="err" id="po-err"></div>
      <div style="display:flex;gap:10px;margin-top:14px">
        <button class="btn ghost" id="po-no" style="flex:1">Cancel</button>
        <button class="btn" id="po-yes" style="flex:1">Create Poll</button>
      </div>
    </div>
  `);

  s('po-no').onclick = () => Nav.close('ov-modal');
  s('po-yes').onclick = () => {
    const q = s('po-q').value.trim();
    const opts = [s('po-1').value.trim(), s('po-2').value.trim(), s('po-3').value.trim()].filter(Boolean);
    if (!q || opts.length < 2) { s('po-err').textContent = 'Please enter a question and at least two options.'; return; }
    pushMessage(buildMessage({ type: 'poll', poll: { question: q, options: opts.map(t => ({ text: t, votes: {} })) } }))
      .then(() => { Nav.close('ov-modal'); toast('Poll sent'); })
      .catch(() => { s('po-err').textContent = 'Could not send poll.'; });
  };
}

/* ---------------- Sticker & Emoji Tray ---------------- */
const EMOJI_SET = ['😀','😄','😁','😂','🤣','🙂','😉','😊','🥰','😍','😘','😎','🤩','🥳','😭','😅','🤔','😴','🤗','😇','🙃','😜','🤝','🙏','👍','👏','🙌','💪','🔥','✨','🎉','🎊','💯','❤️','💔','💙','🥇','⭐','🌈','🌸','🍀','🌙','☕','🍕','🎂','⚽','🚀','📷','🎵','🐱','🐶','🦄','🐼','👋','😢','😮','😡','🤞','💡','✅','❌'];

function closeTray() {
  const t = s('sticker-tray');
  if (t) { t.classList.remove('open'); t.innerHTML = ''; t.dataset.built = ''; }
}

function openTray(which) {
  const t = s('sticker-tray'); if (!t) return;
  if (t.classList.contains('open') && t.dataset.which === which) { closeTray(); return; }
  t.dataset.built = '1'; t.dataset.which = which;
  t.classList.add('open');

  if (which === 'emoji') {
    t.innerHTML = `
      <div class="tray-tabs">
        <button class="chip on" data-traytab="emoji">Emoji</button>
        <button class="chip" data-traytab="gifs">GIFs</button>
      </div>
      <div class="tray-body">
        <div class="emoji-grid">${EMOJI_SET.map(e => '<span data-emoji="' + e + '">' + e + '</span>').join('')}</div>
      </div>
    `;
    $$('.emoji-grid span', t).forEach(el => el.onclick = () => {
      const inp = s('composer-input');
      if (inp) { inp.value += el.dataset.emoji; autoGrow(inp); inp.focus(); }
    });
  } else {
    t.innerHTML = `
      <div class="tray-tabs">
        <button class="chip" data-traytab="emoji">Emoji</button>
        <button class="chip on" data-traytab="gifs">GIFs</button>
      </div>
    ` + GifEngine.trayHTML();
    GifEngine.wireTray();
  }
  $$('[data-traytab]', t).forEach(b => b.onclick = () => openTray(b.dataset.traytab));
}

/* ---------------- Group Management ---------------- */
function openCreateGroup() {
  const contacts = Object.keys(ST.me.contacts || {});
  if (!contacts.length) { toast('Connect with friends in Discover first to form a group.'); return; }
  openModal(`
    <div class="pad">
      <h3>Create New Group</h3>
      <div style="display:flex;justify-content:center;margin-bottom:14px">
        <div class="av lg" id="cg-av" style="cursor:pointer;background:var(--kr-brand);box-shadow:var(--kr-sh-2)">＋</div>
      </div>
      <input type="file" id="cg-file" accept="image/*" hidden>
      ${field('cg-name', 'Group Name', '', 'text', 'My Group')}
      ${textarea('cg-desc', 'Group Description', '', 'What is this group about?')}
      <div class="field"><label>Select Members</label><div style="max-height:30vh;overflow:auto">
        ${contacts.map(uid => {
          const u = ST.users[uid] || { uid: uid };
          return `
            <label class="row" style="padding:8px 0">
              ${getAvatarHTML(u, 'sm')}
              <div class="mid"><div class="t1"><b>${esc(userLabel(u))}</b></div></div>
              <input type="checkbox" data-mem="${esc(uid)}" style="width:20px;height:20px">
            </label>
          `;
        }).join('')}
      </div></div>
      <div class="err" id="cg-err"></div>
      <div style="display:flex;gap:10px;margin-top:14px">
        <button class="btn ghost" id="cg-no" style="flex:1">Cancel</button>
        <button class="btn" id="cg-yes" style="flex:1">Create Group</button>
      </div>
    </div>
  `);

  let pic = null;
  s('cg-no').onclick = () => Nav.close('ov-modal');
  s('cg-av').onclick = () => s('cg-file').click();
  s('cg-file').onchange = () => {
    const f = s('cg-file').files && s('cg-file').files[0];
    if (f) handleAvatarPick(f, 'cg-av', b64 => { pic = b64; });
  };

  s('cg-yes').onclick = async () => {
    const name = s('cg-name').value.trim();
    const picked = $$('[data-mem]').filter(c => c.checked).map(c => c.dataset.mem);
    if (!name) { s('cg-err').textContent = 'Please enter a group name.'; return; }
    if (!picked.length) { s('cg-err').textContent = 'Please select at least one member.'; return; }

    const gid = db.ref('groups').push().key;
    const members = { [ST.me.uid]: true };
    picked.forEach(u => members[u] = true);

    try {
      await db.ref('groups/' + gid).set({
        id: gid,
        name: name,
        desc: s('cg-desc').value.trim().slice(0, 200),
        photo: pic || '',
        members: members,
        admins: { [ST.me.uid]: true },
        createdBy: ST.me.uid,
        createdAt: now(),
        lastMsgAt: now()
      });
      Nav.close('ov-modal');
      toast('Group created');
      openChat(gid, 'group', gid);
    } catch (e) {
      s('cg-err').textContent = 'Could not create group.';
    }
  };
}

function openGroupInfo(gid) {
  const g = ST.groups[gid]; if (!g) return;
  const members = Object.keys(g.members || {});
  openModal(`
    <div class="pad">
      <h3>${esc(g.name || 'Group')}</h3>
      ${g.desc ? '<p style="color:var(--kr-mut);font-size:14px;margin:0 0 10px">' + esc(g.desc) + '</p>' : ''}
      <div class="sec-title" style="padding-left:0">${members.length} members</div>
      <div style="max-height:44vh;overflow:auto">
        ${members.map(uid => {
          const u = ST.users[uid] || { uid: uid };
          return `
            <div class="row" style="padding:8px 0">
              ${getAvatarHTML(u, 'sm')}
              <div class="mid">
                <div class="t1"><b>${esc(userLabel(u))}</b>${uid === ST.me.uid ? '<span class="pillx" style="font-size:10px">you</span>' : ''}</div>
              </div>
              <button class="btn sm ghost" data-gm="${esc(uid)}">${uid === ST.me.uid ? 'Profile' : 'Message'}</button>
            </div>
          `;
        }).join('')}
      </div>
      <button class="btn block ghost" id="gi-close" style="margin-top:14px">Close</button>
    </div>
  `);

  s('gi-close').onclick = () => Nav.close('ov-modal');
  $$('[data-gm]').forEach(b => b.onclick = () => {
    Nav.close('ov-modal');
    const uid = b.dataset.gm;
    setTimeout(() => { if (uid === ST.me.uid) openProfile(uid); else attemptOpenChat(uid); }, 120);
  });
}

function openChatMenu() {
  if (!ST.chat) return;
  const cid = ST.chat.chatId;
  const items = [
    { icon: '🔎', label: 'Search in conversation', run: searchInChat },
    { icon: '🔔', label: isMuted(cid) ? 'Unmute conversation' : 'Mute conversation', run: () => {
        db.ref('users/' + ST.me.uid + '/muted/' + cid).set(isMuted(cid) ? null : true)
          .then(() => {
            if (ST.me.muted) { if (isMuted(cid)) delete ST.me.muted[cid]; else ST.me.muted[cid] = true; }
            toast(isMuted(cid) ? 'Chat unmuted' : 'Chat muted');
          });
      } },
    { icon: '📌', label: isPinnedChat(cid) ? 'Unpin chat' : 'Pin chat to top', run: () => {
        db.ref('users/' + ST.me.uid + '/pinnedChats/' + cid).set(isPinnedChat(cid) ? null : true)
          .then(() => {
            if (ST.me.pinnedChats) { if (isPinnedChat(cid)) delete ST.me.pinnedChats[cid]; else ST.me.pinnedChats[cid] = true; }
            renderChats();
          });
      } },
    { icon: '🧹', label: 'Clear chat messages', run: () => {
        confirmSheet('Clear Conversation', 'Messages will be cleared for your account only.', 'Clear', () => {
          db.ref('users/' + ST.me.uid + '/clearedChats/' + cid).set(now()).then(() => {
            if (ST.chat) ST.chat.clearedAt = now();
            ST.chatMsgs = {};
            const b = s('chat-messages'); if (b) b.innerHTML = '';
            updateEmptyState();
            toast('Chat cleared');
          });
        }, true);
      } }
  ];

  if (ST.chat.type === 'group') {
    items.unshift({ icon: '👥', label: 'Group Information', run: () => openGroupInfo(cid) });
    items.push({ icon: '🚪', label: 'Leave Group', danger: true, run: () => {
      confirmSheet('Leave Group', 'You will leave this group conversation.', 'Leave', () => {
        db.ref('groups/' + cid + '/members/' + ST.me.uid).remove().then(() => {
          Nav.go('main', { tab: 'chats' }, { replace: true });
          ST.chat = null;
          renderChats();
        });
      }, true);
    } });
  } else {
    const uid = ST.chat.targetId;
    items.push({ icon: '👤', label: 'View Profile', run: () => openProfile(uid) });
    items.push({ icon: '🚫', label: isBlockedBy(ST.users[uid]) ? 'Unblock' : 'Block', danger: !isBlockedBy(ST.users[uid]), run: () => {
      if (isBlockedBy(ST.users[uid])) unblockUser(uid);
      else confirmSheet('Block User', 'Block messages and status updates from this account.', 'Block', () => blockUser(uid), true);
    } });
  }
  openSheet(ST.chat.name || 'Chat Options', items);
}

function searchInChat() {
  openModal(`
    <div class="pad">
      <h3>Search in Conversation</h3>
      ${field('sc-q', 'Search term', '', 'text', 'Search messages…')}
      <div id="sc-results" style="max-height:44vh;overflow:auto;margin-top:10px"></div>
      <button class="btn block ghost" id="sc-close" style="margin-top:12px">Close</button>
    </div>
  `);

  s('sc-close').onclick = () => Nav.close('ov-modal');
  s('sc-q').oninput = () => {
    const q = s('sc-q').value.trim().toLowerCase();
    const out = s('sc-results');
    if (!q) { out.innerHTML = ''; return; }
    const hits = Object.keys(ST.chatMsgs).map(k => ST.chatMsgs[k]).filter(m => !m.deleted && String(m.text || '').toLowerCase().indexOf(q) >= 0).slice(-40).reverse();
    out.innerHTML = hits.length ? hits.map(m => `
      <div class="row" style="padding:8px 0">
        <div class="av sm" style="background:var(--kr-bg2);color:var(--kr-txt);font-size:16px">💬</div>
        <div class="mid">
          <div class="t2">${esc(fmtWhen(m.timestamp))} · ${esc(m.sender === ST.me.uid ? 'You' : userLabel(ST.users[m.sender] || {}))}</div>
          <div class="t1"><b style="font-weight:500;white-space:normal">${esc(m.text)}</b></div>
        </div>
      </div>
    `).join('') : '<p style="color:var(--kr-mut);font-size:14px">No matching messages found.</p>';
  };
}

/* ---------------- Listeners for Users, Groups, Requests ---------------- */
function listenUsers() {
  listen('users:root', 'users', 'value', sn => {
    const all = sn.val() || {};
    ST.users = {};
    Object.keys(all).forEach(uid => { ST.users[uid] = Object.assign({ uid: uid }, all[uid]); });
    if (ST.me) ST.me = Object.assign({ uid: ST.me.uid }, ST.users[ST.me.uid] || {}, { uid: ST.me.uid });
    renderChats(); renderPeople(); renderStatus(); renderSettings();
    if (Nav.current === 'chat') syncChatHeader();
  });
}

function listenGroups() {
  if (!ST.me) return;
  listen('groups:own', 'groups', 'value', sn => {
    const all = sn.val() || {};
    ST.groups = {};
    Object.keys(all).forEach(gid => {
      const g = all[gid];
      if (g && g.members && g.members[ST.me.uid]) ST.groups[gid] = Object.assign({ id: gid }, g);
    });
    renderChats();
    if (Nav.current === 'chat' && ST.chat && ST.chat.type === 'group') syncChatHeader();
  });
}

function listenUnread() {
  listen('unread', 'unreadCounts/' + ST.me.uid, 'value', sn => {
    ST.unread = sn.val() || {};
    refreshBadges();
    renderChats();
  });
}

function bumpUnread(uid, cid) {
  if (!uid || uid === ST.me.uid) return;
  db.ref('unreadCounts/' + uid + '/' + cid).transaction(n => (n || 0) + 1).catch(() => {});
}

function refreshBadges() {
  let total = 0;
  Object.keys(ST.unread || {}).forEach(cid => { total += Number(ST.unread[cid]) || 0; });
  const b = s('badge-chats');
  if (b) { b.textContent = total > 99 ? '99+' : total; b.style.display = total ? 'flex' : 'none'; }
  const pending = Object.keys(ST.requests || {}).filter(u => ST.requests[u] && ST.requests[u].type === 'in').length;
  const rb = s('btn-reqs');
  if (rb) { rb.dataset.n = pending; rb.style.display = pending ? 'flex' : 'flex'; }
  document.title = (total ? '(' + total + ') ' : '') + 'KLYRO';
}

function listenRequests() {
  listen('requests', 'requests/' + ST.me.uid, 'value', sn => {
    ST.requests = sn.val() || {};
    refreshBadges();
    renderPeople();
    if (Nav.isOpen('ov-modal') && s('req-list')) paintRequests();
  });
}

function openRequests() {
  const incoming = Object.keys(ST.requests || {}).filter(u => ST.requests[u] && ST.requests[u].type === 'in');
  if (!incoming.length) { toast('No pending connection requests.'); return; }
  openModal(`
    <div class="pad">
      <h3>Connection Requests</h3>
      <div id="req-list"></div>
      <button class="btn block ghost" id="req-close" style="margin-top:14px">Close</button>
    </div>
  `);
  s('req-close').onclick = () => Nav.close('ov-modal');
  paintRequests();
}

function paintRequests() {
  const list = s('req-list'); if (!list) return;
  const incoming = Object.keys(ST.requests || {}).filter(u => ST.requests[u] && ST.requests[u].type === 'in');
  if (!incoming.length) { Nav.close('ov-modal'); return; }
  list.innerHTML = incoming.map(uid => {
    const u = ST.users[uid] || { uid: uid };
    return `
      <div class="row" style="padding:10px 0">
        ${getAvatarHTML(u)}
        <div class="mid">
          <div class="t1"><b>${esc(userLabel(u))}</b></div>
          <div class="t2">Wants to connect${u.username ? ' · @' + esc(u.username) : ''}</div>
        </div>
        <div style="display:flex;gap:6px">
          <button class="btn sm ghost" data-req-no="${esc(uid)}">Decline</button>
          <button class="btn sm" data-req-yes="${esc(uid)}">Accept</button>
        </div>
      </div>
    `;
  }).join('');
  $$('[data-req-yes]', list).forEach(b => b.onclick = () => handleRequest(b.dataset.reqYes, true));
  $$('[data-req-no]', list).forEach(b => b.onclick = () => handleRequest(b.dataset.reqNo, false));
}

function blockUser(uid) {
  if (!uid) return;
  db.ref('users/' + ST.me.uid + '/blocked/' + uid).set(true).then(() => {
    ST.me.blocked = ST.me.blocked || {}; ST.me.blocked[uid] = true;
    toast('User blocked'); Nav.close('ov-modal'); renderChats(); renderPeople();
  });
}

function unblockUser(uid) {
  db.ref('users/' + ST.me.uid + '/blocked/' + uid).remove().then(() => {
    if (ST.me.blocked) delete ST.me.blocked[uid];
    toast('User unblocked'); renderPeople(); renderChats();
  });
}

function reportUser(uid, context) {
  db.ref('reports').push({ by: ST.me.uid, about: uid, context: String(context || '').slice(0, 400), ts: now() })
    .then(() => toast('Report submitted — thank you.')).catch(() => toast('Could not submit report.'));
}

function registerDevice(uid) {
  let did = null;
  try { did = localStorage.getItem('kr_device'); } catch (e) {}
  if (!did) {
    did = 'd' + Math.random().toString(36).slice(2, 11);
    try { localStorage.setItem('kr_device', did); } catch (e) {}
  }
  db.ref('usersPrivate/' + uid + '/devices/' + did).update({
    ua: navigator.userAgent.slice(0, 170),
    mobile: /Mobi|Android|iPhone/i.test(navigator.userAgent),
    label: /Mobi|Android|iPhone/i.test(navigator.userAgent) ? 'Mobile Browser' : 'Desktop Browser',
    lastActive: now()
  }).catch(() => {});
}

let activeNotifToast = null;
let notifToastTimer = null;
const seenNotifs = new Set();

function listenNotifications() {
  if (!ST.me) return;
  unlisten('userNotifications');
  listen('userNotifications', 'userNotifications/' + ST.me.uid, 'child_added', sn => {
    const n = sn.val();
    if (!n || !n.messageId) return;
    const key = sn.key;
    if (n.senderId === ST.me.uid || n.status !== 'unread') return;
    if (seenNotifs.has(key)) return;
    seenNotifs.add(key);

    // If message was created more than 3 minutes ago, do not pop toast
    if (n.createdAt && (now() - n.createdAt > 180000)) return;

    // Check if user is currently looking at this exact chat while document is active/visible
    const isCurrentActiveChat = (Nav.current === 'chat' && ST.chat && 
      (ST.chat.chatId === n.conversationId || ST.chat.targetId === n.senderId) && 
      !document.hidden);
    
    if (isCurrentActiveChat) {
      // User is actively looking at this conversation: mark read silently
      sn.ref.update({ status: 'seen' }).catch(() => {});
      return;
    }

    // Trigger System / Web Notification if backgrounded or permitted
    if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
      try {
        const sysNotif = new Notification(n.senderName || 'KLYRO', {
          body: n.text || 'Sent you a message',
          icon: n.senderPhoto || '/favicon.ico',
          tag: 'msg_' + n.messageId, // Preserves exact message identity!
          data: n
        });
        sysNotif.onclick = () => {
          window.focus();
          sysNotif.close();
          handleNotificationReply(n);
        };
      } catch (e) {}
    }

    // Always show non-intrusive interactive in-app toast if document is visible
    if (!document.hidden) {
      showInAppNotificationToast(n);
    }
  });

  // Also listen for service worker messages
  if ('serviceWorker' in navigator) {
    try {
      navigator.serviceWorker.addEventListener('message', ev => {
        if (ev.data && ev.data.type === 'NOTIFICATION_REPLY_ACTION') {
          const { data, replyText } = ev.data;
          if (data) handleNotificationReply(data, replyText);
        }
      });
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    } catch (e) {}
  }
}

function showInAppNotificationToast(n) {
  const t = s('in-app-notification-toast');
  if (!t) return;
  activeNotifToast = n;

  const senderEl = s('nt-sender');
  if (senderEl) senderEl.textContent = n.senderName || 'Friend';

  const textEl = s('nt-text');
  if (textEl) textEl.textContent = n.text || 'New message';

  const imgEl = s('nt-avatar-img');
  const fallbackEl = s('nt-avatar-fallback');
  if (imgEl && fallbackEl) {
    if (n.senderPhoto) {
      imgEl.src = n.senderPhoto;
      imgEl.style.display = 'block';
      fallbackEl.style.display = 'none';
    } else {
      imgEl.style.display = 'none';
      fallbackEl.style.display = 'flex';
      fallbackEl.textContent = initials(n.senderName) || '👤';
    }
  }

  const replyBtn = s('nt-reply-btn');
  if (replyBtn) {
    replyBtn.onclick = (e) => {
      e.stopPropagation();
      hideInAppNotificationToast();
      handleNotificationReply(n);
    };
  }

  const closeBtn = s('nt-close-btn');
  if (closeBtn) {
    closeBtn.onclick = (e) => {
      e.stopPropagation();
      hideInAppNotificationToast();
    };
  }

  // Progress fill animation for 8 seconds
  const fill = s('nt-progress');
  const totalMs = 8000;
  const startTime = Date.now();
  clearInterval(notifToastTimer);
  if (fill) fill.style.transform = 'scaleX(1)';

  notifToastTimer = setInterval(() => {
    const elapsed = Date.now() - startTime;
    const remaining = Math.max(0, 1 - (elapsed / totalMs));
    if (fill) fill.style.transform = `scaleX(${remaining})`;
    if (remaining <= 0) {
      clearInterval(notifToastTimer);
      hideInAppNotificationToast();
    }
  }, 100);

  t.classList.add('show');

  // Friendly soft vibration if available
  try {
    if (navigator && navigator.vibrate) navigator.vibrate([25, 35, 25]);
  } catch (e) {}
}

function hideInAppNotificationToast() {
  const t = s('in-app-notification-toast');
  if (t) t.classList.remove('show');
  clearInterval(notifToastTimer);
  notifToastTimer = null;
  activeNotifToast = null;
}

function handleNotificationReply(notif, inlineText) {
  if (!notif || !ST.me) return;

  // Mark notification as replied or opened
  db.ref('userNotifications/' + ST.me.uid + '/' + notif.messageId).update({
    status: inlineText ? 'replied' : 'opened'
  }).catch(() => {});

  if (inlineText && inlineText.trim()) {
    // Immediate inline reply execution
    const replyPayload = {
      type: 'text',
      text: inlineText.trim(),
      sender: ST.me.uid,
      timestamp: now(),
      createdAt: now(),
      status: 'sent',
      replyTo: {
        key: notif.messageId,
        name: notif.senderName,
        text: notif.text
      }
    };
    db.ref('messages/' + notif.conversationId).push(replyPayload).then(() => {
      bumpUnread(notif.senderId, notif.conversationId);
      toast('Reply sent to ' + notif.senderName);
    }).catch(() => toast('Could not send reply.'));
    return;
  }

  // Fallback / standard interactive reply:
  // Open the EXACT conversation and target that SPECIFIC message!
  openChat(notif.senderId, 'direct', notif.conversationId);
  setReply({
    key: notif.messageId,
    sender: notif.senderId,
    name: notif.senderName,
    text: notif.text
  });
  const inp = s('composer-input');
  if (inp) {
    inp.focus();
  }
}

function notify(title, body) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try { new Notification(title, { body: body, icon: '/favicon.ico' }); } catch (e) {}
}

function initTheme() {
  let m = 'light';
  try { m = localStorage.getItem('kr_theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); } catch (e) {}
  applyTheme(m);
  const b = s('btn-theme');
  if (b) b.onclick = () => applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
}

function applyTheme(mode) {
  document.documentElement.setAttribute('data-theme', mode === 'dark' ? 'dark' : 'light');
  try { localStorage.setItem('kr_theme', mode); } catch (e) {}
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', mode === 'dark' ? '#090D16' : '#2563EB');
  if (ST.me && ST.me.uid) db.ref('users/' + ST.me.uid + '/theme').set(mode).catch(() => {});
}

function detectPerf() {
  try {
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const cores = navigator.hardwareConcurrency || 4;
    const slow = reduced || cores <= 3 || /2g/.test((navigator.connection && navigator.connection.effectiveType) || '');
    if (slow) document.body.classList.add('low-perf');
  } catch (e) {}
}

/* ---------------- Sheet, Modal & Field Helpers ---------------- */
function openSheet(title, items) {
  s('sheet-title').textContent = title;
  s('sheet-list').innerHTML = items.map((it, i) => `
    <button class="sitem ${it.danger ? 'danger' : ''}" data-sheet="${i}" ${it.disabled ? 'disabled' : ''}>
      <span class="sic">${it.icon || '•'}</span>
      <span style="flex:1">
        <span style="display:block">${esc(it.label)}</span>
        ${it.sub ? `<span style="display:block;font-size:12px;color:var(--kr-mut);font-weight:500">${esc(it.sub)}</span>` : ''}
      </span>
    </button>
  `).join('');

  $$('[data-sheet]', s('sheet-list')).forEach(el => {
    el.onclick = () => {
      const it = items[+el.dataset.sheet];
      Nav.close('ov-sheet');
      if (it && it.run) setTimeout(it.run, 80);
    };
  });
  Nav.open('ov-sheet');
}

function openModal(html) {
  s('modal-card').innerHTML = html;
  Nav.open('ov-modal');
  return s('modal-card');
}

function confirmSheet(title, message, confirmLabel, onConfirm, danger) {
  openModal(`
    <div class="pad">
      <h3>${esc(title)}</h3>
      <p style="color:var(--kr-mut);font-size:14px;margin:0 0 16px">${esc(message)}</p>
      <div style="display:flex;gap:10px">
        <button class="btn ghost" id="cf-no" style="flex:1">Cancel</button>
        <button class="btn ${danger ? 'danger' : ''}" id="cf-yes" style="flex:1">${esc(confirmLabel || 'Confirm')}</button>
      </div>
    </div>
  `);
  s('cf-no').onclick = () => Nav.close('ov-modal');
  s('cf-yes').onclick = () => { Nav.close('ov-modal'); setTimeout(onConfirm, 80); };
}

function field(id, label, value, type, ph, extra) {
  return `<div class="field"><label>${esc(label)}</label>
    <input id="${id}" class="inp" type="${type || 'text'}" value="${esc(value || '')}" placeholder="${esc(ph || '')}" ${extra || ''}></div>`;
}

function textarea(id, label, value, ph, max) {
  return `<div class="field"><label>${esc(label)}</label>
    <textarea id="${id}" class="inp" placeholder="${esc(ph || '')}" ${max ? 'maxlength="' + max + '"' : ''}>${esc(value || '')}</textarea></div>`;
}

/* ---------------- Wire General UI ---------------- */
function openNewSheet() {
  openSheet('Start Something', [
    { icon: '🔍', label: 'Find by username', sub: 'Search the entire network', run: openFindUser },
    { icon: '➕', label: 'Invite friends', sub: 'Share your personal handle', run: openInvite },
    { icon: '👥', label: 'New group', sub: 'Chat with multiple contacts', run: openCreateGroup },
    { icon: '📝', label: 'Post status update', sub: 'Text, photo or short video', run: openStatusComposer }
  ]);
}

function wireUI() {
  $$('.nav-item').forEach(n => n.onclick = () => Nav.tab_(n.dataset.tab));
  const fab = s('fab'); if (fab) fab.onclick = openNewSheet;
  const rb = s('btn-reqs'); if (rb) rb.onclick = openRequests;
  const btnPostHead = s('btn-new-status-head'); if (btnPostHead) btnPostHead.onclick = openStatusComposer;

  const search = s('main-search');
  if (search) {
    search.addEventListener('input', () => {
      clearTimeout(ST._searchT);
      ST._searchT = setTimeout(() => { renderChats(); renderPeople(); }, 220);
    });
  }

  const back = s('chat-back'); if (back) back.onclick = () => Nav.back('main');
  const who = s('chat-who');
  if (who) {
    who.onclick = () => {
      if (!ST.chat) return;
      if (ST.chat.type === 'direct') openProfile(ST.chat.targetId);
      else openGroupInfo(ST.chat.chatId);
    };
  }

  const menu = s('btn-chat-menu'); if (menu) menu.onclick = openChatMenu;
  const ca = s('btn-call-audio'); if (ca) ca.onclick = () => Calls.start(false);
  const cv = s('btn-call-video'); if (cv) cv.onclick = () => Calls.start(true);

  const send = s('btn-send'); if (send) send.onclick = sendText;
  const attach = s('btn-attach'); if (attach) attach.onclick = openAttachSheet;
  const emoji = s('btn-emoji'); if (emoji) emoji.onclick = () => openTray('emoji');
  const mic = s('btn-mic');
  if (mic) {
    mic.onclick = () => {
      if (ST.mediaRec && ST.mediaRec.state === 'recording') Voice.stop();
      else Voice.start();
    };
  }

  const rc = s('btn-reply-cancel'); if (rc) rc.onclick = cancelReply;
  const rs = s('rec-stop'); if (rs) rs.onclick = () => Voice.stop();
  const rx = s('rec-cancel'); if (rx) rx.onclick = () => Voice.cancel();

  const ub = s('ub-cancel');
  if (ub) {
    ub.onclick = () => {
      if (ST.activeTransfer) MediaEngine.cancel(ST.activeTransfer.id);
      ST.activeTransfer = null;
      UpBar.hide();
    };
  }

  const inp = s('composer-input');
  if (inp) {
    inp.addEventListener('input', () => {
      autoGrow(inp);
      if (!ST.chat) return;
      saveDraft(ST.chat.chatId, inp.value.trim());
      if (!privacyOf(ST.me).typingIndicator) return;
      db.ref('typing/' + ST.chat.chatId + '/' + ST.me.uid).set(true).catch(() => {});
      clearTimeout(ST.typingTimer);
      ST.typingTimer = setTimeout(() => {
        if (ST.chat) db.ref('typing/' + ST.chat.chatId + '/' + ST.me.uid).remove().catch(() => {});
      }, 1800);
    });

    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.isComposing) {
        if (settingsOf(ST.me).enterToSend === false) return;
        e.preventDefault();
        sendText();
      }
    });

    inp.addEventListener('focus', () => setTimeout(scrollToBottom, 260));
  }

  const file = s('file-input');
  if (file) file.onchange = () => handlePickedFile(file);

  /* Calls UI buttons */
  const ea = s('btn-end-call'); if (ea) ea.onclick = () => Calls.end();
  const rj = s('btn-reject-call'); if (rj) rj.onclick = () => Calls.decline();
  const ac = s('btn-accept-call'); if (ac) ac.onclick = () => Calls.accept();
  const mu = s('btn-mute'); if (mu) mu.onclick = () => Calls.toggleMute();
  const cm = s('btn-cam'); if (cm) cm.onclick = () => Calls.toggleCam();

  /* Overlays backdrop dismissals */
  const mc = s('media-close'); if (mc) mc.onclick = () => Viewer.close();
  ['ov-sheet','ov-modal','ov-compose','ov-media','ov-onboarding'].forEach(id => {
    const el = s(id);
    if (el) {
      el.addEventListener('click', e => {
        if (e.target !== el) return;
        if (id === 'ov-media') Viewer.close();
        else if (id !== 'ov-onboarding') Nav.close(id);
      });
    }
  });

  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (!Nav.closeTop() && Nav.current !== 'main') Nav.back('main');
  });

  window.addEventListener('popstate', () => {
    if (Nav.closeTop()) { history.pushState({ kr: 1 }, ''); return; }
    if (Nav.stack.length) { Nav.back('main'); history.pushState({ kr: 1 }, ''); }
    else history.pushState({ kr: 1 }, '');
  });

  wireMessageEvents();

  window.addEventListener('pagehide', () => {
    try { if (ST.chat && ST.me) db.ref('typing/' + ST.chat.chatId + '/' + ST.me.uid).remove(); } catch (e) {}
    if (ST.mediaRec) Voice.cancel();
    Calls.end(true);
    Player.stopAll();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) Player.stopAll();
    else if (ST.chat) scrollToBottom();
  });
}

function wireMessageEvents() {
  const box = s('chat-messages');
  if (!box || box._wired) return;
  box._wired = true;

  box.addEventListener('click', e => {
    const t = e.target;
    if (t.closest('[data-tcancel]')) {
      MediaEngine.cancel(t.closest('[data-tcancel]').dataset.tcancel);
      return;
    }
    if (t.closest('[data-tretry]')) {
      MediaEngine.retry(t.closest('[data-tretry]').dataset.tretry);
      return;
    }
    if (t.closest('[data-trequest]')) {
      const b = t.closest('[data-trequest]');
      MediaEngine.requestResend(b.dataset.trequest, b.dataset.tfrom);
      return;
    }
    if (t.closest('[data-save]')) {
      const key = t.closest('[data-save]').dataset.save;
      Store.get(key).then(rec => {
        if (!rec || !rec.blob) { toast('File not cached on this device.'); return; }
        downloadBlobUrl(Store.url(key, rec.blob), rec.name || 'klyro-file');
      });
      return;
    }
    if (t.closest('[data-voice]')) {
      const b = t.closest('[data-voice]');
      playVoice(b.dataset.voice, b.dataset.url, b);
      return;
    }
    if (t.closest('[data-inline-audio]')) {
      const b = t.closest('[data-inline-audio]');
      const key = b.dataset.inlineAudio;
      const m = ST.chatMsgs[key];
      const url = m && m.media ? safeMedia(m.media.url) : '';
      if (!url) { toast('Audio unavailable.'); return; }
      playVoice(key, url, b);
      return;
    }
    if (t.closest('[data-view]')) {
      const el = t.closest('[data-view]');
      const key = el.dataset.mkey || '';
      Viewer.open({ url: el.dataset.view, kind: el.dataset.vkind || 'image', name: el.dataset.vname || '', key: key });
      return;
    }
    if (t.closest('[data-file]')) {
      const el = t.closest('[data-file]');
      const url = el.dataset.file, name = el.dataset.name || 'file';
      const mime = /\.(png|jpe?g|gif|webp)$/i.test(name) ? 'image' : /\.(mp4|webm|mov)$/i.test(name) ? 'video' : /\.(mp3|m4a|wav|ogg)$/i.test(name) ? 'audio' : 'file';
      if (mime === 'file') downloadBlobUrl(url, name);
      else Viewer.open({ url: url, kind: mime, name: name });
      return;
    }
    if (t.closest('[data-vote]')) {
      const b = t.closest('[data-vote]');
      const key = b.closest('.bub').dataset.key;
      votePoll(key, +b.dataset.vote);
      return;
    }
    if (t.closest('[data-react]')) {
      const b = t.closest('[data-react]');
      toggleReaction(b.dataset.react, b.dataset.emoji);
      return;
    }
  });

  box.addEventListener('scroll', () => {
    if (box.scrollTop < 26 && ST.chat && Object.keys(ST.chatMsgs).length >= (ST.msgLimit || 60) - 2 && !ST._olderLoading) {
      ST._olderLoading = true;
      setTimeout(() => {
        if (!ST.chat) return;
        ST.msgLimit = (ST.msgLimit || 60) + 60;
        attachMessageListeners(pathFor(ST.chat.chatId, ST.chat.type));
        ST._olderLoading = false;
      }, 220);
    }
  }, { passive: true });
}

/* ============================ HOME COMMAND CENTER ============================ */
function renderHome() {
  const container = s('home-content');
  if (!container || !ST.me) return;

  const onlineUsers = Object.values(ST.users || {}).filter(u => u && u.uid !== ST.me.uid && isUserOnlineNow(u) && !isBlockedBy(u));
  const recentChats = (typeof chatEntries === 'function' ? chatEntries() : []).slice(0, 3);
  const pulsePosts = (typeof PostsEngine !== 'undefined' ? PostsEngine.getSortedFeed() : []).slice(0, 2);

  container.innerHTML = `
    <div style="padding:14px 14px 32px">
      <!-- 1. GREETING & PROFILE HERO -->
      <div style="background:linear-gradient(135deg,rgba(37,99,235,0.08),rgba(124,58,237,0.08));border:1px solid rgba(37,99,235,0.2);border-radius:20px;padding:16px;margin-bottom:18px;display:flex;align-items:center;justify-content:space-between">
        <div style="display:flex;align-items:center;gap:12px">
          <div onclick="Nav.tab_('profile')" style="cursor:pointer">
            ${getAvatarHTML(ST.me, 'md')}
          </div>
          <div>
            <div style="font-size:16px;font-weight:800;color:var(--kr-txt)">Hello, ${esc(userLabel(ST.me).split(' ')[0])}!</div>
            <div style="font-size:12px;color:var(--kr-mut)">${esc(handleFrom(ST.me))}</div>
          </div>
        </div>
        <button class="btn sm" onclick="Nav.tab_('profile')" style="height:32px;font-size:12.5px;padding:0 12px;background:var(--kr-brand)">
          👤 My Profile
        </button>
      </div>

      <!-- 2. QUICK ACTIONS BAR -->
      <div style="display:grid;grid-template-columns:repeat(4, 1fr);gap:8px;margin-bottom:20px;text-align:center">
        <button class="card" onclick="openPostComposer()" style="padding:12px 6px;border-radius:14px;border:1px solid var(--kr-line);background:var(--kr-elev);cursor:pointer">
          <div style="font-size:22px;margin-bottom:4px">✍️</div>
          <div style="font-size:11.5px;font-weight:700">New Post</div>
        </button>
        <button class="card" onclick="openStatusComposer()" style="padding:12px 6px;border-radius:14px;border:1px solid var(--kr-line);background:var(--kr-elev);cursor:pointer">
          <div style="font-size:22px;margin-bottom:4px">✨</div>
          <div style="font-size:11.5px;font-weight:700">Add Status</div>
        </button>
        <button class="card" onclick="Nav.tab_('chats')" style="padding:12px 6px;border-radius:14px;border:1px solid var(--kr-line);background:var(--kr-elev);cursor:pointer">
          <div style="font-size:22px;margin-bottom:4px">💬</div>
          <div style="font-size:11.5px;font-weight:700">Messages</div>
        </button>
        <button class="card" onclick="openSwitchAccountModal()" style="padding:12px 6px;border-radius:14px;border:1px solid var(--kr-line);background:var(--kr-elev);cursor:pointer">
          <div style="font-size:22px;margin-bottom:4px">👥</div>
          <div style="font-size:11.5px;font-weight:700">Switch Acct</div>
        </button>
      </div>

      <!-- 3. FRIENDS ONLINE NOW -->
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <div style="font-weight:700;font-size:14px">Friends Online</div>
        <a style="font-size:12px;color:var(--kr-brand);cursor:pointer;font-weight:600" onclick="Nav.tab_('people')">See All (${onlineUsers.length})</a>
      </div>
      <div style="display:flex;gap:12px;overflow-x:auto;padding-bottom:10px;margin-bottom:18px;scrollbar-width:none">
        ${onlineUsers.length ? onlineUsers.map(u => `
          <div style="display:flex;flex-direction:column;align-items:center;gap:4px;cursor:pointer;flex:none;width:58px" onclick="attemptOpenChat('${esc(u.uid)}')">
            <div class="presence on" style="position:relative">
              ${getAvatarHTML(u, 'md')}
            </div>
            <span style="font-size:11px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:58px">${esc(userLabel(u).split(' ')[0])}</span>
          </div>
        `).join('') : `
          <div style="font-size:12.5px;color:var(--kr-mut);padding:8px 0">No friends online right now. Check Discover to meet people!</div>
        `}
      </div>

      <!-- 4. PROFILE & ACCOUNT QUICK SHORTCUT -->
      <div style="background:var(--kr-elev);border:1px solid var(--kr-line);border-radius:18px;padding:14px 16px;margin-bottom:20px;display:flex;align-items:center;justify-content:space-between">
        <div style="display:flex;align-items:center;gap:10px">
          <div style="font-size:24px">⚙️</div>
          <div>
            <div style="font-size:14px;font-weight:800">Account &amp; Profile</div>
            <div style="font-size:12px;color:var(--kr-mut)">Manage profiles, theme, and security</div>
          </div>
        </div>
        <button class="btn sm outline" onclick="Nav.tab_('profile')" style="font-size:12px;height:30px;padding:0 12px">Manage ›</button>
      </div>

      <!-- 5. TRENDING PULSE SPOTLIGHT -->
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <div style="font-weight:700;font-size:14px">⚡ Trending on Pulse</div>
        <a style="font-size:12px;color:var(--kr-brand);cursor:pointer;font-weight:600" onclick="Nav.tab_('posts')">Open Feed</a>
      </div>
      <div id="home-pulse-box" style="margin-bottom:20px">
        ${pulsePosts.length ? pulsePosts.map(p => `
          <div class="post-card" style="margin-bottom:10px;cursor:pointer" onclick="Nav.tab_('posts')">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
              ${getAvatarHTML(p.author, 'sm')}
              <div>
                <span style="font-size:13px;font-weight:700">${esc(p.author.name)}</span>
                <span style="font-size:11.5px;color:var(--kr-mut)"> · ${esc(fmtWhen(p.createdAt))}</span>
              </div>
            </div>
            <div style="font-size:13.5px;line-height:1.4;margin-bottom:6px">${esc((p.text || '').slice(0, 140))}</div>
            <div style="font-size:12px;color:var(--kr-mut)">❤️ ${p.likesCount || 0} likes · 💬 ${p.commentsCount || 0} comments</div>
          </div>
        `).join('') : `
          <div class="card" style="padding:16px;border-radius:14px;text-align:center;color:var(--kr-mut);font-size:13px">
            No posts yet. Be the first to share an update on KLYRO Pulse!
          </div>
        `}
      </div>

      <!-- 6. DAILY MISSIONS -->
      <div class="card" style="padding:16px;border-radius:18px;border:1px solid var(--kr-line);background:var(--kr-elev)">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
          <div style="font-weight:800;font-size:14px">🎯 Daily Missions</div>
          <span style="font-size:11.5px;color:var(--kr-ok);font-weight:700">+100 XP Bonus</span>
        </div>
        <div style="display:flex;flex-direction:column;gap:10px">
          <div style="display:flex;align-items:center;justify-content:space-between;font-size:13px">
            <span>Play 1 Arcade Match</span>
            <span style="color:var(--kr-brand);font-weight:700">0 / 1</span>
          </div>
          <div style="display:flex;align-items:center;justify-content:space-between;font-size:13px">
            <span>Share a post on Pulse</span>
            <span style="color:var(--kr-brand);font-weight:700">0 / 1</span>
          </div>
          <div style="display:flex;align-items:center;justify-content:space-between;font-size:13px">
            <span>Send a message to a friend</span>
            <span style="color:var(--kr-ok);font-weight:700">✓ Done</span>
          </div>
        </div>
      </div>
    </div>
  `;
}
