/* ==========================================================================
   KLYRO — Production Real-Time Messaging Client
   Brand: KLYRO
   Tone: Fast · Private · Modern · Human · Simple · Reliable

   ==================== KLYRO FIREBASE RULES CONTRACT ====================
   The client interacts with the existing Firebase Realtime Database project:
   projectId: "ar-chat-7193d"
   databaseURL: "https://ar-chat-7193d-default-rtdb.firebaseio.com"

   Expected Security Rules Contract for KLYRO paths:
   {
     "rules": {
       // 1. Private User Profiles: Owner read/write; Authenticated users can read public status/profile
       "users": {
         "$uid": {
           ".read": "auth != null",
           ".write": "auth != null && auth.uid === $uid"
         }
       },
       // 2. Strict Private User Data: Only the account owner
       "usersPrivate": {
         "$uid": {
           ".read": "auth != null && auth.uid === $uid",
           ".write": "auth != null && auth.uid === $uid"
         }
       },
       // 3. Public Profile Projection: Safe public fields only; read by all authenticated users
       "publicProfiles": {
         ".read": "auth != null",
         "$uid": {
           ".write": "auth != null && auth.uid === $uid"
         }
       },
       // 4. Unique Username Registry: Atomic claim; only creator or current owner can mutate
       "usernames": {
         ".read": "auth != null",
         "$username": {
           ".write": "auth != null && (!data.exists() || data.val() === auth.uid || newData.val() === null)"
         }
       },
       // 5. Authoritative Status / Stories:
       "status": {
         "$uid": {
           ".read": "auth != null",
           ".write": "auth != null && auth.uid === $uid",
           "$statusId": {
             "views": {
               "$viewerUid": {
                 ".write": "auth != null && auth.uid === $viewerUid"
               }
             },
             "reactions": {
               "$reactorUid": {
                 ".write": "auth != null && auth.uid === $reactorUid"
               }
             }
           }
         }
       },
       // 6. Lightweight Status Index:
       "statusIndex": {
         "$uid": {
           ".read": "auth != null",
           ".write": "auth != null && auth.uid === $uid"
         }
       },
       // 7. Backward-compatible legacy stories:
       "stories": {
         "$uid": {
           ".read": "auth != null",
           ".write": "auth != null && auth.uid === $uid"
         }
       },
       // 8. Direct & Group Messages: Authenticated participants
       "messages": {
         "$chatId": {
           ".read": "auth != null",
           ".write": "auth != null"
         }
       },
       "groupMessages": {
         "$groupId": {
           ".read": "auth != null",
           ".write": "auth != null"
         }
       },
       "groups": {
         ".read": "auth != null",
         "$groupId": {
           ".write": "auth != null"
         }
       },
       // 9. Connection Requests: Sender or recipient
       "requests": {
         "$uid": {
           ".read": "auth != null && auth.uid === $uid",
           "$senderUid": {
             ".write": "auth != null && (auth.uid === $senderUid || auth.uid === $uid)"
           }
         }
       },
       // 10. WebRTC P2P Signaling & Calls:
       "calls": {
         "$uid": {
           ".read": "auth != null",
           ".write": "auth != null"
         }
       },
       "p2pInbox": {
         "$uid": {
           ".read": "auth != null && auth.uid === $uid",
           ".write": "auth != null"
         }
       },
       "transferRequests": {
         "$uid": {
           ".read": "auth != null && auth.uid === $uid",
           ".write": "auth != null"
         }
       },
       "transfers": {
         "$uid": {
           ".read": "auth != null && auth.uid === $uid",
           ".write": "auth != null"
         }
       },
       "typing": {
         "$chatId": {
           ".read": "auth != null",
           "$uid": {
             ".write": "auth != null && auth.uid === $uid"
           }
         }
       },
       "unreadCounts": {
         "$uid": {
           ".read": "auth != null && auth.uid === $uid",
           ".write": "auth != null"
         }
       }
     }
   }
   ========================================================================== */

const KLYRO_CONFIG = {
  brand: 'KLYRO',

  /* ---- GIF provider -------------------------------------------------
     Primary provider: GIPHY (https://developers.giphy.com → create an app).
     Paste the public beta key below. The app runs fully without a key —
     the GIF tab then shows a friendly setup guide with category browsing. */
  gif: {
    provider: 'giphy',                 // 'giphy' | 'tenor'
    giphyKey: '',                      // ← GIPHY_API_KEY (configured here)
    tenorKey: '',                      // ← optional secondary provider
    limit: 24,
    rating: 'pg-13'
  },

  /* ---- transfer engine (WebRTC DataChannel) ------------------------ */
  transfer: {
    chunkSize: 16384,                  // 16 KB per DataChannel message
    highWater: 4 * 1024 * 1024,        // pause above this buffered amount
    lowWater: 1024 * 1024,             // resume below this
    connectTimeout: 32000,             // ms to establish a data channel
    idleTimeout: 45000,                // ms without progress → failed
    maxRetries: 2,
    verifyChecksum: true               // SHA-256 integrity verification
  },

  /* ---- media limits (device-memory guards, no paid storage) -------- */
  limits: {
    image: 15 * 1024 * 1024,
    video: 150 * 1024 * 1024,
    audio: 60 * 1024 * 1024,
    file: 80 * 1024 * 1024,
    voice: 12 * 1024 * 1024,
    /* Status media is stored in RTDB, so strict limits are enforced */
    storyImage: 620 * 1024,            // max bytes of encoded base64
    storyVideo: 1.8 * 1024 * 1024,     // max bytes for short status video (<=15s)
    inlineBytes: 48 * 1024             // below this inline directly in RTDB
  },

  cache: { maxBytes: 320 * 1024 * 1024 },
  storyTtlMs: 24 * 3600 * 1000
};

