/* ==========================================================================
   KLYRO PROFILE & ACCOUNT MANAGER ENGINE
   Complete Profile Section, Multi-Account Switching, & Secure Logout
   ========================================================================== */

/**
 * SessionVault
 * Secure persistent session token storage.
 * Stores cryptographically issued Firebase refresh tokens in local persistent storage.
 * NEVER stores plaintext passwords in localStorage, IndexedDB, or memory.
 */
const SessionVault = {
  /** Retrieves the active Firebase session object from IndexedDB or localStorage */
  getStoredFirebaseSession() {
    return new Promise(resolve => {
      try {
        const key = `firebase:authUser:${firebaseConfig.apiKey}:[DEFAULT]`;
        if (typeof indexedDB === 'undefined') {
          const raw = localStorage.getItem(key);
          return resolve(raw ? JSON.parse(raw) : null);
        }

        const req = indexedDB.open('firebaseLocalStorageDb');
        req.onsuccess = () => {
          const idb = req.result;
          if (!idb.objectStoreNames.contains('firebaseLocalStorage')) {
            const raw = localStorage.getItem(key);
            return resolve(raw ? JSON.parse(raw) : null);
          }
          const tx = idb.transaction('firebaseLocalStorage', 'readonly');
          const store = tx.objectStore('firebaseLocalStorage');
          const getReq = store.get(key);
          getReq.onsuccess = () => {
            if (getReq.result) resolve(getReq.result);
            else {
              const raw = localStorage.getItem(key);
              resolve(raw ? JSON.parse(raw) : null);
            }
          };
          getReq.onerror = () => {
            const raw = localStorage.getItem(key);
            resolve(raw ? JSON.parse(raw) : null);
          };
        };
        req.onerror = () => {
          const raw = localStorage.getItem(key);
          resolve(raw ? JSON.parse(raw) : null);
        };
      } catch (e) {
        resolve(null);
      }
    });
  },

  /** Writes a session object into IndexedDB and localStorage for [DEFAULT] */
  putStoredFirebaseSession(sessionRecord) {
    return new Promise(resolve => {
      try {
        if (!sessionRecord) return resolve(false);
        const key = `firebase:authUser:${firebaseConfig.apiKey}:[DEFAULT]`;

        let payload = sessionRecord;
        if (payload.fbase_key) payload.fbase_key = key;
        if (payload.value) {
          payload.value.appName = '[DEFAULT]';
          try { localStorage.setItem(key, JSON.stringify(payload.value)); } catch (e) {}
        } else {
          try { localStorage.setItem(key, JSON.stringify(payload)); } catch (e) {}
        }

        if (typeof indexedDB === 'undefined') return resolve(true);

        const req = indexedDB.open('firebaseLocalStorageDb');
        req.onsuccess = () => {
          const idb = req.result;
          if (!idb.objectStoreNames.contains('firebaseLocalStorage')) return resolve(true);
          const tx = idb.transaction('firebaseLocalStorage', 'readwrite');
          const store = tx.objectStore('firebaseLocalStorage');
          const putReq = store.put(payload);
          putReq.onsuccess = () => resolve(true);
          putReq.onerror = () => resolve(false);
        };
        req.onerror = () => resolve(false);
      } catch (e) {
        resolve(false);
      }
    });
  },

  /** Save active account's token session locally under its uid */
  async backup(uid) {
    if (!uid) return;
    try {
      const sess = await this.getStoredFirebaseSession();
      if (sess) {
        localStorage.setItem('klyro_session_' + uid, JSON.stringify(sess));
      }
    } catch (e) {}
  },

  /** Restores target account's token session into [DEFAULT] */
  async restore(uid) {
    if (!uid) return false;
    try {
      const raw = localStorage.getItem('klyro_session_' + uid);
      if (!raw) return false;
      const sess = JSON.parse(raw);
      await this.putStoredFirebaseSession(sess);
      return true;
    } catch (e) {
      return false;
    }
  },

  /** Clear session for removed account */
  remove(uid) {
    try {
      localStorage.removeItem('klyro_session_' + uid);
    } catch (e) {}
  }
};

