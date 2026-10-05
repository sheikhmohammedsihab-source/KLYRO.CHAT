/* ============================ AUTH, ONBOARDING & BOOT ============================ */

/* ---------------- Auth Error Formatting ---------------- */
function friendlyAuthError(err) {
  const c = (err && err.code) || '';
  if (/invalid-email/.test(c)) return 'Please enter a valid email address.';
  if (/user-not-found/.test(c)) return 'No account found with this email. Would you like to create one?';
  if (/wrong-password|invalid-credential/.test(c)) return 'Incorrect email or password. Please try again.';
  if (/too-many-requests/.test(c)) return 'Too many failed attempts. Please wait a few moments and try again.';
  if (/email-already-in-use/.test(c)) return 'An account already exists with this email. Please sign in instead.';
  if (/weak-password/.test(c)) return 'Password must be at least 6 characters.';
  if (/network-request-failed|network/.test(c)) return 'Network error. Please check your internet connection and try again.';
  if (/operation-not-allowed/.test(c)) return 'Sign-in provider is disabled in Firebase Console.';
  if (/user-disabled/.test(c)) return 'This account has been disabled. Please contact support.';
  if (/popup-blocked/.test(c)) return 'Google sign-in popup was blocked by your browser. Please allow popups for KLYRO.';
  if (/popup-closed-by-user|cancelled/.test(c)) return 'Google sign-in was cancelled.';
  if (/unauthorized-domain/.test(c)) return 'This domain is not authorized in Firebase Console -> Authentication -> Settings -> Authorized domains.';
  return (err && err.message) ? 'Authentication error: ' + err.message.replace(/Firebase:\s*/i, '').replace(/\(auth\/.*?\)\.?/g, '').trim() : 'Authentication failed. Please try again.';
}

/* ---------------- Password Toggle ---------------- */
function wirePassToggle(btnId, inpId) {
  const btn = s(btnId), inp = s(inpId);
  if (!btn || !inp) return;
  btn.onclick = () => {
    const isPass = inp.type === 'password';
    inp.type = isPass ? 'text' : 'password';
    btn.textContent = isPass ? '🔒' : '👁️';
  };
}

/* ---------------- Username Registry ---------------- */
function validateUsername(un) {
  const v = String(un || '').replace(/^@/, '').trim().toLowerCase();
  if (v.length < 3) return { ok: false, msg: 'Username must be at least 3 characters.' };
  if (v.length > 20) return { ok: false, msg: 'Username cannot exceed 20 characters.' };
  if (!/^[a-z0-9._]+$/.test(v)) return { ok: false, msg: 'Use lowercase letters, numbers, _ and . only.' };
  if (/^[._]|[._]$/.test(v)) return { ok: false, msg: 'Username cannot start or end with . or _' };
  if (/\.\.|__|\._|_\./.test(v)) return { ok: false, msg: 'Cannot contain consecutive special characters.' };
  if (RESERVED.indexOf(v) >= 0) return { ok: false, msg: 'That username is reserved.' };
  return { ok: true, value: v, msg: '@' + v + ' is valid' };
}

function lookupUsername(un) {
  const v = String(un || '').replace(/^@/, '').trim().toLowerCase();
  if (!v) return Promise.resolve(null);
  return db.ref('usernames/' + v).once('value').then(sn => sn.val() ? { uid: sn.val(), username: v } : null).catch(() => null);
}

function claimUsername(un, uid) {
  return db.ref('usernames/' + un).transaction(cur => (cur === null || cur === uid) ? uid : undefined)
    .then(r => !!r.committed);
}

function releaseUsername(un, uid) {
  return db.ref('usernames/' + un).transaction(cur => cur === uid ? null : undefined).catch(() => {});
}

/* ---------------- Wire Auth ---------------- */
function wireAuth() {
  wirePassToggle('btn-toggle-login-pass', 'login-password');
  wirePassToggle('btn-toggle-signup-pass', 'signup-password');

  /* LOGIN FORM */
  const lf = s('login-form');
  if (lf) {
    lf.onsubmit = async e => {
      e.preventDefault();
      if (AuthState.current === AuthState.AUTHENTICATING) return;

      const email = (s('login-email').value || '').trim().toLowerCase();
      const pass = s('login-password').value || '';
      const errEl = s('login-err');
      const submitBtn = s('btn-login-submit');

      if (!email) { errEl.textContent = 'Please enter your email.'; return; }
      if (!pass) { errEl.textContent = 'Please enter your password.'; return; }

      errEl.textContent = '';
      submitBtn.disabled = true;
      submitBtn.textContent = 'Signing in…';
      AuthState.set(AuthState.AUTHENTICATING);

      try {
        await auth.signInWithEmailAndPassword(email, pass);
      } catch (err) {
        AuthState.set(AuthState.SIGNED_OUT);
        errEl.textContent = friendlyAuthError(err);
        submitBtn.disabled = false;
        submitBtn.textContent = 'Sign in';
      }
    };
  }

  /* SIGNUP FORM */
  const sf = s('signup-form');
  if (sf) {
    sf.onsubmit = e => {
      e.preventDefault();
      doTransactionalSignup();
    };
  }

  /* Username live availability hint */
  const un = s('signup-username'), hint = s('username-hint');
  if (un && hint) {
    un.addEventListener('input', () => {
      const r = validateUsername(un.value);
      hint.style.color = r.ok ? 'var(--kr-ok)' : 'var(--kr-mut)';
      hint.textContent = r.msg;
      clearTimeout(un._t);
      if (r.ok) {
        un._t = setTimeout(() => {
          lookupUsername(r.value).then(hit => {
            hint.style.color = hit ? 'var(--kr-danger)' : 'var(--kr-ok)';
            hint.textContent = hit ? '@' + r.value + ' is already taken' : '@' + r.value + ' is available';
          });
        }, 380);
      }
    });
  }

  /* Country dropdown */
  const cs = s('signup-country');
  if (cs) {
    cs.innerHTML = '<option value="">Select country (optional)…</option>' + COUNTRIES.map(c => '<option value="' + esc(c) + '">' + esc(c) + '</option>').join('');
  }

  if (s('go-signup')) s('go-signup').onclick = () => switchAuth('signup');
  if (s('go-login')) s('go-login').onclick = () => switchAuth('login');
  if (s('btn-google')) s('btn-google').onclick = googleSignIn;
  if (s('btn-forgot')) s('btn-forgot').onclick = forgotPassword;
}

