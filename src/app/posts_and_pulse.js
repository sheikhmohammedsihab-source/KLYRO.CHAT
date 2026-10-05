/* ==========================================================================
   KLYRO — PUBLIC POSTS & "PULSE" / TRENDING SOCIAL EXPERIENCE
   Features:
     - Public Posts (Text, Photo, Audio, Short Video Clip)
     - Feed types: Latest, Pulse / Trending (Velocity ranked), Saved
     - Likes with spring heart animation & count
     - Expandable comments with threaded replies
     - Share to direct chat or copy link
     - Bookmark / save posts
     - Report & Hide controls
     - Pluggable PublicMediaProvider with strict client-side budget constraints
   ========================================================================== */

const PublicMediaProvider = {
  async processPhoto(file) {
    if (!file) return null;
    const maxBytes = KLYRO_CONFIG.limits.postPhoto || (120 * 1024);
    try {
      const compressed = await compressImage(file, 800, 0.72, maxBytes);
      const b64 = await blobToDataURL(compressed.blob);
      if (b64.length > maxBytes * 1.35) {
        throw new Error('Image too detailed for public feed. Please select a simpler photo.');
      }
      return { type: 'image', data: b64, size: compressed.blob.size, mime: compressed.blob.type };
    } catch (err) {
      throw new Error(err.message || 'Could not process photo');
    }
  },

  async processAudio(blob, durationSec) {
    if (!blob) return null;
    const maxBytes = KLYRO_CONFIG.limits.postAudio || (180 * 1024);
    if (blob.size > maxBytes) {
      throw new Error('Audio clip is too long (maximum 30 seconds for public feed).');
    }
    const b64 = await blobToDataURL(blob);
    return { type: 'audio', data: b64, duration: durationSec || 0, size: blob.size, mime: blob.type };
  },

  async processVideo(file) {
    if (!file) return null;
    const maxBytes = KLYRO_CONFIG.limits.postVideo || (380 * 1024);
    if (file.size > maxBytes * 1.5) {
      throw new Error('Video clip too large for public feed (max 10 seconds / 380 KB).');
    }
    const b64 = await blobToDataURL(file);
    return { type: 'video', data: b64, size: file.size, mime: file.type };
  }
};