const AccountManager = {
  STORAGE_KEY: 'klyro_saved_accounts',

  /** Get all remembered accounts from local storage */
  getSavedAccounts() {
    try {
      const data = localStorage.getItem(this.STORAGE_KEY);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      return [];
    }
  },

  /** Save or update the active account in remembered accounts list */
  saveActive(me) {
    if (!me || !me.uid) return;
    try {
      const list = this.getSavedAccounts();
      const existingIdx = list.findIndex(a => a.uid === me.uid);
      const acc = {
        uid: me.uid,
        email: me.email || '',
        name: me.name || me.username || 'User',
        username: me.username || '',
        photo: me.photo || '',
        bio: me.bio || '',
        lastActive: now()
      };

      if (existingIdx >= 0) {
        list[existingIdx] = Object.assign(list[existingIdx], acc);
      } else {
        list.push(acc);
      }
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(list));
      // Asynchronously backup session token without passwords
      SessionVault.backup(me.uid);
    } catch (e) {
      console.warn('[KLYRO] Could not save account to storage:', e);
    }
  },

  /** Remove a saved account from this device */
  removeAccount(uid) {
    try {
      let list = this.getSavedAccounts();
      list = list.filter(a => a.uid !== uid);
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(list));
      SessionVault.remove(uid);
      toast('Account removed from this device');
      if (typeof renderProfileSection === 'function') renderProfileSection();
      this.renderSavedAccountsOnLogin();
    } catch (e) {
      console.warn('[KLYRO] Could not remove account:', e);
    }
  },

  /** Switch to another remembered account without re-entering password */
  async switchToAccount(targetUid) {
    const list = this.getSavedAccounts();
    const target = list.find(a => a.uid === targetUid);
    if (!target) return;

    if (ST.me && ST.me.uid === targetUid) {
      toast('Already signed in as ' + (target.name || target.username));
      return;
    }

    // Save current active account first
    if (ST.me) {
      this.saveActive(ST.me);
      await SessionVault.backup(ST.me.uid);
    }

    confirmSheet(
      'Switch Account',
      `Switch to ${esc(target.name || target.username)}?`,
      'Switch Now',
      async () => {
        Nav.closeAllOverlays();
        toast('Switching account…');

        // Gracefully clean up active session presence and listeners
        try {
          if (ST.me && ST.me.uid) {
            await db.ref('users/' + ST.me.uid + '/online').set(false).catch(() => {});
            await db.ref('users/' + ST.me.uid + '/lastSeen').set(now()).catch(() => {});
          }
        } catch (e) {}

        Calls.end(true);
        if (ST.mediaRec) Voice.cancel();
        unlistenAll();
        StatusEngine.teardown();
        if (typeof PostsEngine !== 'undefined') PostsEngine.teardown();

        ST.me = null;
        ST.chat = null;
        ST.chats = {};
        ST.unread = {};

        // Attempt instant token session restore without password
        const hasSession = await SessionVault.restore(targetUid);

        if (hasSession) {
          // Show sleek loading transition and reboot with complete isolation
          toast(`Switching to ${target.name}…`);
          setTimeout(() => {
            window.location.reload();
          }, 350);
          return;
        }

        // Fallback: If session token is not present or expired, prompt to re-authenticate
        try { await auth.signOut(); } catch (e) {}
        AuthState.set(AuthState.SIGNED_OUT);

        setTimeout(() => {
          const emailInp = s('login-email');
          const passInp = s('login-password');
          if (emailInp) {
            emailInp.value = target.email || '';
            if (passInp) passInp.focus();
          }
          toast(`Please re-authenticate for ${target.name || target.email}`);
          this.renderSavedAccountsOnLogin();
        }, 300);
      }
    );
  },

  /** Add or sign in to another account */
  async addAnotherAccount() {
    if (ST.me) {
      this.saveActive(ST.me);
      await SessionVault.backup(ST.me.uid);
    }

    confirmSheet(
      'Add Another Account',
      'Sign into or create a secondary account. Your current account will stay saved on this device so you can switch back anytime without re-entering your password.',
      'Continue',
      async () => {
        Nav.closeAllOverlays();

        try {
          if (ST.me && ST.me.uid) {
            await db.ref('users/' + ST.me.uid + '/online').set(false).catch(() => {});
            await db.ref('users/' + ST.me.uid + '/lastSeen').set(now()).catch(() => {});
          }
        } catch (e) {}

        Calls.end(true);
        if (ST.mediaRec) Voice.cancel();
        unlistenAll();
        StatusEngine.teardown();
        if (typeof PostsEngine !== 'undefined') PostsEngine.teardown();

        ST.me = null;
        ST.chat = null;

        try { await auth.signOut(); } catch (e) {}

        AuthState.set(AuthState.SIGNED_OUT);

        setTimeout(() => {
          const emailInp = s('login-email');
          const passInp = s('login-password');
          if (emailInp) emailInp.value = '';
          if (passInp) passInp.value = '';
          toast('Enter credentials for your new account');
          this.renderSavedAccountsOnLogin();
        }, 300);
      }
    );
  },

  /** Renders quick account picker chips on the login screen */
  renderSavedAccountsOnLogin() {
    const container = s('login-saved-accounts');
    if (!container) return;

    const list = this.getSavedAccounts();
    if (!list || list.length === 0) {
      container.innerHTML = '';
      container.style.display = 'none';
      return;
    }

    container.style.display = 'block';
    container.innerHTML = `
      <div style="margin-bottom:16px;background:var(--kr-bg2);border:1px solid var(--kr-line);border-radius:16px;padding:12px 14px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
          <span style="font-size:12px;font-weight:700;color:var(--kr-mut);text-transform:uppercase;letter-spacing:0.4px">Accounts on this device</span>
          <span style="font-size:11px;color:var(--kr-brand);font-weight:600">${list.length} saved</span>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px">
          ${list.map(acc => `
            <div style="display:flex;align-items:center;justify-content:space-between;background:var(--kr-elev);border:1px solid var(--kr-line2);border-radius:12px;padding:8px 10px;cursor:pointer" onclick="AccountManager.selectSavedAccount('${esc(acc.uid)}')">
              <div style="display:flex;align-items:center;gap:10px;min-width:0">
                ${safeMedia(acc.photo) ? `<img src="${esc(safeMedia(acc.photo))}" style="width:34px;height:34px;border-radius:50%;object-fit:cover" alt="">` : `<div style="width:34px;height:34px;border-radius:50%;background:linear-gradient(135deg,#2563EB,#7C3AED);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px">${esc(initials(acc.name))}</div>`}
                <div style="min-width:0;overflow:hidden">
                  <div style="font-size:13.5px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(acc.name)}</div>
                  <div style="font-size:11.5px;color:var(--kr-mut);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(acc.email || ('@' + acc.username))}</div>
                </div>
              </div>
              <button type="button" class="btn sm ghost" style="height:28px;font-size:12px;padding:0 8px;color:var(--kr-brand)" onclick="event.stopPropagation();AccountManager.selectSavedAccount('${esc(acc.uid)}')">Sign In ›</button>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  },

  /** Selects a remembered account in the login form */
  selectSavedAccount(uid) {
    const list = this.getSavedAccounts();
    const acc = list.find(a => a.uid === uid);
    if (!acc) return;

    const emailInp = s('login-email');
    const passInp = s('login-password');
    if (emailInp) emailInp.value = acc.email || '';
    if (passInp) passInp.focus();
    toast(`Selected ${acc.name || acc.email} — enter password`);
  }
};