/* ============================ FIREBASE INITIALIZATION ============================ */
const firebaseConfig = {
  apiKey: "AIzaSyBq0dJy7GcYIKIhd_OmzKCKhsyeQlKKu_w",
  authDomain: "ar-chat-7193d.firebaseapp.com",
  databaseURL: "https://ar-chat-7193d-default-rtdb.firebaseio.com",
  projectId: "ar-chat-7193d"
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}
const auth = firebase.auth();
const db   = firebase.database();
const TS   = firebase.database.ServerValue.TIMESTAMP;

/* Enable persistent auth locally so refresh never throws user back to login */
try {
  auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
} catch (e) {
  console.warn('[KLYRO] Auth persistence error:', e);
}

/* ============================ SHORTHANDS & UTILITIES ============================ */
const s  = id => document.getElementById(id);
const $  = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));
const now = () => Date.now();
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const esc = t => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
const safeKey = k => String(k).replace(/[.#$/\[\]]/g, '_');
const isHttp = u => /^https?:\/\//i.test(String(u || ''));
function DBG() { if (window.KLYRO_DEBUG) console.log.apply(console, ['[KLYRO]'].concat([].slice.call(arguments))); }

/** Strict media URL allow-list. Blocks javascript:, vbscript:, data:text/html … */
function safeMedia(url) {
  const u = String(url || '').trim();
  if (!u) return '';
  if (/^data:(image\/(png|jpe?g|gif|webp|avif)|audio\/[\w.+-]+|video\/[\w.+-]+);base64,[A-Za-z0-9+/=]+$/i.test(u)) return u;
  if (/^https?:\/\//i.test(u)) return u;
  if (/^blob:/i.test(u)) return u;
  return '';
}

function fmtSize(b) {
  const n = Number(b) || 0;
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
  if (n < 1073741824) return (n / 1048576).toFixed(n < 10485760 ? 1 : 0) + ' MB';
  return (n / 1073741824).toFixed(2) + ' GB';
}

function fmtTime(ts) {
  try { return new Date(ts || now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; }
}

function fmtDay(ts) {
  const d = new Date(ts || now()), t = new Date(), y = new Date(Date.now() - 864e5);
  if (d.toDateString() === t.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: d.getFullYear() === t.getFullYear() ? undefined : 'numeric' });
}

function fmtWhen(ts) {
  const d = Number(ts) || 0; if (!d) return '';
  const diff = now() - d;
  if (diff < 60000) return 'now';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm';
  if (diff < 864e5) return Math.floor(diff / 3600000) + 'h';
  if (diff < 6048e5) return Math.floor(diff / 864e5) + 'd';
  return new Date(d).toLocaleDateString([], { day: 'numeric', month: 'short' });
}

function fmtClock(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
}

function initials(name) {
  const p = String(name || '?').trim().split(/\s+/);
  return ((p[0] || '?')[0] + (p[1] ? p[1][0] : '')).toUpperCase();
}

function colorFor(id) {
  const palette = ['#2563EB','#7C3AED','#E11D48','#0891B2','#16A34A','#D97706','#DB2777','#4F46E5'];
  let h = 0; for (let i = 0; i < String(id || '').length; i++) h = (h * 31 + String(id).charCodeAt(i)) % 9973;
  return palette[h % palette.length];
}

function toast(msg, ms) {
  const t = s('toast'); if (!t) return;
  t.textContent = msg; t.classList.add('show');
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), ms || 2800);
}

const COUNTRIES = ["Afghanistan","Albania","Algeria","Argentina","Australia","Austria","Bangladesh","Belgium","Bhutan","Bolivia","Brazil","Bulgaria","Cambodia","Cameroon","Canada","Chile","China","Colombia","Croatia","Cuba","Czechia","Denmark","Ecuador","Egypt","Estonia","Ethiopia","Finland","France","Georgia","Germany","Ghana","Greece","Hungary","Iceland","India","Indonesia","Iran","Iraq","Ireland","Israel","Italy","Jamaica","Japan","Jordan","Kazakhstan","Kenya","Kuwait","Kyrgyzstan","Laos","Latvia","Lebanon","Libya","Lithuania","Luxembourg","Malaysia","Maldives","Mali","Malta","Mexico","Moldova","Mongolia","Morocco","Myanmar","Nepal","Netherlands","New Zealand","Nigeria","North Macedonia","Norway","Oman","Pakistan","Palestine","Panama","Paraguay","Peru","Philippines","Poland","Portugal","Qatar","Romania","Russia","Rwanda","Saudi Arabia","Senegal","Serbia","Singapore","Slovakia","Slovenia","Somalia","South Africa","South Korea","Spain","Sri Lanka","Sudan","Sweden","Switzerland","Syria","Taiwan","Tajikistan","Tanzania","Thailand","Tunisia","Turkey","Turkmenistan","Uganda","Ukraine","United Arab Emirates","United Kingdom","United States","Uruguay","Uzbekistan","Venezuela","Vietnam","Yemen","Zambia","Zimbabwe"];
const RESERVED = ["admin","administrator","root","system","support","help","klyro","official","moderator","mod","staff","owner","null","undefined","me","you","api","security","firebase","bot","giphy","tenor"];