const PostsEngine = {
  feedTab: 'latest', // 'latest' | 'pulse' | 'saved'
  postsCache: {},     // postId -> post
  likesCache: {},     // postId -> boolean (I liked)
  savesCache: {},     // postId -> boolean (I saved)
  commentsCache: {},  // postId -> [comments]
  commentsSlot: null,
  activePostId: null,
  subSlot: null,
  queryLimit: 30,

  init() {
    this.postsCache = {};
    this.likesCache = {};
    this.savesCache = {};
    if (!ST.me) return;

    /* Listen to user saves */
    listen('posts:my_saves', 'userSaves/' + ST.me.uid, 'value', sn => {
      this.savesCache = sn.val() || {};
      if (this.feedTab === 'saved') renderPosts();
    });

    /* Listen to recent posts */
    this.subscribeFeed();
  },

  teardown() {
    unlistenAll('posts:');
    this.postsCache = {};
    this.likesCache = {};
  },

  subscribeFeed() {
    listenLimited('posts:feed', 'posts', 'child_added', sn => {
      const p = sn.val();
      if (!p) return;
      p.id = sn.key;
      this.postsCache[p.id] = p;
      this.checkMyLike(p.id);
      if (Nav.tab === 'posts') renderPosts();
    }, this.queryLimit);

    listen('posts:feed_change', 'posts', 'child_changed', sn => {
      const p = sn.val();
      if (!p) return;
      p.id = sn.key;
      this.postsCache[p.id] = Object.assign(this.postsCache[p.id] || {}, p);
      if (Nav.tab === 'posts') renderPosts();
    });

    listen('posts:feed_remove', 'posts', 'child_removed', sn => {
      const id = sn.key;
      delete this.postsCache[id];
      if (Nav.tab === 'posts') renderPosts();
    });
  },

  checkMyLike(postId) {
    if (!ST.me || !postId) return;
    db.ref('postLikes/' + postId + '/' + ST.me.uid).once('value').then(sn => {
      this.likesCache[postId] = !!sn.val();
      const el = s('like-btn-' + postId);
      if (el) {
        el.classList.toggle('liked', !!sn.val());
        const icon = el.querySelector('.like-icon');
        if (icon) icon.textContent = sn.val() ? '❤️' : '🤍';
      }
    }).catch(() => {});
  },

  async toggleLike(postId) {
    if (!ST.me || !postId) return;
    const isLiked = !!this.likesCache[postId];
    const newLiked = !isLiked;
    this.likesCache[postId] = newLiked;

    // Optimistic UI update
    const btn = s('like-btn-' + postId);
    const countEl = s('like-count-' + postId);
    if (btn) {
      btn.classList.toggle('liked', newLiked);
      const icon = btn.querySelector('.like-icon');
      if (icon) {
        icon.textContent = newLiked ? '❤️' : '🤍';
        icon.classList.add('pop-anim');
        setTimeout(() => icon.classList.remove('pop-anim'), 350);
      }
    }

    const post = this.postsCache[postId];
    if (post) {
      post.likesCount = Math.max(0, (post.likesCount || 0) + (newLiked ? 1 : -1));
      if (countEl) countEl.textContent = post.likesCount;
    }

    try {
      if (newLiked) {
        await db.ref('postLikes/' + postId + '/' + ST.me.uid).set(now());
      } else {
        await db.ref('postLikes/' + postId + '/' + ST.me.uid).remove();
      }
      // Authoritative count update via transaction
      db.ref('posts/' + postId + '/likesCount').transaction(cur => {
        return Math.max(0, (cur || 0) + (newLiked ? 1 : -1));
      }).catch(() => {});
    } catch (e) {
      // Revert on error
      this.likesCache[postId] = isLiked;
      renderPosts();
    }
  },

  async toggleSave(postId) {
    if (!ST.me || !postId) return;
    const isSaved = !!this.savesCache[postId];
    const newSaved = !isSaved;
    this.savesCache[postId] = newSaved;

    const btn = s('save-btn-' + postId);
    if (btn) btn.classList.toggle('saved', newSaved);

    try {
      if (newSaved) {
        await db.ref('userSaves/' + ST.me.uid + '/' + postId).set(now());
        toast('Post saved to bookmarks');
      } else {
        await db.ref('userSaves/' + ST.me.uid + '/' + postId).remove();
        toast('Post removed from bookmarks');
      }
    } catch (e) {
      this.savesCache[postId] = isSaved;
      toast('Could not update saved status');
    }
  },

  async createPost(payload) {
    if (!ST.me) throw new Error('Must be signed in');
    const newRef = db.ref('posts').push();
    const postId = newRef.key;

    const post = {
      id: postId,
      author: {
        uid: ST.me.uid,
        name: ST.me.name || 'KLYRO User',
        username: ST.me.username || 'user',
        photo: ST.me.photo || '',
        color: ST.me.color || colorFor(ST.me.uid)
      },
      text: (payload.text || '').trim().slice(0, 1000),
      type: payload.type || 'text', // 'text' | 'photo' | 'audio' | 'video'
      media: payload.media || null,
      createdAt: now(),
      likesCount: 0,
      commentsCount: 0,
      sharesCount: 0
    };

    await newRef.set(post);
    this.postsCache[postId] = post;
    return post;
  },

  async deletePost(postId) {
    if (!ST.me || !postId) return;
    const post = this.postsCache[postId];
    if (!post || post.author.uid !== ST.me.uid) {
      toast('You can only delete your own posts');
      return;
    }
    try {
      await db.ref('posts/' + postId).remove();
      await db.ref('postLikes/' + postId).remove();
      await db.ref('postComments/' + postId).remove();
      delete this.postsCache[postId];
      toast('Post deleted');
      renderPosts();
    } catch (e) {
      toast('Could not delete post');
    }
  },

  reportPost(postId, reason) {
    if (!ST.me || !postId) return;
    const reportRef = db.ref('reports/posts/' + postId + '/' + ST.me.uid);
    reportRef.set({
      reportedBy: ST.me.uid,
      reason: reason || 'Inappropriate content',
      createdAt: now()
    }).then(() => {
      // Locally hide reported post
      delete this.postsCache[postId];
      toast('Thank you. Post reported and hidden.');
      renderPosts();
    }).catch(() => toast('Report submitted'));
  },

  getSortedFeed() {
    let list = Object.values(this.postsCache);

    if (this.feedTab === 'saved') {
      list = list.filter(p => !!this.savesCache[p.id]);
    } else if (this.feedTab === 'pulse') {
      // Pulse / Trending algorithm:
      // Weight likes (3x), comments (5x), shares (4x) against age in hours
      const currentTime = now();
      list.sort((a, b) => {
        const scoreA = ((a.likesCount || 0) * 3 + (a.commentsCount || 0) * 5 + (a.sharesCount || 0) * 4) /
                       Math.pow(((currentTime - a.createdAt) / 3600000) + 2, 1.4);
        const scoreB = ((b.likesCount || 0) * 3 + (b.commentsCount || 0) * 5 + (b.sharesCount || 0) * 4) /
                       Math.pow(((currentTime - b.createdAt) / 3600000) + 2, 1.4);
        return scoreB - scoreA;
      });
      return list;
    }

    // Default 'latest'
    list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return list;
  }
};