/* ============================ PROFILE SECTION RENDERER ============================ */
function renderProfileSection() {
  const container = s('profile-content');
  if (!container || !ST.me) return;

  // Make sure active account is recorded in account manager
  AccountManager.saveActive(ST.me);

  const me = ST.me;
  const savedAccounts = AccountManager.getSavedAccounts();
  const otherAccounts = savedAccounts.filter(a => a.uid !== me.uid);
  const st = settingsOf(me);
  const pr = privacyOf(me);

  // Compute live user stats
  const chatCount = Object.keys(ST.chats || {}).length;
  const friendCount = Object.values(ST.users || {}).filter(u => u && u.uid !== me.uid).length;
  const postCount = Object.values(ST.posts || {}).filter(p => p && p.authorUid === me.uid).length;

  container.innerHTML = `
    <div style="max-width:540px;margin:0 auto;padding:16px 14px 48px">

      <!-- 1. PROFILE HEADER CARD -->
      <div style="background:var(--kr-elev);border:1px solid var(--kr-line);border-radius:24px;padding:22px 18px;margin-bottom:18px;box-shadow:var(--kr-sh-1);position:relative;overflow:hidden">
        <!-- Ambient subtle background banner -->
        <div style="position:absolute;top:0;left:0;right:0;height:72px;background:linear-gradient(135deg, rgba(37,99,235,0.18), rgba(124,58,237,0.18));border-bottom:1px solid var(--kr-line2)"></div>

        <div style="position:relative;display:flex;align-items:flex-end;justify-content:space-between;margin-top:20px;margin-bottom:14px">
          <!-- Avatar with photo edit trigger -->
          <div style="position:relative;cursor:pointer" onclick="openEditProfile()">
            ${safeMedia(me.photo) ? `
              <div class="av" style="width:78px;height:78px;border:3px solid var(--kr-elev);box-shadow:var(--kr-sh-2);border-radius:50%;overflow:hidden">
                <img src="${esc(safeMedia(me.photo))}" alt="${esc(userLabel(me))}" style="width:100%;height:100%;object-fit:cover">
              </div>
            ` : getAvatarHTML(me, '', 'width:78px;height:78px;font-size:30px;border:3px solid var(--kr-elev);box-shadow:var(--kr-sh-2)')}
            <div style="position:absolute;bottom:0;right:0;background:var(--kr-brand);color:#fff;width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;border:2px solid var(--kr-elev)" title="Change Photo">
              📷
            </div>
          </div>

          <!-- Quick Action Buttons -->
          <div style="display:flex;gap:8px">
            <button class="btn sm outline" onclick="openEditProfile()" style="height:34px;padding:0 12px;border-radius:12px;font-size:12.5px;font-weight:600">
              ✏️ Edit Profile
            </button>
            <button class="btn sm" onclick="openSwitchAccountModal()" style="height:34px;padding:0 12px;border-radius:12px;font-size:12.5px;font-weight:600;background:var(--kr-brand)">
              👥 Switch Account
            </button>
          </div>
        </div>

        <!-- Name & Handle -->
        <div style="margin-bottom:8px">
          <div style="display:flex;align-items:center;gap:6px">
            <h2 style="font-size:20px;font-weight:800;letter-spacing:-0.4px;margin:0">${esc(userLabel(me))}</h2>
            <span style="color:var(--kr-brand);font-size:16px" title="Verified Member">✓</span>
          </div>
          <div style="color:var(--kr-mut);font-size:13.5px;margin-top:2px">${esc(handleFrom(me))}</div>
        </div>

        <!-- Bio / Status -->
        <div style="background:var(--kr-bg2);border-radius:14px;padding:10px 14px;margin-bottom:14px;font-size:13.5px;color:var(--kr-txt);line-height:1.45;border:1px solid var(--kr-line2)">
          ${esc(me.bio || me.statusText || 'No bio yet. Tap Edit Profile to add a status, bio, and personal details.')}
        </div>

        <!-- Meta details (Country, Email, Active Status) -->
        <div style="display:flex;flex-wrap:wrap;gap:12px;font-size:12.5px;color:var(--kr-mut)">
          <span style="display:flex;align-items:center;gap:4px">📧 ${esc(me.email || 'Email verified')}</span>
          ${me.country ? `<span style="display:flex;align-items:center;gap:4px">🌍 ${esc(me.country)}</span>` : ''}
          <span style="display:flex;align-items:center;gap:4px">🟢 Active Now</span>
        </div>
      </div>

      <!-- 2. MULTI-ACCOUNT SWITCHER CARD -->
      <div style="background:var(--kr-elev);border:1px solid var(--kr-line);border-radius:20px;padding:18px;margin-bottom:18px;box-shadow:var(--kr-sh-1)">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
          <div>
            <div style="font-size:16px;font-weight:800;display:flex;align-items:center;gap:6px">
              <span>👥 Switch Account</span>
              <span class="pillx ok" style="font-size:11px">Multi-Account</span>
            </div>
            <div style="font-size:12.5px;color:var(--kr-mut);margin-top:2px">Manage and toggle accounts on this device</div>
          </div>
          <button class="btn sm ghost" onclick="AccountManager.addAnotherAccount()" style="font-size:12px;height:30px;padding:0 10px;color:var(--kr-brand);font-weight:700">
            ＋ Add Account
          </button>
        </div>

        <!-- Current active account item -->
        <div style="display:flex;align-items:center;justify-content:space-between;background:var(--kr-brand-soft);border:1.5px solid var(--kr-brand);border-radius:14px;padding:10px 14px;margin-bottom:10px">
          <div style="display:flex;align-items:center;gap:12px;min-width:0">
            ${safeMedia(me.photo) ? `<img src="${esc(safeMedia(me.photo))}" style="width:38px;height:38px;border-radius:50%;object-fit:cover" alt="">` : getAvatarHTML(me, 'sm')}
            <div style="min-width:0;overflow:hidden">
              <div style="font-weight:800;font-size:14px;display:flex;align-items:center;gap:6px">
                <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(userLabel(me))}</span>
                <span style="background:var(--kr-brand);color:#fff;font-size:10px;font-weight:700;padding:2px 6px;border-radius:6px">ACTIVE</span>
              </div>
              <div style="font-size:12px;color:var(--kr-mut);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(me.email || handleFrom(me))}</div>
            </div>
          </div>
          <span style="font-size:12px;color:var(--kr-brand);font-weight:700">Current</span>
        </div>

        <!-- Other saved accounts on this device -->
        ${otherAccounts.length ? `
          <div style="display:flex;flex-direction:column;gap:8px;margin-top:10px">
            <div style="font-size:11.5px;font-weight:700;color:var(--kr-mut);text-transform:uppercase;letter-spacing:0.4px">Other Saved Accounts</div>
            ${otherAccounts.map(acc => `
              <div style="display:flex;align-items:center;justify-content:space-between;background:var(--kr-bg2);border:1px solid var(--kr-line);border-radius:14px;padding:10px 14px">
                <div style="display:flex;align-items:center;gap:12px;min-width:0">
                  ${safeMedia(acc.photo) ? `<img src="${esc(safeMedia(acc.photo))}" style="width:38px;height:38px;border-radius:50%;object-fit:cover" alt="">` : `<div style="width:38px;height:38px;border-radius:50%;background:linear-gradient(135deg,#64748B,#475569);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px">${esc(initials(acc.name))}</div>`}
                  <div style="min-width:0;overflow:hidden">
                    <div style="font-weight:750;font-size:13.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(acc.name)}</div>
                    <div style="font-size:11.5px;color:var(--kr-mut);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(acc.email || ('@' + acc.username))}</div>
                  </div>
                </div>
                <div style="display:flex;align-items:center;gap:6px">
                  <button class="btn sm" onclick="AccountManager.switchToAccount('${esc(acc.uid)}')" style="height:30px;padding:0 12px;font-size:12px;font-weight:700">
                    Switch
                  </button>
                  <button class="ib sm" onclick="AccountManager.removeAccount('${esc(acc.uid)}')" title="Remove from this device" style="color:var(--kr-mut);font-size:14px">
                    ✕
                  </button>
                </div>
              </div>
            `).join('')}
          </div>
        ` : `
          <div style="background:var(--kr-bg2);border-radius:12px;padding:10px 12px;font-size:12.5px;color:var(--kr-mut);text-align:center">
            No other accounts on this device yet. Tap <strong>＋ Add Account</strong> to connect multiple accounts!
          </div>
        `}
      </div>

      <!-- 3. ACTIVITY STATS -->
      <div style="display:grid;grid-template-columns:repeat(3, 1fr);gap:10px;margin-bottom:18px">
        <div style="background:var(--kr-elev);border:1px solid var(--kr-line);border-radius:16px;padding:14px;text-align:center">
          <div style="font-size:22px;font-weight:800;color:var(--kr-brand)">${chatCount}</div>
          <div style="font-size:12px;color:var(--kr-mut);margin-top:2px">Conversations</div>
        </div>
        <div style="background:var(--kr-elev);border:1px solid var(--kr-line);border-radius:16px;padding:14px;text-align:center">
          <div style="font-size:22px;font-weight:800;color:var(--kr-accent)">${postCount}</div>
          <div style="font-size:12px;color:var(--kr-mut);margin-top:2px">Pulse Posts</div>
        </div>
        <div style="background:var(--kr-elev);border:1px solid var(--kr-line);border-radius:16px;padding:14px;text-align:center">
          <div style="font-size:22px;font-weight:800;color:var(--kr-ok)">${friendCount}</div>
          <div style="font-size:12px;color:var(--kr-mut);margin-top:2px">Connected</div>
        </div>
      </div>

      <!-- 4. ACCOUNT SETTINGS & PREFERENCES -->
      <div style="background:var(--kr-elev);border:1px solid var(--kr-line);border-radius:20px;overflow:hidden;margin-bottom:18px;box-shadow:var(--kr-sh-1)">
        <div style="padding:14px 16px 8px;font-size:14.5px;font-weight:800">Account Preferences</div>

        <div class="row" onclick="openEditProfile()" style="cursor:pointer">
          <div class="av sm" style="background:rgba(37,99,235,0.12);color:var(--kr-brand);font-size:16px">👤</div>
          <div class="mid">
            <div class="t1"><b>Edit Profile Details</b></div>
            <div class="t2">Name, avatar, bio, and country</div>
          </div>
          <span class="pillx">›</span>
        </div>

        <div class="row" onclick="openPrivacy()" style="cursor:pointer">
          <div class="av sm" style="background:rgba(124,58,237,0.12);color:var(--kr-accent);font-size:16px">🔒</div>
          <div class="mid">
            <div class="t1"><b>Privacy &amp; Safety</b></div>
            <div class="t2">Online status, read receipts, typing indicator</div>
          </div>
          <span class="pillx">›</span>
        </div>

        <div class="row" onclick="openCredentials()" style="cursor:pointer">
          <div class="av sm" style="background:rgba(22,163,74,0.12);color:var(--kr-ok);font-size:16px">🔑</div>
          <div class="mid">
            <div class="t1"><b>Password &amp; Security</b></div>
            <div class="t2">Credentials, reset email, and protection</div>
          </div>
          <span class="pillx">›</span>
        </div>

        <div class="row" onclick="applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');renderProfileSection()" style="cursor:pointer">
          <div class="av sm" style="background:rgba(245,158,11,0.12);color:var(--kr-warn);font-size:16px">🌓</div>
          <div class="mid">
            <div class="t1"><b>Appearance &amp; Theme</b></div>
            <div class="t2">Current: <strong>${document.documentElement.getAttribute('data-theme') === 'dark' ? 'Dark Mode' : 'Light Mode'}</strong></div>
          </div>
          <span class="pillx">Toggle</span>
        </div>

        <div class="row" onclick="openGifConfigModal()" style="cursor:pointer">
          <div class="av sm" style="background:rgba(219,39,119,0.12);color:#DB2777;font-size:16px">🎞️</div>
          <div class="mid">
            <div class="t1"><b>GIFs &amp; Media Provider</b></div>
            <div class="t2">${GifEngine.provider() === 'none' ? 'Configure GIPHY API' : 'Connected · ' + GifEngine.provider()}</div>
          </div>
          <span class="pillx">›</span>
        </div>
      </div>

      <!-- 5. LOG OUT SECTION -->
      <div style="background:var(--kr-elev);border:1px solid rgba(225,29,72,0.25);border-radius:20px;padding:18px;margin-bottom:20px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
          <div style="width:36px;height:36px;border-radius:50%;background:rgba(225,29,72,0.12);color:var(--kr-danger);display:flex;align-items:center;justify-content:center;font-size:18px">
            🚪
          </div>
          <div>
            <div style="font-size:15px;font-weight:800;color:var(--kr-danger)">Log Out System</div>
            <div style="font-size:12px;color:var(--kr-mut)">Sign out of your session safely on this device</div>
          </div>
        </div>

        <p style="font-size:12.5px;color:var(--kr-mut);margin:0 0 14px">
          You can keep your account remembered on this device for rapid 1-tap switching, or log out completely.
        </p>

        <div style="display:grid;grid-template-columns:1fr;gap:8px">
          <button class="btn block danger" onclick="confirmLogoutModal()" style="height:42px;font-weight:700;font-size:14px;border-radius:12px">
            🚪 Log out of @${esc(me.username || 'user')}
          </button>
        </div>
      </div>

      <div style="text-align:center;color:var(--kr-mut);font-size:12px;padding-bottom:16px">
        KLYRO Messenger · Fast · Private · Reliable
      </div>

    </div>
  `;
}