function switchAuth(which) {
  const l = s('login-form'), su = s('signup-form'), p = s('setup-panel');
  if (l) l.style.display = which === 'login' ? 'block' : 'none';
  if (su) su.style.display = which === 'signup' ? 'block' : 'none';
  if (p) p.style.display = which === 'setup' ? 'block' : 'none';
}

/* ---------------- Transactional / Rollback-Safe Signup ---------------- */
async function doTransactionalSignup() {
  if (AuthState.current === AuthState.AUTHENTICATING) return;
  const errEl = s('signup-err');
  const btn = s('btn-signup-submit');

  const unRaw = validateUsername(s('signup-username').value);
  const name = (s('signup-name').value || '').trim();
  const email = (s('signup-email').value || '').trim().toLowerCase();
  const pass = s('signup-password').value || '';
  const country = s('signup-country').value || '';
  const bio = (s('signup-bio').value || '').trim().slice(0, 160);

  if (!unRaw.ok) { errEl.textContent = unRaw.msg; return; }
  if (!name) { errEl.textContent = 'Please enter your display name.'; return; }
  if (!email) { errEl.textContent = 'Please enter a valid email address.'; return; }
  if (pass.length < 6) { errEl.textContent = 'Password must be at least 6 characters.'; return; }

  errEl.textContent = '';
  btn.disabled = true;
  btn.textContent = 'Creating account…';
  AuthState.set(AuthState.AUTHENTICATING);

  try {
    /* 1. Pre-check username availability */
    const existing = await lookupUsername(unRaw.value);
    if (existing) {
      errEl.textContent = '@' + unRaw.value + ' is already taken. Please choose another.';
      btn.disabled = false; btn.textContent = 'Create account';
      AuthState.set(AuthState.SIGNED_OUT);
      return;
    }

    /* 2. Create Auth Account */
    const cred = await auth.createUserWithEmailAndPassword(email, pass);
    const uid = cred.user.uid;

    /* 3. Atomically Claim Username */
    const claimed = await claimUsername(unRaw.value, uid);
    if (!claimed) {
      /* If username was claimed at the same exact second, route to profile setup without throwing an error */
      errEl.textContent = 'That username was claimed just now. Please finish setting up your username.';
      AuthState.set(AuthState.PROFILE_INCOMPLETE);
      return;
    }

    /* 4. Write User Profile & Public Profile Projection */
    const profile = {
      uid: uid,
      name: name,
      username: unRaw.value,
      email: email,
      bio: bio,
      country: country,
      color: colorFor(uid),
      createdAt: now(),
      status: 'online',
      lastSeen: now(),
      onboardingComplete: false, // Triggers guided first-run onboarding
      privacy: DEFAULT_PRIVACY,
      settings: DEFAULT_SETTINGS
    };

    const publicProfile = {
      uid: uid,
      name: name,
      username: unRaw.value,
      bio: bio,
      country: country,
      color: profile.color,
      createdAt: profile.createdAt,
      status: 'online',
      lastSeen: profile.lastSeen,
      discoverable: true
    };

    const updates = {};
    updates['users/' + uid] = profile;
    updates['publicProfiles/' + uid] = publicProfile;

    await db.ref().update(updates);
    errEl.textContent = '';
    /* OnAuthStateChanged will pick up the user and trigger onboarding */
  } catch (err) {
    btn.disabled = false;
    btn.textContent = 'Create account';
    AuthState.set(AuthState.SIGNED_OUT);
    errEl.textContent = friendlyAuthError(err);
  }
}

/* ---------------- Google Sign-In ---------------- */
async function googleSignIn() {
  const provider = new firebase.auth.GoogleAuthProvider();
  try {
    AuthState.set(AuthState.AUTHENTICATING);
    await auth.signInWithPopup(provider);
  } catch (e) {
    AuthState.set(AuthState.SIGNED_OUT);
    toast(friendlyAuthError(e), 4500);
  }
}

/* ---------------- Forgot Password ---------------- */
async function forgotPassword() {
  const email = (s('login-email').value || '').trim();
  if (!email) {
    s('login-err').textContent = 'Enter your email address above, then tap forgot password.';
    return;
  }
  try {
    await auth.sendPasswordResetEmail(email);
    s('login-err').textContent = '';
    toast('Password reset link sent to ' + email, 4000);
  } catch (e) {
    s('login-err').textContent = friendlyAuthError(e);
  }
}

