/* ============================ DISCOVER & PRESENCE ============================
   Discover Rules:
   - ONLY show users who are CURRENTLY ONLINE right now.
   - Include accounts created months or years ago if online right now.
   - Exclude offline users, even if they were active recently.
   - Exclude current user, blocked users, existing contacts, pending requests.
   - Exclude users with privacy.showOnline === false or findableByUsername === false.
   - Presence uses .info/connected + onDisconnect + heartbeat + defensive stale check (5 min).
   ============================================================================== */

function presence(uid) {
  db.ref('.info/connected').on('value', sn => {
    if (sn.val() !== true) return;
    const stRef = db.ref('users/' + uid + '/status');
    const lsRef = db.ref('users/' + uid + '/lastSeen');
    const pubStRef = db.ref('publicProfiles/' + uid + '/status');
    const pubLsRef = db.ref('publicProfiles/' + uid + '/lastSeen');

    stRef.onDisconnect().set('offline');
    lsRef.onDisconnect().set(TS);
    pubStRef.onDisconnect().set('offline');
    pubLsRef.onDisconnect().set(TS);

    stRef.set('online');
    lsRef.set(TS);
    pubStRef.set('online');
    pubLsRef.set(TS);
  });

  /* Active session heartbeat every 60s */
  clearInterval(ST._hb);
  ST._hb = setInterval(() => {
    if (!document.hidden && ST.me) {
      db.ref('users/' + ST.me.uid + '/lastSeen').set(TS).catch(() => {});
      db.ref('publicProfiles/' + ST.me.uid + '/lastSeen').set(TS).catch(() => {});
    }
  }, 60000);

  document.addEventListener('visibilitychange', () => {
    if (!ST.me) return;
    const isAway = document.hidden;
    const state = isAway ? 'away' : 'online';
    db.ref('users/' + ST.me.uid + '/status').set(state).catch(() => {});
    db.ref('publicProfiles/' + ST.me.uid + '/status').set(state).catch(() => {});
  });
}

/** Determines whether a user is genuinely online right now */
function isUserOnlineNow(u) {
  if (!u) return false;
  if (u.status !== 'online') return false;
  const p = privacyOf(u);
  if (p.showOnline === false) return false;
  
  /* Defensive staleness check: if lastSeen is older than 5 minutes, consider offline */
  const lastSeen = Number(u.lastSeen) || 0;
  if (lastSeen > 0 && (now() - lastSeen > 5 * 60 * 1000)) {
    return false;
  }
  return true;
}

function getOnlineDiscoverPool() {
  if (!ST.me) return [];
  const contacts = ST.me.contacts || {};
  const blocked = ST.me.blocked || {};
  const requests = ST.requests || {};
  const t = now();

  const pool = [];
  Object.keys(ST.users).forEach(uid => {
    if (uid === ST.me.uid) return;
    if (contacts[uid]) return;       // Exclude already connected contacts
    if (blocked[uid]) return;        // Exclude blocked users
    if (requests[uid]) return;       // Exclude pending requests

    const u = ST.users[uid];
    if (!u || !u.username) return;

    const p = privacyOf(u);
    if (p.findableByUsername === false || p.discoverable === false) return;
    if (!isUserOnlineNow(u)) return; // STRICT: ONLY CURRENTLY ONLINE USERS!

    pool.push(u);
  });

  /* Sort: Most recently active first, then alphabetical */
  pool.sort((a, b) => {
    const diff = (b.lastSeen || 0) - (a.lastSeen || 0);
    if (diff !== 0) return diff;
    return String(a.username || '').localeCompare(String(b.username || ''));
  });

  return pool;
}