/** Open Switch Account Modal Bottom Sheet */
function openSwitchAccountModal() {
  const list = AccountManager.getSavedAccounts();
  const me = ST.me;
  const otherAccounts = list.filter(a => !me || a.uid !== me.uid);

  openModal(`
    <div class="pad" style="max-width:440px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <h3 style="margin:0;font-size:18px;font-weight:800">Switch Account</h3>
        <button class="ib sm" onclick="Nav.close('ov-modal')">✕</button>
      </div>

      ${me ? `
        <div style="margin-bottom:12px;font-size:12px;font-weight:700;color:var(--kr-mut);text-transform:uppercase">Active Account</div>
        <div style="display:flex;align-items:center;justify-content:space-between;background:var(--kr-brand-soft);border:1.5px solid var(--kr-brand);border-radius:14px;padding:10px 12px;margin-bottom:14px">
          <div style="display:flex;align-items:center;gap:10px;min-width:0">
            ${safeMedia(me.photo) ? `<img src="${esc(safeMedia(me.photo))}" style="width:36px;height:36px;border-radius:50%;object-fit:cover" alt="">` : getAvatarHTML(me, 'sm')}
            <div style="min-width:0">
              <div style="font-weight:800;font-size:13.5px">${esc(userLabel(me))}</div>
              <div style="font-size:11.5px;color:var(--kr-mut)">${esc(me.email || handleFrom(me))}</div>
            </div>
          </div>
          <span style="font-size:11px;background:var(--kr-brand);color:#fff;font-weight:700;padding:2px 8px;border-radius:6px">ACTIVE</span>
        </div>
      ` : ''}

      <div style="margin-bottom:10px;font-size:12px;font-weight:700;color:var(--kr-mut);text-transform:uppercase">Saved Accounts</div>

      ${otherAccounts.length ? `
        <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px">
          ${otherAccounts.map(acc => `
            <div style="display:flex;align-items:center;justify-content:space-between;background:var(--kr-elev);border:1px solid var(--kr-line);border-radius:12px;padding:10px 12px;cursor:pointer" onclick="Nav.close('ov-modal');AccountManager.switchToAccount('${esc(acc.uid)}')">
              <div style="display:flex;align-items:center;gap:10px;min-width:0">
                ${safeMedia(acc.photo) ? `<img src="${esc(safeMedia(acc.photo))}" style="width:34px;height:34px;border-radius:50%;object-fit:cover" alt="">` : `<div style="width:34px;height:34px;border-radius:50%;background:linear-gradient(135deg,#64748B,#475569);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px">${esc(initials(acc.name))}</div>`}
                <div style="min-width:0">
                  <div style="font-weight:700;font-size:13px">${esc(acc.name)}</div>
                  <div style="font-size:11.5px;color:var(--kr-mut)">${esc(acc.email || ('@' + acc.username))}</div>
                </div>
              </div>
              <button class="btn sm" style="height:28px;padding:0 10px;font-size:12px">Switch</button>
            </div>
          `).join('')}
        </div>
      ` : `
        <div style="background:var(--kr-bg2);border-radius:12px;padding:14px;text-align:center;font-size:13px;color:var(--kr-mut);margin-bottom:16px">
          No other accounts saved on this device.
        </div>
      `}

      <button class="btn block" onclick="Nav.close('ov-modal');AccountManager.addAnotherAccount()" style="margin-bottom:8px">
        ＋ Add Another Account
      </button>
      <button class="btn block ghost" onclick="Nav.close('ov-modal')">
        Cancel
      </button>
    </div>
  `);
}