/* ---------------- Render Posts Feed UI ---------------- */
function renderPosts() {
  const container = s('posts-feed');
  if (!container) return;

  const posts = PostsEngine.getSortedFeed();

  // Active filter tab styling
  $$('[data-post-tab]').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.postTab === PostsEngine.feedTab);
  });

  if (!posts.length) {
    container.innerHTML = `
      <div class="empty" style="padding:48px 16px">
        <div class="big">✨</div>
        <div style="font-weight:700;font-size:16px;margin-bottom:6px">
          ${PostsEngine.feedTab === 'saved' ? 'No saved posts yet' : 'No posts in this feed'}
        </div>
        <div style="font-size:13.5px;color:var(--kr-mut);max-width:280px;line-height:1.5">
          ${PostsEngine.feedTab === 'saved'
            ? 'Bookmark interesting posts from the feed to view them here later.'
            : 'Be the first to share an update, thought, photo, or audio note with KLYRO!'}
        </div>
        ${PostsEngine.feedTab !== 'saved' ? `
          <button class="btn sm" id="btn-empty-compose" style="margin-top:16px">＋ Create Post</button>
        ` : ''}
      </div>
    `;
    const btn = s('btn-empty-compose');
    if (btn) btn.onclick = openPostComposer;
    return;
  }

  container.innerHTML = posts.map(p => renderPostCard(p)).join('');

  // Wire interactions
  posts.forEach(p => {
    const likeBtn = s('like-btn-' + p.id);
    if (likeBtn) likeBtn.onclick = () => PostsEngine.toggleLike(p.id);

    const commBtn = s('comm-btn-' + p.id);
    if (commBtn) commBtn.onclick = () => openCommentsSheet(p.id);

    const shareBtn = s('share-btn-' + p.id);
    if (shareBtn) shareBtn.onclick = () => openShareSheet(p.id);

    const saveBtn = s('save-btn-' + p.id);
    if (saveBtn) saveBtn.onclick = () => PostsEngine.toggleSave(p.id);

    const optBtn = s('opt-btn-' + p.id);
    if (optBtn) optBtn.onclick = () => openPostMenu(p.id);

    const authorHeader = s('post-author-' + p.id);
    if (authorHeader) authorHeader.onclick = () => openProfile(p.author.uid);

    // Audio post player
    const playBtn = s('audio-play-' + p.id);
    if (playBtn) {
      const audioEl = s('audio-elem-' + p.id);
      playBtn.onclick = () => {
        if (!audioEl) return;
        if (audioEl.paused) {
          audioEl.play().catch(() => {});
          playBtn.textContent = '⏸ Pause';
        } else {
          audioEl.pause();
          playBtn.textContent = '▶ Play Audio';
        }
      };
      if (audioEl) {
        audioEl.onended = () => { playBtn.textContent = '▶ Play Audio'; };
      }
    }
  });
}