function renderPeople() {
  const box = s('people-list'); if (!box || !ST.me) return;
  const q = (s('main-search') && s('main-search').value || '').toLowerCase().trim();

  /* 1. Discover Online Pool (NEW & OLD accounts, currently online only) */
  let onlinePool = getOnlineDiscoverPool();
  if (q) {
    onlinePool = onlinePool.filter(u =>
      (userLabel(u) + ' ' + (u.username || '') + ' ' + (u.country || '')).toLowerCase().indexOf(q) >= 0
    );
  }

  /* Update online badge in nav */
  const badge = s('badge-people-online');
  if (badge) {
    badge.textContent = onlinePool.length;
    badge.style.display = onlinePool.length > 0 ? 'flex' : 'none';
  }

  /* 2. Contacts List */
  const contacts = Object.keys(ST.me.contacts || {}).map(uid => ST.users[uid]).filter(Boolean);
  const filteredContacts = q ? contacts.filter(u =>
    (userLabel(u) + ' ' + (u.username || '')).toLowerCase().indexOf(q) >= 0
  ) : contacts;

  /* 3. Pending Incoming Requests */
  const pending = Object.keys(ST.requests || {}).filter(u => ST.requests[u] && ST.requests[u].type === 'in').map(uid => ST.users[uid] || { uid: uid });

  let html = '';

  /* Quick action buttons */
  html += `
    <div style="padding:10px 14px 4px">
      <div style="display:flex;gap:10px">
        <button class="btn sm outline" id="btn-find-un" style="flex:1">🔍 Find by @username</button>
        <button class="btn sm outline" id="btn-invite" style="flex:1">➕ Invite friends</button>
      </div>
    </div>
  `;

  /* Pending Requests */
  if (pending.length) {
    html += `
      <div class="sec-title" style="color:var(--kr-brand)">
        <span>Pending Requests (${pending.length})</span>
      </div>
      ${pending.map(u => `
        <div class="row" style="background:var(--kr-brand-soft);border-radius:var(--kr-r-s);margin:0 14px 6px">
          ${getAvatarHTML(u, 'sm')}
          <div class="mid">
            <div class="t1"><b>${esc(userLabel(u))}</b></div>
            <div class="t2">Wants to connect${u.username ? ' · @' + esc(u.username) : ''}</div>
          </div>
          <div style="display:flex;gap:6px">
            <button class="btn sm ghost" data-req-no="${esc(u.uid)}">Reject</button>
            <button class="btn sm" data-req-yes="${esc(u.uid)}">Accept</button>
          </div>
        </div>
      `).join('')}
    `;
  }

  /* PEOPLE ONLINE NOW */
  html += `
    <div class="sec-title">
      <span>People Online Now</span>
      <span class="pillx ok">● ${onlinePool.length} online</span>
    </div>
  `;

  if (!onlinePool.length) {
    html += `
      <div class="empty" style="padding:32px 20px">
        <div class="big">🌐</div>
        <div style="font-weight:700;font-size:16px">No one's online right now.</div>
        <div style="color:var(--kr-mut);font-size:13.5px;max-width:280px;margin-top:-4px">
          Users show up here when they are actively signed in. Search directly or share your invite link!
        </div>
        <div style="display:flex;gap:10px;margin-top:8px">
          <button class="btn sm" id="btn-empty-find">Find by @username</button>
          <button class="btn sm ghost" id="btn-empty-invite">Invite friends</button>
        </div>
      </div>
    `;
  } else {
    html += onlinePool.slice(0, 50).map(u => {
      const p = privacyOf(u);
      const showCountry = p.showCountry !== false && u.country;
      return `
        <div class="user-card" style="margin:0 14px 8px" data-person="${esc(u.uid)}">
          <div class="presence on">${getAvatarHTML(u, '')}</div>
          <div class="mid" style="cursor:pointer" data-view-profile="${esc(u.uid)}">
            <div class="t1">
              <b>${esc(userLabel(u))}</b>
              ${showCountry ? `<span class="pillx" style="font-size:10.5px">${esc(u.country)}</span>` : ''}
            </div>
            <div class="t2">${esc(handleFrom(u))}${u.bio ? ' · ' + esc(u.bio) : ''}</div>
          </div>
          <button class="btn sm" data-connect="${esc(u.uid)}">Connect</button>
        </div>
      `;
    }).join('');
  }

  /* YOUR CONTACTS */
  if (filteredContacts.length) {
    html += `
      <div class="sec-title" style="margin-top:14px">
        <span>Contacts (${filteredContacts.length})</span>
      </div>
      ${filteredContacts.map(u => {
        const isOnline = isUserOnlineNow(u);
        return `
          <div class="row" data-open-chat="${esc(u.uid)}">
            <div class="presence ${isOnline ? 'on' : ''}">${getAvatarHTML(u)}</div>
            <div class="mid">
              <div class="t1">
                <b>${esc(userLabel(u))}</b>
                ${isOnline ? '<span class="pillx ok">online</span>' : ''}
              </div>
              <div class="t2">${esc(handleFrom(u) || u.bio || 'Tap to message')}</div>
            </div>
            <button class="btn sm ghost" data-open-chat="${esc(u.uid)}">Message</button>
          </div>
        `;
      }).join('')}
    `;
  }

  box.innerHTML = html;

  /* Event Handlers */
  if (s('btn-find-un')) s('btn-find-un').onclick = openFindUser;
  if (s('btn-invite')) s('btn-invite').onclick = openInvite;
  if (s('btn-empty-find')) s('btn-empty-find').onclick = openFindUser;
  if (s('btn-empty-invite')) s('btn-empty-invite').onclick = openInvite;

  $$('[data-view-profile]', box).forEach(el => {
    el.onclick = () => openProfile(el.dataset.viewProfile);
  });
  $$('[data-connect]', box).forEach(b => {
    b.onclick = () => sendFriendRequest(b.dataset.connect);
  });
  $$('[data-open-chat]', box).forEach(el => {
    el.onclick = () => attemptOpenChat(el.dataset.openChat);
  });
  $$('[data-req-yes]', box).forEach(b => {
    b.onclick = () => handleRequest(b.dataset.reqYes, true);
  });
  $$('[data-req-no]', box).forEach(b => {
    b.onclick = () => handleRequest(b.dataset.reqNo, false);
  });
}