/** Comprehensive Logout Confirmation Sheet */
function confirmLogoutModal() {
  if (!ST.me) return;
  const username = ST.me.username || 'user';

  openModal(`
    <div class="pad" style="max-width:400px;text-align:center">
      <div style="width:52px;height:52px;border-radius:50%;background:rgba(225,29,72,0.12);color:var(--kr-danger);display:flex;align-items:center;justify-content:center;font-size:24px;margin:0 auto 14px">
        🚪
      </div>
      <h3 style="margin:0 0 8px;font-size:18px;font-weight:800">Log out of @${esc(username)}?</h3>
      <p style="color:var(--kr-mut);font-size:13.5px;margin:0 0 20px;line-height:1.4">
        You can keep your account saved on this device for 1-tap switching, or wipe it completely.
      </p>

      <button class="btn block danger" onclick="Nav.close('ov-modal');executeLogout(false)" style="margin-bottom:10px;height:42px;font-weight:700">
        Log out (Keep on this device)
      </button>
      <button class="btn block outline" onclick="Nav.close('ov-modal');executeLogout(true)" style="margin-bottom:10px;height:40px;color:var(--kr-danger);border-color:var(--kr-danger)">
        Log out &amp; Remove from device
      </button>
      <button class="btn block ghost" onclick="Nav.close('ov-modal')" style="height:38px">
        Cancel
      </button>
    </div>
  `);
}