function renderPostCard(p) {
  const isMine = ST.me && p.author.uid === ST.me.uid;
  const isLiked = !!PostsEngine.likesCache[p.id];
  const isSaved = !!PostsEngine.savesCache[p.id];

  let mediaHtml = '';
  if (p.media) {
    if (p.type === 'photo' || p.media.type === 'image') {
      mediaHtml = `
        <div class="post-media-box" style="margin:10px -14px 12px;background:#000;border-radius:12px;overflow:hidden;max-height:480px;display:flex;align-items:center;justify-content:center">
          <img src="${esc(p.media.data)}" alt="" style="width:100%;max-height:480px;object-fit:contain;cursor:pointer" onclick="openMediaLightbox('${esc(p.media.data)}')">
        </div>
      `;
    } else if (p.type === 'audio' || p.media.type === 'audio') {
      mediaHtml = `
        <div class="post-audio-card" style="margin:10px 0 12px;padding:12px 14px;background:var(--kr-bg2);border:1px solid var(--kr-line);border-radius:14px;display:flex;align-items:center;gap:12px">
          <button class="btn sm" id="audio-play-${esc(p.id)}" style="height:32px;padding:0 12px;font-size:12px;background:var(--kr-brand);color:#fff">
            ▶ Play Audio
          </button>
          <div style="flex:1">
            <div style="font-size:12px;font-weight:600">Voice Note</div>
            <div style="font-size:11px;color:var(--kr-mut)">${p.media.duration ? fmtClock(p.media.duration) : 'Audio clip'}</div>
          </div>
          <audio id="audio-elem-${esc(p.id)}" src="${esc(p.media.data)}" preload="none"></audio>
        </div>
      `;
    } else if (p.type === 'video' || p.media.type === 'video') {
      mediaHtml = `
        <div class="post-media-box" style="margin:10px -14px 12px;background:#000;border-radius:12px;overflow:hidden;max-height:420px;display:flex;align-items:center;justify-content:center">
          <video src="${esc(p.media.data)}" controls playsinline style="width:100%;max-height:420px;object-fit:contain"></video>
        </div>
      `;
    }
  }

  // Parse text for hashtags
  const formattedText = esc(p.text || '').replace(/#([a-zA-Z0-9_]+)/g, '<span style="color:var(--kr-brand);font-weight:600">#$1</span>');

  return `
    <article class="post-card" id="post-${esc(p.id)}">
      <header class="post-header">
        <div class="post-author" id="post-author-${esc(p.id)}" style="cursor:pointer">
          <div class="av md" style="background:${esc(p.author.color || colorFor(p.author.uid))}">
            ${p.author.photo ? `<img src="${esc(p.author.photo)}" alt="">` : esc(initials(p.author.name))}
          </div>
          <div class="post-meta">
            <div class="author-name"><b>${esc(p.author.name)}</b></div>
            <div class="author-handle">@${esc(p.author.username)} · ${esc(fmtWhen(p.createdAt))}</div>
          </div>
        </div>
        <button class="ib sm post-menu-btn" id="opt-btn-${esc(p.id)}" aria-label="Post options">
          <svg viewBox="0 0 24 24" width="18" height="18"><circle cx="12" cy="5" r="2" fill="currentColor"/><circle cx="12" cy="12" r="2" fill="currentColor"/><circle cx="12" cy="19" r="2" fill="currentColor"/></svg>
        </button>
      </header>

      ${p.text ? `<div class="post-content">${formattedText}</div>` : ''}
      ${mediaHtml}

      <footer class="post-footer">
        <button class="post-action-btn ${isLiked ? 'liked' : ''}" id="like-btn-${esc(p.id)}" aria-label="Like post">
          <span class="like-icon" style="font-size:15px">${isLiked ? '❤️' : '🤍'}</span>
          <span id="like-count-${esc(p.id)}">${p.likesCount || 0}</span>
        </button>

        <button class="post-action-btn" id="comm-btn-${esc(p.id)}" aria-label="Comments">
          <svg viewBox="0 0 24 24" width="16" height="16"><path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>
          <span>${p.commentsCount || 0}</span>
        </button>

        <button class="post-action-btn" id="share-btn-${esc(p.id)}" aria-label="Share">
          <svg viewBox="0 0 24 24" width="16" height="16"><path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8m-4-6l-4-4-4 4m4-4v13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
          <span>Share</span>
        </button>

        <div style="flex:1"></div>

        <button class="post-action-btn ${isSaved ? 'saved' : ''}" id="save-btn-${esc(p.id)}" aria-label="Save post" title="Bookmark">
          <svg viewBox="0 0 24 24" width="16" height="16"><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z" fill="${isSaved ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.8"/></svg>
        </button>
      </footer>
    </article>
  `;
}

/* ---------------- Post Composer Modal ---------------- */
function openPostComposer() {
  let mediaAttached = null; // { type, data, ... }
  let audioRec = null, audioChunks = [], isRecording = false, recTimer = null, recSeconds = 0;

  openModal(`
    <div class="pad post-composer-box">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <h3 style="margin:0">Create Post</h3>
        <button class="ib sm" id="pc-close">✕</button>
      </div>

      <div style="display:flex;gap:10px;margin-bottom:12px">
        <div class="av md" style="background:${esc(ST.me.color || colorFor(ST.me.uid))}">
          ${ST.me.photo ? `<img src="${esc(ST.me.photo)}" alt="">` : esc(initials(ST.me.name))}
        </div>
        <div>
          <div style="font-weight:700;font-size:14px">${esc(ST.me.name)}</div>
          <div style="font-size:12px;color:var(--kr-mut)">Posting to KLYRO Public Feed</div>
        </div>
      </div>

      <textarea id="pc-text" class="inp" placeholder="What's happening? Share thoughts, links or questions…" maxlength="1000" rows="4" style="resize:none;font-size:14.5px;line-height:1.5"></textarea>
      <div style="display:flex;justify-content:flex-end;font-size:11px;color:var(--kr-mut);margin:4px 0 10px" id="pc-counter">0 / 1000</div>

      <div id="pc-media-prev" style="margin-bottom:12px;display:none"></div>

      <div class="err" id="pc-err" style="margin-bottom:10px"></div>

      <div style="display:flex;align-items:center;justify-content:space-between;border-top:1px solid var(--kr-line);padding-top:12px">
        <div style="display:flex;gap:6px">
          <input type="file" id="pc-photo-input" accept="image/*" hidden>
          <input type="file" id="pc-video-input" accept="video/*" hidden>
          <button class="btn sm outline" id="pc-add-photo" title="Add photo">📷 Photo</button>
          <button class="btn sm outline" id="pc-add-audio" title="Record voice note">🎙️ Voice</button>
          <button class="btn sm outline" id="pc-add-video" title="Add short clip">🎬 Clip</button>
        </div>
        <button class="btn sm" id="pc-submit" style="padding:0 18px">Publish</button>
      </div>
    </div>
  `);

  const textArea = s('pc-text');
  const counter = s('pc-counter');
  const errEl = s('pc-err');
  const prevBox = s('pc-media-prev');
  const submitBtn = s('pc-submit');

  textArea.addEventListener('input', () => {
    counter.textContent = textArea.value.length + ' / 1000';
  });

  s('pc-close').onclick = () => Nav.close('ov-modal');

  // Photo
  s('pc-add-photo').onclick = () => s('pc-photo-input').click();
  s('pc-photo-input').onchange = async () => {
    const file = s('pc-photo-input').files && s('pc-photo-input').files[0];
    if (!file) return;
    errEl.textContent = '';
    submitBtn.disabled = true;
    submitBtn.textContent = 'Processing…';
    try {
      mediaAttached = await PublicMediaProvider.processPhoto(file);
      showMediaPreview('photo', mediaAttached.data);
    } catch (e) {
      errEl.textContent = e.message;
      mediaAttached = null;
    }
    submitBtn.disabled = false;
    submitBtn.textContent = 'Publish';
  };

  // Video
  s('pc-add-video').onclick = () => s('pc-video-input').click();
  s('pc-video-input').onchange = async () => {
    const file = s('pc-video-input').files && s('pc-video-input').files[0];
    if (!file) return;
    errEl.textContent = '';
    submitBtn.disabled = true;
    submitBtn.textContent = 'Processing…';
    try {
      mediaAttached = await PublicMediaProvider.processVideo(file);
      showMediaPreview('video', mediaAttached.data);
    } catch (e) {
      errEl.textContent = e.message;
      mediaAttached = null;
    }
    submitBtn.disabled = false;
    submitBtn.textContent = 'Publish';
  };

  // Audio recording
  s('pc-add-audio').onclick = async () => {
    if (isRecording) {
      // Stop recording
      if (audioRec && audioRec.state !== 'inactive') audioRec.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunks = [];
      recSeconds = 0;
      audioRec = new MediaRecorder(stream);
      audioRec.ondataavailable = e => { if (e.data.size > 0) audioChunks.push(e.data); };
      audioRec.onstop = async () => {
        clearInterval(recTimer);
        stream.getTracks().forEach(t => t.stop());
        isRecording = false;
        s('pc-add-audio').textContent = '🎙️ Voice';
        s('pc-add-audio').style.background = '';
        const blob = new Blob(audioChunks, { type: 'audio/webm' });
        submitBtn.disabled = true;
        submitBtn.textContent = 'Processing…';
        try {
          mediaAttached = await PublicMediaProvider.processAudio(blob, recSeconds);
          showMediaPreview('audio', mediaAttached.data, recSeconds);
        } catch (e) {
          errEl.textContent = e.message;
          mediaAttached = null;
        }
        submitBtn.disabled = false;
        submitBtn.textContent = 'Publish';
      };

      audioRec.start(250);
      isRecording = true;
      s('pc-add-audio').textContent = '⏹ Stop (0s)';
      s('pc-add-audio').style.background = 'var(--kr-danger)';
      s('pc-add-audio').style.color = '#fff';

      recTimer = setInterval(() => {
        recSeconds++;
        s('pc-add-audio').textContent = `⏹ Stop (${recSeconds}s)`;
        if (recSeconds >= 30) {
          if (audioRec && audioRec.state !== 'inactive') audioRec.stop();
        }
      }, 1000);
    } catch (e) {
      errEl.textContent = 'Microphone permission denied or unsupported.';
    }
  };

  function showMediaPreview(type, src, dur) {
    prevBox.style.display = 'block';
    if (type === 'photo') {
      prevBox.innerHTML = `
        <div style="position:relative;display:inline-block;border-radius:10px;overflow:hidden;border:1px solid var(--kr-line)">
          <img src="${esc(src)}" style="max-height:180px;display:block" alt="">
          <button class="ib sm" id="pc-rem-media" style="position:absolute;top:6px;right:6px;background:rgba(0,0,0,0.6);color:#fff">✕</button>
        </div>
      `;
    } else if (type === 'audio') {
      prevBox.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;padding:10px;background:var(--kr-bg2);border:1px solid var(--kr-line);border-radius:10px">
          <span>🎙️ Voice Note (${fmtClock(dur || 0)})</span>
          <audio controls src="${esc(src)}" style="height:28px"></audio>
          <button class="ib sm" id="pc-rem-media">✕</button>
        </div>
      `;
    } else if (type === 'video') {
      prevBox.innerHTML = `
        <div style="position:relative;display:inline-block;border-radius:10px;overflow:hidden;border:1px solid var(--kr-line)">
          <video src="${esc(src)}" controls style="max-height:180px;display:block"></video>
          <button class="ib sm" id="pc-rem-media" style="position:absolute;top:6px;right:6px;background:rgba(0,0,0,0.6);color:#fff">✕</button>
        </div>
      `;
    }
    const rem = s('pc-rem-media');
    if (rem) {
      rem.onclick = () => {
        mediaAttached = null;
        prevBox.style.display = 'none';
        prevBox.innerHTML = '';
      };
    }
  }

  submitBtn.onclick = async () => {
    const text = textArea.value.trim();
    if (!text && !mediaAttached) {
      errEl.textContent = 'Please enter some text or attach media to post.';
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Publishing…';
    errEl.textContent = '';

    try {
      await PostsEngine.createPost({
        text: text,
        type: mediaAttached ? mediaAttached.type : 'text',
        media: mediaAttached
      });
      Nav.close('ov-modal');
      toast('Post published to KLYRO feed!');
      renderPosts();
    } catch (e) {
      errEl.textContent = e.message || 'Could not publish post. Please retry.';
      submitBtn.disabled = false;
      submitBtn.textContent = 'Publish';
    }
  };
}

/* ---------------- Post Comments Sheet ---------------- */
function openCommentsSheet(postId) {
  const post = PostsEngine.postsCache[postId];
  if (!post) return;

  openModal(`
    <div class="pad comments-modal" style="max-height:85vh;display:flex;flex-direction:column;padding:16px 14px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <h3 style="margin:0;font-size:16px">Comments (${post.commentsCount || 0})</h3>
        <button class="ib sm" id="cm-close">✕</button>
      </div>

      <div class="scroll" id="cm-list" style="flex:1;min-height:160px;max-height:360px;padding:4px 0">
        <div style="text-align:center;padding:24px;color:var(--kr-mut)">Loading comments…</div>
      </div>

      <form id="cm-form" style="display:flex;gap:8px;margin-top:12px;border-top:1px solid var(--kr-line);padding-top:12px">
        <input class="inp" id="cm-input" placeholder="Add a comment…" maxlength="300" style="flex:1" autocomplete="off" required>
        <button class="btn sm" type="submit" id="cm-submit">Send</button>
      </form>
    </div>
  `);

  s('cm-close').onclick = () => Nav.close('ov-modal');

  const listEl = s('cm-list');
  const formEl = s('cm-form');
  const inputEl = s('cm-input');
  const submitBtn = s('cm-submit');

  // Listen to comments for this post
  listenLimited('post:comments:' + postId, 'postComments/' + postId, 'value', sn => {
    const all = sn.val() || {};
    const comments = Object.values(all).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    PostsEngine.commentsCache[postId] = comments;

    if (!comments.length) {
      listEl.innerHTML = `<div style="text-align:center;padding:32px 10px;color:var(--kr-mut);font-size:13.5px">No comments yet. Start the conversation!</div>`;
      return;
    }

    listEl.innerHTML = comments.map(c => `
      <div class="comment-row" style="display:flex;gap:10px;padding:8px 0;border-bottom:1px solid var(--kr-line2)">
        <div class="av sm" style="background:${esc(c.author.color || colorFor(c.author.uid))}">
          ${c.author.photo ? `<img src="${esc(c.author.photo)}" alt="">` : esc(initials(c.author.name))}
        </div>
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:baseline;gap:6px">
            <span style="font-weight:700;font-size:13px">${esc(c.author.name)}</span>
            <span style="font-size:11.5px;color:var(--kr-mut)">${esc(fmtWhen(c.createdAt))}</span>
          </div>
          <div style="font-size:13.5px;line-height:1.4;margin-top:2px;word-break:break-word">${esc(c.text)}</div>
        </div>
      </div>
    `).join('');
  }, 40);

  formEl.onsubmit = async e => {
    e.preventDefault();
    const text = inputEl.value.trim();
    if (!text || !ST.me) return;

    submitBtn.disabled = true;
    inputEl.disabled = true;

    const commRef = db.ref('postComments/' + postId).push();
    const newComment = {
      id: commRef.key,
      postId: postId,
      author: {
        uid: ST.me.uid,
        name: ST.me.name || 'KLYRO User',
        username: ST.me.username || 'user',
        photo: ST.me.photo || '',
        color: ST.me.color || colorFor(ST.me.uid)
      },
      text: text,
      createdAt: now()
    };

    try {
      await commRef.set(newComment);
      inputEl.value = '';
      db.ref('posts/' + postId + '/commentsCount').transaction(cur => (cur || 0) + 1);
      if (post) post.commentsCount = (post.commentsCount || 0) + 1;
      renderPosts();
    } catch (err) {
      toast('Could not send comment');
    }

    submitBtn.disabled = false;
    inputEl.disabled = false;
    inputEl.focus();
  };
}

/* ---------------- Post Menu & Actions ---------------- */
function openPostMenu(postId) {
  const post = PostsEngine.postsCache[postId];
  if (!post) return;
  const isMine = ST.me && post.author.uid === ST.me.uid;

  const actions = [];
  if (isMine) {
    actions.push({
      icon: '🗑️',
      label: 'Delete Post',
      danger: true,
      run: () => {
        confirmSheet('Delete Post', 'Are you sure you want to delete this post from the public feed?', 'Delete', () => {
          PostsEngine.deletePost(postId);
        }, true);
      }
    });
  } else {
    actions.push({
      icon: '🚩',
      label: 'Report Post',
      run: () => {
        openSheet('Report Post', [
          { label: 'Spam or deceptive', run: () => PostsEngine.reportPost(postId, 'Spam') },
          { label: 'Harassment or abuse', run: () => PostsEngine.reportPost(postId, 'Harassment') },
          { label: 'Inappropriate media', run: () => PostsEngine.reportPost(postId, 'Inappropriate media') }
        ]);
      }
    });
  }

  actions.push({
    icon: '🔗',
    label: 'Copy Post Text',
    run: () => {
      if (navigator.clipboard && post.text) {
        navigator.clipboard.writeText(post.text);
        toast('Post text copied');
      }
    }
  });

  openSheet('Post Options', actions);
}

function openShareSheet(postId) {
  const post = PostsEngine.postsCache[postId];
  if (!post) return;

  const contacts = Object.keys(ST.me.contacts || {}).map(uid => ST.users[uid]).filter(Boolean);

  const contactActions = contacts.map(c => ({
    icon: '💬',
    label: 'Send to ' + userLabel(c),
    run: () => {
      openChatWith(c.uid);
      const shareMsg = {
        type: 'text',
        text: `Shared post by @${post.author.username}:\n"${(post.text || '').slice(0, 120)}"`
      };
      if (typeof pushMessage === 'function') pushMessage(shareMsg);
      toast('Shared to ' + userLabel(c));
    }
  }));

  const allActions = [
    {
      icon: '📋',
      label: 'Copy Link',
      run: () => {
        const url = window.location.origin + '?post=' + postId;
        if (navigator.clipboard) {
          navigator.clipboard.writeText(url);
          toast('Post link copied to clipboard');
        }
      }
    }
  ].concat(contactActions);

  openSheet('Share Post', allActions);
}

function openMediaLightbox(url) {
  openModal(`
    <div style="background:#000;display:flex;align-items:center;justify-content:center;position:relative;width:100%;height:85vh">
      <button class="ib" onclick="Nav.close('ov-modal')" style="position:absolute;top:12px;right:12px;color:#fff;background:rgba(255,255,255,0.2);z-index:10">✕</button>
      <img src="${esc(url)}" alt="" style="max-width:100%;max-height:100%;object-fit:contain">
    </div>
  `);
}