/* ============================ CONNECTION REQUEST FLOW ============================
   Connect → Pending → Accept → Contact
   Acceptance is atomic and idempotent.
   ================================================================================== */
function sendFriendRequest(uid) {
  if (uid === ST.me.uid) { toast("That's you."); return; }
  if (ST.me.contacts && ST.me.contacts[uid]) { toast('You are already connected.'); return; }
  
  const ref = db.ref('requests/' + uid + '/' + ST.me.uid);
  ref.set({
    type: 'in',
    timestamp: now(),
    senderName: userLabel(ST.me),
    senderUsername: ST.me.username || ''
  }).then(() => {
    toast('Connection request sent');
    renderPeople();
  }).catch(() => toast('Could not send request — check your connection.'));
}

function handleRequest(uid, accept) {
  if (!uid || !ST.me) return;
  const updates = {};
  updates['requests/' + ST.me.uid + '/' + uid] = null;
  updates['requests/' + uid + '/' + ST.me.uid] = null;

  if (accept) {
    updates['users/' + ST.me.uid + '/contacts/' + uid] = true;
    updates['users/' + uid + '/contacts/' + ST.me.uid] = true;
  }

  db.ref().update(updates).then(() => {
    if (accept) {
      ST.me.contacts = ST.me.contacts || {};
      ST.me.contacts[uid] = true;
      if (ST.users[uid]) {
        ST.users[uid].contacts = ST.users[uid].contacts || {};
        ST.users[uid].contacts[ST.me.uid] = true;
      }
      /* Subscribe to their status engine stream */
      StatusEngine.subscribeUser(uid);
      toast('Connected! You can chat now.');
    } else {
      toast('Request declined.');
    }
    delete (ST.requests || {})[uid];
    refreshBadges();
    renderPeople();
    renderChats();

    if (Nav.isOpen('ov-modal')) {
      const rest = Object.keys(ST.requests || {}).filter(u => ST.requests[u] && ST.requests[u].type === 'in');
      if (rest.length) paintRequests(); else Nav.close('ov-modal');
    }
  }).catch(() => toast('Could not process request — try again.'));
}