/** Execute the actual logout */
async function executeLogout(removeFromDevice) {
  const uid = ST.me ? ST.me.uid : null;

  try {
    if (ST.me && ST.me.uid) {
      await db.ref('users/' + ST.me.uid + '/online').set(false).catch(() => {});
      await db.ref('users/' + ST.me.uid + '/lastSeen').set(now()).catch(() => {});
    }
  } catch (e) {}

  Calls.end(true);
  if (ST.mediaRec) Voice.cancel();
  unlistenAll();
  StatusEngine.teardown();
  if (typeof PostsEngine !== 'undefined') PostsEngine.teardown();

  // Reset overlays
  ['ov-onboarding', 'ov-sheet', 'ov-modal', 'ov-media', 'ov-story'].forEach(id => {
    const el = s(id);
    if (el) el.classList.remove('open');
  });

  if (removeFromDevice && uid) {
    AccountManager.removeAccount(uid);
  } else if (ST.me) {
    AccountManager.saveActive(ST.me);
  }

  ST.me = null;
  ST.chats = {};
  ST.chatMsgs = {};
  ST.unread = {};
  ST.requests = {};
  ST.chat = null;
  ST.partnerTyping = false;

  try { await auth.signOut(); } catch (e) {}
  AuthState.set(AuthState.SIGNED_OUT);
  toast('Signed out successfully');

  setTimeout(() => {
    AccountManager.renderSavedAccountsOnLogin();
  }, 200);
}