/* ---------------- Profile Incomplete / Setup Panel ---------------- */
function showSetupProfile() {
  switchAuth('setup');
  Nav.go('auth', null, { replace: true, force: true });

  const un = s('setup-username'), hint = s('setup-hint');
  if (un && !un._wired) {
    un._wired = true;
    un.addEventListener('input', () => {
      const r = validateUsername(un.value);
      hint.style.color = r.ok ? 'var(--kr-ok)' : 'var(--kr-mut)';
      hint.textContent = r.msg;
      clearTimeout(un._t);
      if (r.ok) {
        un._t = setTimeout(() => {
          lookupUsername(r.value).then(hit => {
            hint.style.color = hit ? 'var(--kr-danger)' : 'var(--kr-ok)';
            hint.textContent = hit ? '@' + r.value + ' is already taken' : '@' + r.value + ' is available';
          });
        }, 380);
      }
    });
  }

  const pic = s('setup-avatar'), inp = s('setup-pic');
  if (pic && inp && !pic._wired) {
    pic._wired = true;
    pic.onclick = () => { inp.value = ''; inp.click(); };
    inp.onchange = async () => {
      const f = inp.files && inp.files[0]; if (!f) return;
      await handleAvatarPick(f, 'setup-avatar', b64 => { ST._setupPic = b64; });
    };
  }

  const save = s('setup-save');
  if (save && !save._wired) {
    save._wired = true;
    save.onclick = async () => {
      const errEl = s('setup-err');
      const unVal = validateUsername(s('setup-username').value);
      const name = (s('setup-name').value || '').trim() || (ST.me && ST.me.name) || 'KLYRO User';

      if (!unVal.ok) { errEl.textContent = unVal.msg; return; }
      save.disabled = true;
      save.textContent = 'Saving…';
      errEl.textContent = '';

      try {
        const ok = await claimUsername(unVal.value, ST.me.uid);
        if (!ok) {
          errEl.textContent = 'That username was just taken. Please choose another.';
          save.disabled = false;
          save.textContent = 'Enter KLYRO';
          return;
        }

        const profilePatch = {
          uid: ST.me.uid,
          name: name,
          username: unVal.value,
          email: ST.me.email || '',
          color: colorFor(ST.me.uid),
          status: 'online',
          lastSeen: now(),
          onboardingComplete: false,
          privacy: DEFAULT_PRIVACY,
          settings: DEFAULT_SETTINGS
        };
        if (ST._setupPic) profilePatch.photo = ST._setupPic;

        const publicPatch = {
          uid: ST.me.uid,
          name: name,
          username: unVal.value,
          color: profilePatch.color,
          status: 'online',
          lastSeen: profilePatch.lastSeen,
          discoverable: true
        };
        if (ST._setupPic) publicPatch.photo = ST._setupPic;

        const updates = {};
        updates['users/' + ST.me.uid] = profilePatch;
        updates['publicProfiles/' + ST.me.uid] = publicPatch;

        await db.ref().update(updates);
        errEl.textContent = '';
      } catch (e) {
        errEl.textContent = 'Could not save profile — please retry.';
      }
      save.disabled = false;
      save.textContent = 'Enter KLYRO';
    };
  }
}

/* ---------------- Avatar Picking with Compression ---------------- */
async function handleAvatarPick(file, boxId, done) {
  const box = s(boxId);
  try {
    const out = await compressImage(file, 320, 0.75, 80000);
    const b64 = await blobToDataURL(out.blob);
    if (b64.length > 130000) throw new Error('too-big');
    if (box) box.innerHTML = '<img src="' + esc(b64) + '" style="width:100%;height:100%;object-fit:cover" alt="">';
    if (done) done(b64);
  } catch (e) {
    toast('Could not use that picture — try a simpler or smaller photo.');
  }
}

/* ============================ FIRST-RUN ONBOARDING FLOW ============================
   A polished 7-step onboarding flow:
   1. Welcome to KLYRO
   2. Choose profile photo
   3. Choose unique username
   4. Confirm display name
   5. Optional short bio
   6. Discover people online now
   7. Finish ("Get Started")
   Persists onboardingComplete: true so it is never shown again.
   ================================================================================== */
function showFirstRunOnboarding() {
  const card = s('onboarding-card');
  if (!card) return;

  let currentStep = 1;
  const totalSteps = 7;
  let tempPhoto = ST.me.photo || '';
  let tempUsername = ST.me.username || '';
  let tempName = ST.me.name || '';
  let tempBio = ST.me.bio || '';
  let tempCountry = ST.me.country || '';

  function renderStep() {
    const dots = Array.from({ length: totalSteps }, (_, i) => `
      <div class="ob-dot ${i + 1 === currentStep ? 'active' : ''}"></div>
    `).join('');

    let content = `<div class="ob-dots">${dots}</div>`;

    if (currentStep === 1) {
      content += `
        <div style="text-align:center;padding:12px 0">
          <div class="brand-mark" style="width:58px;height:58px;border-radius:18px;font-size:28px;margin:0 auto 16px">K</div>
          <h2 style="margin:0 0 6px;font-size:22px;font-weight:800">Welcome to KLYRO</h2>
          <p style="color:var(--kr-mut);font-size:14px;line-height:1.5;margin:0 0 20px">
            Fast, private, modern messaging designed for real human connection.
          </p>
          <button class="btn block" id="ob-next">Get Started</button>
        </div>
      `;
    } else if (currentStep === 2) {
      content += `
        <h3 style="margin:0 0 4px">Choose a profile photo</h3>
        <p style="color:var(--kr-mut);font-size:13.5px;margin:0 0 16px">Add a photo so your contacts can recognize you.</p>
        <div style="display:flex;justify-content:center;margin-bottom:16px">
          <div class="av lg" id="ob-avatar" style="cursor:pointer;background:var(--kr-brand);box-shadow:var(--kr-sh-2)">
            ${tempPhoto ? `<img src="${esc(tempPhoto)}" alt="">` : (tempName ? esc(initials(tempName)) : '＋')}
          </div>
        </div>
        <input type="file" id="ob-pic-input" accept="image/*" hidden>
        <button class="btn block outline" id="ob-pick-btn" style="margin-bottom:8px">Select Photo</button>
        <button class="btn block" id="ob-next">Continue</button>
        <button class="btn block ghost" id="ob-skip" style="margin-top:8px">Skip for now</button>
      `;
    } else if (currentStep === 3) {
      content += `
        <h3 style="margin:0 0 4px">Choose your @username</h3>
        <p style="color:var(--kr-mut);font-size:13.5px;margin:0 0 14px">Your unique handle for finding friends on KLYRO.</p>
        <div class="field">
          <label>Username</label>
          <input id="ob-un-in" class="inp" value="${esc(tempUsername)}" placeholder="username" maxlength="20">
        </div>
        <div id="ob-un-hint" style="font-size:12.5px;color:var(--kr-mut);margin:-6px 0 14px">Letters, numbers, _ and .</div>
        <div class="err" id="ob-un-err"></div>
        <button class="btn block" id="ob-next">Continue</button>
      `;
    } else if (currentStep === 4) {
      content += `
        <h3 style="margin:0 0 4px">Confirm your display name</h3>
        <p style="color:var(--kr-mut);font-size:13.5px;margin:0 0 14px">This name appears in chats and conversations.</p>
        <div class="field">
          <label>Display Name</label>
          <input id="ob-name-in" class="inp" value="${esc(tempName)}" placeholder="Your full or preferred name" maxlength="40">
        </div>
        <div class="err" id="ob-name-err"></div>
        <button class="btn block" id="ob-next">Continue</button>
      `;
    } else if (currentStep === 5) {
      content += `
        <h3 style="margin:0 0 4px">Add bio &amp; country</h3>
        <p style="color:var(--kr-mut);font-size:13.5px;margin:0 0 14px">Optional details shown on your public profile.</p>
        <div class="field">
          <label>Short Bio</label>
          <textarea id="ob-bio-in" class="inp" placeholder="A line about what you do or love" maxlength="160">${esc(tempBio)}</textarea>
        </div>
        <div class="field">
          <label>Country</label>
          <select id="ob-country-in" class="inp">
            <option value="">Select country…</option>
            ${COUNTRIES.map(c => `<option value="${esc(c)}" ${tempCountry === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
          </select>
        </div>
        <button class="btn block" id="ob-next">Continue</button>
      `;
    } else if (currentStep === 6) {
      const onlinePool = getOnlineDiscoverPool().slice(0, 3);
      content += `
        <h3 style="margin:0 0 4px">Connect with people online</h3>
        <p style="color:var(--kr-mut);font-size:13.5px;margin:0 0 14px">Discover shows users actively online right now.</p>
        <div style="margin-bottom:16px">
          ${onlinePool.length ? onlinePool.map(u => `
            <div class="user-card" style="padding:8px 10px;margin-bottom:6px">
              ${getAvatarHTML(u, 'sm')}
              <div class="mid"><div class="t1"><b>${esc(userLabel(u))}</b></div><div class="t2">${esc(handleFrom(u))}</div></div>
              <span class="pillx ok" style="font-size:10px">online</span>
            </div>
          `).join('') : `
            <div class="empty" style="padding:16px"><div style="font-size:24px">🌐</div><div>You're one of the first online today!</div></div>
          `}
        </div>
        <button class="btn block" id="ob-next">Next</button>
      `;
    } else if (currentStep === 7) {
      content += `
        <div style="text-align:center;padding:12px 0">
          <div style="font-size:48px;margin-bottom:10px">🎉</div>
          <h2 style="margin:0 0 6px;font-size:22px;font-weight:800">You're All Set!</h2>
          <p style="color:var(--kr-mut);font-size:14px;line-height:1.5;margin:0 0 20px">
            Welcome to KLYRO. Enjoy fast, private, real-time messaging, live status updates, and crystal-clear calls.
          </p>
          <button class="btn block" id="ob-finish">Enter KLYRO</button>
        </div>
      `;
    }

    card.innerHTML = content;

    /* Wire step actions */
    if (s('ob-pick-btn')) s('ob-pick-btn').onclick = () => s('ob-pic-input').click();
    if (s('ob-avatar')) s('ob-avatar').onclick = () => s('ob-pic-input').click();
    if (s('ob-pic-input')) {
      s('ob-pic-input').onchange = async () => {
        const f = s('ob-pic-input').files && s('ob-pic-input').files[0];
        if (f) await handleAvatarPick(f, 'ob-avatar', b64 => { tempPhoto = b64; });
      };
    }

    if (s('ob-skip')) s('ob-skip').onclick = () => { currentStep++; renderStep(); };

    if (s('ob-next')) {
      s('ob-next').onclick = async () => {
        if (currentStep === 3) {
          const r = validateUsername(s('ob-un-in').value);
          if (!r.ok) { s('ob-un-err').textContent = r.msg; return; }
          if (r.value !== ST.me.username) {
            const taken = await lookupUsername(r.value);
            if (taken) { s('ob-un-err').textContent = '@' + r.value + ' is taken.'; return; }
            await releaseUsername(ST.me.username, ST.me.uid);
            await claimUsername(r.value, ST.me.uid);
            tempUsername = r.value;
          }
        } else if (currentStep === 4) {
          const nm = (s('ob-name-in').value || '').trim();
          if (!nm) { s('ob-name-err').textContent = 'Please provide a display name.'; return; }
          tempName = nm;
        } else if (currentStep === 5) {
          tempBio = s('ob-bio-in').value.trim().slice(0, 160);
          tempCountry = s('ob-country-in').value;
        }

        currentStep++;
        renderStep();
      };
    }

    if (s('ob-finish')) {
      s('ob-finish').onclick = async () => {
        const btn = s('ob-finish');
        btn.disabled = true;
        btn.textContent = 'Saving profile…';

        const profilePatch = {
          name: tempName || ST.me.name || 'KLYRO User',
          username: tempUsername || ST.me.username,
          bio: tempBio,
          country: tempCountry,
          onboardingComplete: true
        };
        if (tempPhoto) profilePatch.photo = tempPhoto;

        const publicPatch = {
          uid: ST.me.uid,
          name: profilePatch.name,
          username: profilePatch.username,
          bio: tempBio,
          country: tempCountry,
          discoverable: true,
          status: 'online',
          lastSeen: now()
        };
        if (tempPhoto) publicPatch.photo = tempPhoto;

        const updates = {};
        updates['users/' + ST.me.uid] = Object.assign({}, ST.me, profilePatch);
        updates['publicProfiles/' + ST.me.uid] = publicPatch;

        try {
          await db.ref().update(updates);
          ST.me = Object.assign(ST.me, profilePatch);
          Nav.close('ov-onboarding');
          toast('Profile complete! Welcome to KLYRO.');
          renderChats(); renderPeople(); renderStatus();
        } catch (e) {
          toast('Could not save profile — try again.');
          btn.disabled = false;
          btn.textContent = 'Enter KLYRO';
        }
      };
    }
  }

  Nav.open('ov-onboarding');
  renderStep();
}

/* ============================ PROFILE MODALS & SETTINGS ============================ */
function openProfile(uid) {
  const u = uid === ST.me.uid ? ST.me : ST.users[uid];
  if (!u) { toast('Profile unavailable.'); return; }
  const isMe = uid === ST.me.uid;
  const limited = !canSeeProfile(u);
  const contact = !!(ST.me.contacts && ST.me.contacts[uid]);
  const pending = !!(ST.requests && ST.requests[uid]);
  const pic = safeMedia(u.photo);

  const badges = [];
  if (!limited) {
    if (isUserOnlineNow(u)) badges.push('<span class="pillx ok">● online</span>');
    else if (u.lastSeen && canSee(u, 'lastSeen')) badges.push('<span class="pillx">' + esc(formatLastSeen(u.lastSeen, '')) + '</span>');
    if (u.country && canSee(u, 'country')) badges.push('<span class="pillx">' + esc(u.country) + '</span>');
    if (contact) badges.push('<span class="pillx ok">contact</span>');
  }

  let actions = '';
  if (isMe) {
    actions = '<button class="btn block" id="pf-edit">Edit profile</button>';
  } else {
    actions = `
      <div style="display:flex;gap:10px">
        ${contact ? `
          <button class="btn ghost" id="pf-block" style="flex:0 0 auto">Block</button>
          <button class="btn" id="pf-chat" style="flex:1">Message</button>
        ` : `
          <button class="btn ghost" id="pf-report" style="flex:0 0 auto">Report</button>
          <button class="btn" id="pf-connect" style="flex:1" ${pending ? 'disabled' : ''}>${pending ? 'Request pending' : 'Connect'}</button>
        `}
      </div>
    `;
  }

  openModal(`
    <div class="pad">
      <div style="text-align:center">
        ${pic ? `<div class="av lg" style="margin:0 auto 12px;box-shadow:var(--kr-sh-2)"><img src="${esc(pic)}" alt=""></div>` : getAvatarHTML(u, 'lg', 'margin:0 auto 12px')}
        <h3 style="margin:0 0 2px">${esc(limited ? 'Private Profile' : userLabel(u))}</h3>
        <div style="color:var(--kr-brand);font-weight:600;font-size:14px">${esc(handleFrom(u))}</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:center;margin:12px 0 6px">${badges.join('')}</div>
        ${!limited && u.bio ? `<p style="color:var(--kr-mut);font-size:14px;margin:10px 0 0;white-space:pre-wrap">${esc(u.bio)}</p>` : ''}
        ${limited ? '<p style="color:var(--kr-mut);font-size:13.5px;margin-top:10px">This user only shares their full profile with contacts.</p>' : ''}
      </div>
      <div style="margin-top:18px">${actions}</div>
      <button class="btn block ghost" id="pf-close" style="margin-top:10px">Close</button>
    </div>
  `);

  s('pf-close').onclick = () => Nav.close('ov-modal');
  if (s('pf-edit')) s('pf-edit').onclick = () => { Nav.close('ov-modal'); openEditProfile(); };
  if (s('pf-chat')) s('pf-chat').onclick = () => { Nav.close('ov-modal'); attemptOpenChat(uid); };
  if (s('pf-connect')) s('pf-connect').onclick = () => { sendFriendRequest(uid); Nav.close('ov-modal'); };
  if (s('pf-block')) s('pf-block').onclick = () => confirmSheet('Block ' + userLabel(u), 'You will stop receiving messages and status updates from this account.', 'Block', () => blockUser(uid), true);
  if (s('pf-report')) s('pf-report').onclick = () => confirmSheet('Report ' + userLabel(u), 'Send a report regarding this account?', 'Submit Report', () => reportUser(uid, 'profile'), true);
}

function openEditProfile() {
  const u = ST.me;
  openModal(`
    <div class="pad">
      <h3>Edit Profile</h3>
      <div style="display:flex;justify-content:center;margin-bottom:14px">
        <div class="av lg" id="ep-avatar" style="cursor:pointer;background:var(--kr-brand);box-shadow:var(--kr-sh-2)">
          ${safeMedia(u.photo) ? '<img src="' + esc(safeMedia(u.photo)) + '" alt="">' : esc(initials(userLabel(u)))}
        </div>
      </div>
      <div style="text-align:center;margin-bottom:14px">
        <button class="btn sm ghost" id="ep-change-pic">Change Photo</button>
        ${safeMedia(u.photo) ? '<button class="btn sm ghost danger" id="ep-remove-pic" style="margin-left:6px">Remove</button>' : ''}
      </div>
      <input type="file" id="ep-file" accept="image/*" hidden>
      ${field('ep-name', 'Display Name', u.name || '', 'text', 'Your name', 'maxlength="40"')}
      <div class="field"><label>Username</label><input class="inp" value="@${esc(u.username || '')}" disabled></div>
      ${textarea('ep-bio', 'Short Bio', u.bio || '', 'A short line about you', 160)}
      ${field('ep-country', 'Country', u.country || '', 'text', 'Country')}
      <div class="err" id="ep-err"></div>
      <div style="display:flex;gap:10px">
        <button class="btn ghost" id="ep-cancel" style="flex:1">Cancel</button>
        <button class="btn" id="ep-save" style="flex:1">Save Changes</button>
      </div>
    </div>
  `);

  let newPic = u.photo || '';
  s('ep-cancel').onclick = () => Nav.close('ov-modal');
  s('ep-change-pic').onclick = () => s('ep-file').click();
  s('ep-avatar').onclick = () => s('ep-file').click();
  if (s('ep-remove-pic')) {
    s('ep-remove-pic').onclick = () => {
      newPic = null;
      s('ep-avatar').innerHTML = esc(initials(u.name || 'User'));
    };
  }

  s('ep-file').onchange = () => {
    const f = s('ep-file').files && s('ep-file').files[0]; if (!f) return;
    handleAvatarPick(f, 'ep-avatar', b64 => { newPic = b64; });
  };

  s('ep-save').onclick = async () => {
    const name = s('ep-name').value.trim();
    if (!name) { s('ep-err').textContent = 'Display name cannot be empty.'; return; }
    
    const patch = {
      name: name,
      bio: s('ep-bio').value.trim().slice(0, 160),
      country: s('ep-country').value.trim()
    };
    if (newPic !== undefined) patch.photo = newPic;

    const publicPatch = {
      name: name,
      bio: patch.bio,
      country: patch.country,
      photo: newPic || null
    };

    try {
      const updates = {};
      updates['users/' + ST.me.uid] = Object.assign({}, ST.me, patch);
      updates['publicProfiles/' + ST.me.uid] = Object.assign({}, publicPatch);
      await db.ref().update(updates);

      ST.me = Object.assign(ST.me, patch);
      toast('Profile updated');
      Nav.close('ov-modal');
      renderChats(); renderPeople(); renderStatus(); renderSettings();
    } catch (e) {
      s('ep-err').textContent = 'Could not save profile — check connection.';
    }
  };
}

function openPrivacy() {
  const p = privacyOf(ST.me);
  const row = (id, label, sub, val, kind) => kind === 'switch'
    ? `<div class="row">
         <div class="mid"><div class="t1"><b>${esc(label)}</b></div>${sub ? '<div class="t2">' + esc(sub) + '</div>' : ''}</div>
         <div class="sw ${val ? 'on' : ''}" data-priv-sw="${id}"></div>
       </div>`
    : `<div class="row" data-priv-sel="${id}">
         <div class="mid"><div class="t1"><b>${esc(label)}</b></div>${sub ? '<div class="t2">' + esc(sub) + '</div>' : ''}</div>
         <span class="pillx">${esc(val)}</span>
       </div>`;

  openModal(`
    <div class="pad">
      <h3>Privacy &amp; Safety</h3>
      ${row('profileVisibility', 'Profile Visibility', 'Who can see your full profile', p.profileVisibility, 'select')}
      ${row('storyAudience', 'Status Audience', 'Who can see your status updates', p.storyAudience, 'select')}
      ${row('messagePrivacy', 'Who Can Message You', 'Restrict incoming messages to contacts', p.messagePrivacy || 'everyone', 'select')}
      ${row('showOnline', 'Show Online Status', 'Appear in Discover when actively online', p.showOnline !== false, 'switch')}
      ${row('showLastSeen', 'Show Last Seen', 'Let others see your last active time', p.showLastSeen !== false, 'switch')}
      ${row('readReceipts', 'Read Receipts', 'Send and receive read checkmarks', p.readReceipts !== false, 'switch')}
      ${row('typingIndicator', 'Typing Indicator', 'Show when you are typing a message', p.typingIndicator !== false, 'switch')}
      ${row('showCountry', 'Show Country', 'Display country badge on profile', p.showCountry !== false, 'switch')}
      ${row('findableByUsername', 'Discoverable by Search', 'Allow others to find you via @username', p.findableByUsername !== false, 'switch')}
      <button class="btn block" id="pv-close" style="margin-top:14px">Done</button>
    </div>
  `);

  s('pv-close').onclick = () => Nav.close('ov-modal');
  $$('[data-priv-sw]').forEach(el => el.onclick = () => {
    const k = el.dataset.privSw, on = !el.classList.contains('on');
    el.classList.toggle('on', on);
    db.ref('users/' + ST.me.uid + '/privacy/' + k).set(on).catch(() => {});
    ST.me.privacy = Object.assign(privacyOf(ST.me), { [k]: on });
  });

  $$('[data-priv-sel]').forEach(el => el.onclick = () => {
    const k = el.dataset.privSel;
    const opts = k === 'storyAudience' ? [['contacts', 'Contacts Only'], ['everyone', 'Everyone']]
      : [['everyone', 'Everyone'], ['contacts', 'Contacts Only']];
    openSheet('Select Preference', opts.map(o => ({
      icon: privacyOf(ST.me)[k] === o[0] ? '✅' : '•',
      label: o[1],
      run: () => {
        db.ref('users/' + ST.me.uid + '/privacy/' + k).set(o[0]).catch(() => {});
        ST.me.privacy = Object.assign(privacyOf(ST.me), { [k]: o[0] });
        toast('Preference updated');
        openPrivacy();
      }
    })));
  });
}

function openFindUser() {
  openModal(`
    <div class="pad">
      <h3>Find by @username</h3>
      ${field('fu-in', 'Username', '', 'text', 'username')}
      <div class="err" id="fu-err"></div>
      <div id="fu-out" style="margin-top:10px"></div>
      <div style="display:flex;gap:10px;margin-top:14px">
        <button class="btn ghost" id="fu-close" style="flex:1">Close</button>
        <button class="btn" id="fu-go" style="flex:1">Search</button>
      </div>
    </div>
  `);

  s('fu-close').onclick = () => Nav.close('ov-modal');
  s('fu-go').onclick = () => {
    const un = s('fu-in').value.replace(/^@/, '').trim().toLowerCase();
    const errEl = s('fu-err'), out = s('fu-out');
    if (!un) { errEl.textContent = 'Please enter a username.'; return; }
    errEl.textContent = 'Searching…';
    out.innerHTML = '';

    lookupUsername(un).then(hit => {
      if (!hit) { errEl.textContent = 'No user found with @' + un; return; }
      errEl.textContent = '';
      db.ref('users/' + hit.uid).once('value').then(sn => {
        const u = Object.assign({ uid: hit.uid }, sn.val() || {});
        if (privacyOf(u).findableByUsername === false && u.uid !== ST.me.uid) {
          errEl.textContent = 'This account is private and not discoverable by search.';
          return;
        }
        out.innerHTML = `
          <div class="row" style="padding:10px 0">
            ${getAvatarHTML(u)}
            <div class="mid"><div class="t1"><b>${esc(userLabel(u))}</b></div><div class="t2">${esc(handleFrom(u))}</div></div>
            <button class="btn sm" id="fu-open">View Profile</button>
          </div>
        `;
        s('fu-open').onclick = () => { Nav.close('ov-modal'); openProfile(hit.uid); };
      });
    }).catch(() => { errEl.textContent = 'Search failed — check connection.'; });
  };
}

function openInvite() {
  const id = ST.me.username ? '@' + ST.me.username : ST.me.uid;
  openModal(`
    <div class="pad">
      <h3>Invite Friends to KLYRO</h3>
      <p style="color:var(--kr-mut);font-size:13.5px;margin:0 0 14px">
        Share your unique KLYRO username. Friends can search your username to connect instantly.
      </p>
      <div class="field">
        <label>Your Username</label>
        <input id="inv-un" class="inp" readonly value="${esc(id)}">
      </div>
      <button class="btn block" id="inv-copy">Copy to Clipboard</button>
      <button class="btn block ghost" id="inv-close" style="margin-top:10px">Close</button>
    </div>
  `);

  s('inv-close').onclick = () => Nav.close('ov-modal');
  s('inv-copy').onclick = () => {
    const v = s('inv-un').value;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(v).then(() => toast('Copied ' + v)).catch(() => toast(v));
    } else {
      s('inv-un').select();
      toast('Copied ' + v);
    }
  };
}

function logOut() {
  confirmSheet('Log out of KLYRO', 'You will need to sign in again to access your messages.', 'Log out', () => {
    Calls.end(true);
    if (ST.mediaRec) Voice.cancel();
    unlistenAll();
    StatusEngine.teardown();
    try { auth.signOut(); } catch (e) {}
  }, true);
}

function renderSettings() {
  const box = s('settings-list'); if (!box || !ST.me) return;
  const p = privacyOf(ST.me), st = settingsOf(ST.me);
  const row = (icon, title, sub, action, trailing) => `
    <div class="row" ${action ? 'data-set="' + action + '"' : ''}>
      <div class="av sm" style="background:var(--kr-bg2);color:var(--kr-txt);font-size:18px">${icon}</div>
      <div class="mid"><div class="t1"><b>${esc(title)}</b></div>${sub ? '<div class="t2">' + esc(sub) + '</div>' : ''}</div>
      ${trailing || '<span class="pillx">›</span>'}
    </div>
  `;

  box.innerHTML = `
    <div class="row" style="padding:16px 14px">
      ${safeMedia(ST.me.photo) ? `<div class="av" style="width:58px;height:58px"><img src="${esc(safeMedia(ST.me.photo))}" alt=""></div>` : getAvatarHTML(ST.me, '', 'width:58px;height:58px;font-size:22px')}
      <div class="mid">
        <div class="t1"><b style="font-size:17px">${esc(userLabel(ST.me))}</b></div>
        <div class="t2">${esc(handleFrom(ST.me))}</div>
      </div>
      <button class="btn sm" data-set="edit">Edit</button>
    </div>
    <div class="sec-title">Account &amp; Security</div>
    ${row('👤','Edit Profile','Name, photo, bio, country','edit')}
    ${row('🔒','Privacy &amp; Safety','Online status, audience, read receipts','privacy')}
    ${row('🔑','Credentials','Account password and security','credentials')}
    <div class="sec-title">Chat &amp; Media</div>
    ${row('⏱️','Disappearing Messages', st.disappearSeconds ? 'On — ' + fmtClock(st.disappearSeconds) : 'Off', 'disappear')}
    ${row('↵','Enter Key to Send', st.enterToSend === false ? 'Off — use send button' : 'On', 'enter')}
    ${row('🎞️','GIF Provider', GifEngine.provider() === 'none' ? 'Not configured — add GIPHY key' : 'Connected · ' + GifEngine.provider(), 'gif')}
    ${row('🗄️','Local Media Cache','Tap to clear stored media from this device','cache')}
    <div class="sec-title">About</div>
    ${row('🛡️','KLYRO','Fast · Private · Modern Messaging', null, '<span class="pillx ok">v2.0</span>')}
    <button class="btn block danger" data-set="logout" style="margin:16px 14px 10px;width:calc(100% - 28px)">Log out</button>
    <div style="text-align:center;color:var(--kr-mut);font-size:12px;padding:0 16px 24px">
      Zero paid cloud storage required — media moves device to device.
    </div>
  `;

  $$('[data-set]', box).forEach(el => el.onclick = () => {
    const a = el.dataset.set;
    if (a === 'edit') openEditProfile();
    if (a === 'privacy') openPrivacy();
    if (a === 'credentials') openCredentials();
    if (a === 'gif') openGifConfigModal();
    if (a === 'logout') logOut();
    if (a === 'enter') {
      const v = settingsOf(ST.me).enterToSend === false;
      db.ref('users/' + ST.me.uid + '/settings/enterToSend').set(v).catch(() => {});
      ST.me.settings = Object.assign(settingsOf(ST.me), { enterToSend: v });
      renderSettings();
    }
    if (a === 'disappear') {
      const cur = settingsOf(ST.me).disappearSeconds;
      openSheet('Disappearing Messages', [
        { icon: !cur ? '✅' : '•', label: 'Off', run: () => setD(0) },
        { icon: cur === 86400 ? '✅' : '•', label: '24 hours', run: () => setD(86400) },
        { icon: cur === 604800 ? '✅' : '•', label: '7 days', run: () => setD(604800) }
      ]);
      function setD(sec) {
        db.ref('users/' + ST.me.uid + '/settings/disappearSeconds').set(sec).catch(() => {});
        ST.me.settings = Object.assign(settingsOf(ST.me), { disappearSeconds: sec });
        toast(sec ? 'New messages will disappear' : 'Disappearing messages off');
        renderSettings();
      }
    }
    if (a === 'cache') {
      confirmSheet('Clear Media Cache', 'Free up device storage by removing cached media. Nothing is deleted from conversations.', 'Clear Cache', () => {
        Store.cleanup(0).then(() => {
          Store.releaseAll();
          toast('Media cache cleared');
        });
      }, true);
    }
  });
}

function openCredentials() {
  openModal(`
    <div class="pad">
      <h3>Credentials &amp; Security</h3>
      <div class="row" style="padding:10px 0">
        <div class="mid">
          <div class="t1"><b>${esc(ST.me.email || 'Signed in')}</b></div>
          <div class="t2">${esc(handleFrom(ST.me))}</div>
        </div>
      </div>
      <button class="btn block" id="cr-reset">Send Password Reset Email</button>
      <button class="btn block danger" id="cr-out" style="margin-top:10px">Log out</button>
      <button class="btn block ghost" id="cr-close" style="margin-top:10px">Close</button>
    </div>
  `);

  s('cr-close').onclick = () => Nav.close('ov-modal');
  s('cr-out').onclick = () => { Nav.close('ov-modal'); logOut(); };
  s('cr-reset').onclick = () => {
    if (!ST.me.email) { toast('No email address associated with this account.'); return; }
    auth.sendPasswordResetEmail(ST.me.email).then(() => toast('Reset email sent to ' + ST.me.email)).catch(() => toast('Could not send reset email.'));
  };
}

/* ============================ LIVE SESSION BOOT ============================ */
function initLiveApp() {
  listenUsers();
  listenGroups();
  listenUnread();
  listenRequests();
  MediaEngine.init();
  StatusEngine.init();
  Calls.listenCalls();
  presence(ST.me.uid);
  registerDevice(ST.me.uid);
  Store.cleanup();
  Store.open().catch(() => {});

  renderChats();
  renderPeople();
  renderStatus();
  renderSettings();

  if ('Notification' in window && Notification.permission === 'default') {
    setTimeout(() => { try { Notification.requestPermission().catch(() => {}); } catch (e) {} }, 6000);
  }
  DBG('KLYRO live app initialized for', ST.me.uid);
}

function bootKlyro() {
  detectPerf();
  initTheme();
  wireAuth();
  wireUI();

  try { history.pushState({ kr: 1 }, ''); } catch (e) {}

  let resolved = false;

  auth.onAuthStateChanged(user => {
    if (!user) {
      resolved = true;
      ST.me = null;
      unlistenAll();
      MediaEngine.teardown();
      StatusEngine.teardown();
      Calls.end(true);
      AuthState.set(AuthState.SIGNED_OUT);
      return;
    }

    AuthState.set(AuthState.SIGNED_IN_PROFILE_LOADING);
    unlisten('me');

    listen('me', 'users/' + user.uid, 'value', sn => {
      const profile = sn.val();
      if (!profile || !profile.username) {
        ST.me = Object.assign({ uid: user.uid, email: user.email }, profile || {});
        AuthState.set(AuthState.PROFILE_INCOMPLETE);
        return;
      }

      const isFirstLoad = !ST.me;
      ST.me = Object.assign({ uid: user.uid, email: profile.email || user.email }, profile);

      if (isFirstLoad) {
        resolved = true;
        initLiveApp();
        AuthState.set(AuthState.READY);
        UpBar.hide();

        /* If user has not completed first-run onboarding, display it now */
        if (profile.onboardingComplete !== true) {
          setTimeout(showFirstRunOnboarding, 600);
        }
      } else {
        renderChats();
        renderPeople();
        renderStatus();
        renderSettings();
        if (Nav.current === 'chat') syncChatHeader();
      }
    }, err => {
      DBG('Profile load error:', err);
      if (!resolved) toast('Could not load profile — check your connection.');
    });
  });

  /* 10s fallback guard: never leave user stuck permanently on loading screen */
  setTimeout(() => {
    if (!resolved && Nav.current === 'loading') {
      const t = s('loading-text');
      if (t) t.textContent = 'Connecting is taking longer than expected…';
      setTimeout(() => {
        if (!resolved && Nav.current === 'loading') {
          AuthState.set(AuthState.SIGNED_OUT);
        }
      }, 5000);
    }
  }, 10000);
}
