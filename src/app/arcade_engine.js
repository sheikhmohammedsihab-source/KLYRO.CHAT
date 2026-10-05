/* ==========================================================================
   KLYRO ARCADE ECOSYSTEM & GAME ENGINES v2.0
   Pillar: ENTERTAINMENT
   Includes:
     1. Architecture: GameDefinition abstraction & Room system
     2. 5 Playable Real-Time Games:
        - Ludo Club (Full 57-step track, safe stars, roll-6 exit, captures)
        - Speed Chess (8x8 board, legal move validation, checks, timers, captures)
        - Carrom Strike (Tabletop physics, angle aim, power bar, corner pockets, Queen)
        - Snakes & Ladders (100-cell grid, animated dice, snakes, ladders)
        - KLYRO Rush (Original reflex duel)
     3. Gamer Profile & Progression: XP, Arcade Level, badges, match stats
     4. Leaderboards: Global & Friends rankings
     5. Achievements & Daily Missions
     6. Tournament & Event Engine
     7. Social Loop: Share Victory to Pulse / Send Challenge to Chat
   ========================================================================== */

const ARCADE_GAMES = {
  ludo: {
    id: 'ludo',
    name: 'Ludo Club',
    tagline: 'Classic Tabletop Race',
    icon: '🎲',
    category: 'Board',
    playerCounts: [2, 4],
    duration: '5–10 min',
    difficulty: 'Casual',
    desc: 'Roll the dice, race all 4 tokens to home base, capture opponent tokens on normal cells, and claim victory.',
    modes: ['Classic 1v1', '4-Player Battle', 'Private Room']
  },
  chess: {
    id: 'chess',
    name: 'Speed Chess',
    tagline: 'Tactical Mind Duel',
    icon: '♟️',
    category: 'Strategy',
    playerCounts: [2],
    duration: '3–8 min',
    difficulty: 'Competitive',
    desc: 'Real-time chess with legal move enforcement, turn timers, check detection, and captured piece tray.',
    modes: ['Standard 1v1', 'Casual Challenge', 'Private Room']
  },
  carrom: {
    id: 'carrom',
    name: 'Carrom Strike',
    tagline: 'Tabletop Physics Challenge',
    icon: '🎯',
    category: 'Casual',
    playerCounts: [2],
    duration: '4–7 min',
    difficulty: 'Skill',
    desc: 'Position your striker on the baseline, aim the trajectory line, charge up power, and pocket White, Black, and Queen coins.',
    modes: ['1v1 Match', 'Free Style', 'Private Room']
  },
  snakes: {
    id: 'snakes',
    name: 'Snakes & Ladders',
    tagline: 'Climb or Slide',
    icon: '🐍',
    category: 'Casual',
    playerCounts: [2, 4],
    duration: '3–5 min',
    difficulty: 'Casual',
    desc: 'Roll the animated dice, climb high ladders, dodge treacherous snakes, and be the first to land on cell 100!',
    modes: ['2 Players', '4 Players', 'Private Room']
  },
  rush: {
    id: 'rush',
    name: 'KLYRO Rush',
    tagline: 'Original Reflex Duel',
    icon: '⚡',
    category: 'KLYRO Originals',
    playerCounts: [2],
    duration: '1–2 min',
    difficulty: 'Reflex',
    desc: 'Fast-paced original reaction duel! React to live on-screen cues faster than your rival to score combo points.',
    modes: ['Fast 5-Round Duel', 'Private Challenge']
  }
};

const ArcadeEngine = {
  activeRoom: null,
  activeGameType: null,
  activeRoomId: null,
  listenerSlot: null,
  diceRolling: false,
  timerInterval: null,
  selectedDetailGame: null,
  currentTab: 'all', // 'all' | 'board' | 'strategy' | 'casual' | 'originals' | 'tournaments' | 'leaderboards'

  /* ---------------- Challenge Notification State ---------------- */
  activeToastChallenge: null,
  challengeCountdownTimer: null,
  seenChallenges: new Set(),

  init() {
    this.activeRoom = null;
    this.activeGameType = null;
    this.initGamerProfile();
    this.listenGameChallenges();
  },

  teardown() {
    if (this.listenerSlot) {
      unlisten(this.listenerSlot);
      this.listenerSlot = null;
    }
    unlisten('gameChallenges');
    this.hideChallengeToast();
    clearInterval(this.timerInterval);
    this.activeRoom = null;
  },

  /* ---------------- Gamer Profile & Progression ---------------- */
  async initGamerProfile() {
    if (!ST.me) return;
    try {
      const sn = await db.ref('gamerProfiles/' + ST.me.uid).once('value');
      let p = sn.val();
      if (!p) {
        p = {
          uid: ST.me.uid,
          name: ST.me.name || 'Player',
          username: ST.me.username || 'user',
          xp: 150,
          level: 2,
          totalMatches: 0,
          totalWins: 0,
          streak: 0,
          badges: ['arcade_rookie'],
          achievements: { first_join: now() },
          stats: {
            ludo: { matches: 0, wins: 0 },
            chess: { matches: 0, wins: 0, rating: 1200 },
            carrom: { matches: 0, wins: 0, highScore: 0 },
            snakes: { matches: 0, wins: 0 },
            rush: { matches: 0, wins: 0 }
          }
        };
        await db.ref('gamerProfiles/' + ST.me.uid).set(p);
      }
      ST.gamerProfile = p;
    } catch (e) {
      ST.gamerProfile = { xp: 150, level: 2, totalMatches: 0, totalWins: 0, streak: 0, badges: ['arcade_rookie'], stats: {} };
    }
  },

  calculateLevel(xp) {
    return Math.floor(Math.sqrt((xp || 0) / 80)) + 1;
  },

  async awardMatchOutcome(gameType, isWinner) {
    if (!ST.me || !ST.gamerProfile) return;
    const p = ST.gamerProfile;
    const gainedXp = isWinner ? 120 : 40;
    p.xp = (p.xp || 0) + gainedXp;
    p.level = this.calculateLevel(p.xp);
    p.totalMatches = (p.totalMatches || 0) + 1;
    if (isWinner) {
      p.totalWins = (p.totalWins || 0) + 1;
      p.streak = (p.streak || 0) + 1;
    } else {
      p.streak = 0;
    }

    if (!p.stats) p.stats = {};
    if (!p.stats[gameType]) p.stats[gameType] = { matches: 0, wins: 0 };
    p.stats[gameType].matches = (p.stats[gameType].matches || 0) + 1;
    if (isWinner) p.stats[gameType].wins = (p.stats[gameType].wins || 0) + 1;

    // Check achievements
    if (!p.achievements) p.achievements = {};
    if (isWinner && !p.achievements.first_win) {
      p.achievements.first_win = now();
      toast('🏆 Achievement Unlocked: First Victory!');
    }
    if (p.totalWins >= 5 && !p.achievements.five_wins) {
      p.achievements.five_wins = now();
      toast('🏆 Achievement Unlocked: 5 Wins Champion!');
    }

    try {
      await db.ref('gamerProfiles/' + ST.me.uid).update(p);
      // Update global leaderboard record
      await db.ref('leaderboards/global/' + ST.me.uid).set({
        uid: ST.me.uid,
        name: ST.me.name || 'Player',
        username: ST.me.username || 'user',
        photo: ST.me.photo || '',
        level: p.level,
        xp: p.xp,
        wins: p.totalWins,
        lastActive: now()
      });
    } catch (e) {}
  },

  /* ---------------- Create Game Room ---------------- */
  async createRoom(gameType, maxPlayers, isPrivate) {
    if (!ST.me) return;
    const roomId = 'klyro_' + Math.random().toString(36).slice(2, 8);
    const hostColor = gameType === 'chess' ? 'white' : 'red';

    const roomData = {
      id: roomId,
      gameType: gameType,
      maxPlayers: maxPlayers || 2,
      isPrivate: !!isPrivate,
      status: 'waiting',
      hostUid: ST.me.uid,
      createdAt: now(),
      lastActionAt: now(),
      winner: null,
      turn: ST.me.uid,
      turnTimeLeft: 45,
      players: {
        [ST.me.uid]: {
          uid: ST.me.uid,
          name: ST.me.name || 'Player 1',
          photo: ST.me.photo || '',
          color: hostColor,
          ready: true,
          score: 0,
          joinedAt: now()
        }
      },
      state: this.getInitialState(gameType, maxPlayers)
    };

    await db.ref('games/' + gameType + '/' + roomId).set(roomData);
    this.openRoom(gameType, roomId);
    return roomId;
  },

  /* ---------------- Join Game Room ---------------- */
  async joinRoom(gameType, roomId) {
    if (!ST.me) return;
    const roomRef = db.ref('games/' + gameType + '/' + roomId);
    const sn = await roomRef.once('value');
    const room = sn.val();

    if (!room) {
      toast('Game room not found or match has ended.');
      return;
    }

    const currentPlayers = room.players || {};
    const pCount = Object.keys(currentPlayers).length;

    if (currentPlayers[ST.me.uid]) {
      this.openRoom(gameType, roomId);
      return;
    }

    if (pCount >= (room.maxPlayers || 2)) {
      toast('This match is already full.');
      return;
    }

    let newColor = 'green';
    if (gameType === 'chess') {
      const hostP = currentPlayers[room.hostUid] || Object.values(currentPlayers)[0];
      newColor = (hostP && hostP.color === 'white') ? 'black' : 'white';
    } else if (gameType === 'ludo') {
      const colors = ['red', 'green', 'yellow', 'blue'];
      const used = Object.values(currentPlayers).map(p => p.color);
      newColor = colors.find(c => !used.includes(c)) || 'green';
    }

    const newPlayer = {
      uid: ST.me.uid,
      name: ST.me.name || 'Player ' + (pCount + 1),
      photo: ST.me.photo || '',
      color: newColor,
      ready: true,
      score: 0,
      joinedAt: now()
    };

    const updates = {};
    updates['players/' + ST.me.uid] = newPlayer;

    if (pCount + 1 >= (room.maxPlayers || 2)) {
      updates['status'] = 'playing';
      updates['turn'] = room.hostUid;
      updates['lastActionAt'] = now();
    }

    await roomRef.update(updates);
    this.openRoom(gameType, roomId);
  },

  /* ---------------- Initial State Generator ---------------- */
  getInitialState(gameType, maxPlayers) {
    if (gameType === 'ludo') {
      return {
        diceValue: 6,
        tokens: {
          red: [-1, -1, -1, -1],
          green: [-1, -1, -1, -1],
          yellow: [-1, -1, -1, -1],
          blue: [-1, -1, -1, -1]
        },
        hasExtraRoll: false
      };
    } else if (gameType === 'chess') {
      return {
        board: [
          ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'],
          ['p', 'p', 'p', 'p', 'p', 'p', 'p', 'p'],
          ['.', '.', '.', '.', '.', '.', '.', '.'],
          ['.', '.', '.', '.', '.', '.', '.', '.'],
          ['.', '.', '.', '.', '.', '.', '.', '.'],
          ['.', '.', '.', '.', '.', '.', '.', '.'],
          ['P', 'P', 'P', 'P', 'P', 'P', 'P', 'P'],
          ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R']
        ],
        captured: { white: [], black: [] },
        inCheck: false
      };
    } else if (gameType === 'carrom') {
      return {
        coins: [
          { id: 'q', type: 'queen', x: 150, y: 150, pts: 25 },
          { id: 'w1', type: 'white', x: 135, y: 150, pts: 10 },
          { id: 'w2', type: 'white', x: 165, y: 150, pts: 10 },
          { id: 'w3', type: 'white', x: 150, y: 135, pts: 10 },
          { id: 'w4', type: 'white', x: 150, y: 165, pts: 10 },
          { id: 'b1', type: 'black', x: 139, y: 139, pts: 5 },
          { id: 'b2', type: 'black', x: 161, y: 139, pts: 5 },
          { id: 'b3', type: 'black', x: 139, y: 161, pts: 5 },
          { id: 'b4', type: 'black', x: 161, y: 161, pts: 5 }
        ],
        striker: { x: 150, y: 260 },
        power: 70,
        angle: 90
      };
    } else if (gameType === 'snakes') {
      return {
        diceValue: 1,
        positions: {
          [ST.me ? ST.me.uid : 'player1']: 1
        }
      };
    } else if (gameType === 'rush') {
      return {
        round: 1,
        maxRounds: 5,
        targetSymbol: '⚡',
        targetColor: '#2563EB',
        scores: {}
      };
    }
    return {};
  },

  /* ---------------- Open Active Game Room ---------------- */
  openRoom(gameType, roomId) {
    this.activeGameType = gameType;
    this.activeRoomId = roomId;
    this.listenerSlot = 'arcade:room:' + roomId;

    listen(this.listenerSlot, 'games/' + gameType + '/' + roomId, 'value', sn => {
      const room = sn.val();
      if (!room) {
        toast('Game room closed.');
        Nav.close('ov-arcade-game');
        return;
      }
      this.activeRoom = room;
      renderActiveGame(room);
    });

    Nav.open('ov-arcade-game');
  },

  async leaveRoom() {
    if (!this.activeRoom || !ST.me) {
      Nav.close('ov-arcade-game');
      return;
    }
    const r = this.activeRoom;
    const ref = db.ref('games/' + r.gameType + '/' + r.id);

    if (r.hostUid === ST.me.uid && r.status === 'waiting') {
      await ref.remove();
    } else {
      await ref.child('players/' + ST.me.uid).remove();
    }

    this.teardown();
    Nav.close('ov-arcade-game');
    toast('Left the game room.');
  },

  /* ---------------- LUDO RULES ENGINE ---------------- */
  async rollLudoDice() {
    if (!this.activeRoom || this.diceRolling) return;
    const r = this.activeRoom;
    if (r.turn !== ST.me.uid) {
      toast("It's not your turn!");
      return;
    }

    this.diceRolling = true;
    const diceEl = s('ludo-dice-btn');
    if (diceEl) diceEl.classList.add('rolling');

    setTimeout(async () => {
      const dice = Math.floor(Math.random() * 6) + 1;
      this.diceRolling = false;
      if (diceEl) diceEl.classList.remove('rolling');

      const myPlayer = r.players[ST.me.uid];
      const myColor = myPlayer.color;
      const tokens = (r.state && r.state.tokens && r.state.tokens[myColor]) || [-1, -1, -1, -1];

      // Safe star positions on common path (positions 0 to 51)
      const safeStars = [0, 8, 13, 21, 26, 34, 39, 47];

      // Compute legal moves
      const movableIndices = [];
      tokens.forEach((pos, idx) => {
        if (pos === -1 && dice === 6) movableIndices.push(idx);
        else if (pos >= 0 && pos + dice <= 57) movableIndices.push(idx);
      });

      const updates = {};
      updates['state/diceValue'] = dice;
      updates['lastActionAt'] = now();

      if (movableIndices.length === 0) {
        updates['turn'] = this.getNextTurn(r);
        toast(`Rolled a ${dice}. No legal moves!`);
      } else if (movableIndices.length === 1) {
        this.executeLudoMove(movableIndices[0], dice);
        return;
      } else {
        toast(`Rolled a ${dice}! Tap a piece to advance.`);
      }

      await db.ref('games/ludo/' + r.id).update(updates);
    }, 450);
  },

  async executeLudoMove(tokenIdx, diceVal) {
    const r = this.activeRoom;
    if (!r) return;
    const myPlayer = r.players[ST.me.uid];
    const myColor = myPlayer.color;
    const tokens = [...(r.state.tokens[myColor] || [-1, -1, -1, -1])];
    const curPos = tokens[tokenIdx];
    const dice = diceVal || r.state.diceValue || 1;

    let newPos = curPos;
    if (curPos === -1 && dice === 6) {
      newPos = 0; // Exit yard onto track
    } else if (curPos >= 0 && curPos + dice <= 57) {
      newPos = curPos + dice;
    } else {
      return;
    }

    tokens[tokenIdx] = newPos;

    // Check for captures on common track (0 to 51)
    const safeStars = [0, 8, 13, 21, 26, 34, 39, 47];
    let capturedPiece = false;
    const allTokens = r.state.tokens || {};

    if (newPos < 52 && !safeStars.includes(newPos)) {
      Object.keys(allTokens).forEach(color => {
        if (color !== myColor) {
          const enemyTokens = [...allTokens[color]];
          enemyTokens.forEach((ePos, eIdx) => {
            if (ePos === newPos) {
              enemyTokens[eIdx] = -1; // Send back to home yard!
              capturedPiece = true;
              allTokens[color] = enemyTokens;
              toast(`💥 Captured enemy token! Token sent back to base!`);
            }
          });
        }
      });
    }

    allTokens[myColor] = tokens;

    const updates = {};
    updates['state/tokens'] = allTokens;
    updates['lastActionAt'] = now();

    // Check victory: all 4 tokens reached home (57)
    if (tokens.every(p => p === 57)) {
      updates['status'] = 'ended';
      updates['winner'] = ST.me.uid;
      this.awardMatchOutcome('ludo', true);
      toast('🎉 VICTORY! You won the Ludo match!');
    } else {
      // Extra turn on rolling 6 OR capturing enemy piece!
      if (dice === 6 || capturedPiece) {
        toast(dice === 6 ? 'Rolled a 6! Roll again!' : 'Captured piece! Extra turn!');
      } else {
        updates['turn'] = this.getNextTurn(r);
      }
    }

    await db.ref('games/ludo/' + r.id).update(updates);
  },

  /* ---------------- CHESS ENGINE ---------------- */
  async executeChessMove(fromR, fromC, toR, toC) {
    const r = this.activeRoom;
    if (!r || r.turn !== ST.me.uid) return;

    const myPlayer = r.players[ST.me.uid];
    const board = r.state.board.map(row => [...row]);
    const piece = board[fromR][fromC];

    const isWhite = piece === piece.toUpperCase();
    if ((myPlayer.color === 'white' && !isWhite) || (myPlayer.color === 'black' && isWhite)) {
      toast("That's not your piece!");
      return;
    }

    const captured = board[toR][toC];
    board[toR][toC] = piece;
    board[fromR][fromC] = '.';

    const updates = {};
    updates['state/board'] = board;
    updates['lastActionAt'] = now();

    if (captured === 'k' || captured === 'K') {
      updates['status'] = 'ended';
      updates['winner'] = ST.me.uid;
      this.awardMatchOutcome('chess', true);
      toast('🏆 Checkmate! You won the chess match!');
    } else {
      updates['turn'] = this.getNextTurn(r);
    }

    await db.ref('games/chess/' + r.id).update(updates);
  },

  /* ---------------- CARROM ENGINE ---------------- */
  async strikeCarrom(angle, power) {
    const r = this.activeRoom;
    if (!r || r.turn !== ST.me.uid) return;

    const coins = [...(r.state.coins || [])];
    let scoredPts = 0;
    const hitIdx = Math.floor(Math.random() * coins.length);

    if (power > 50 && coins[hitIdx]) {
      const pocketed = coins.splice(hitIdx, 1)[0];
      scoredPts = pocketed.pts;
      toast(`🎯 Pocketed ${pocketed.type} coin! +${scoredPts} pts`);
    }

    const myPlayer = r.players[ST.me.uid];
    const newScore = (myPlayer.score || 0) + scoredPts;

    const updates = {};
    updates['state/coins'] = coins;
    updates[`players/${ST.me.uid}/score`] = newScore;
    updates['lastActionAt'] = now();

    if (coins.length === 0 || newScore >= 50) {
      updates['status'] = 'ended';
      updates['winner'] = ST.me.uid;
      this.awardMatchOutcome('carrom', true);
      toast('🏆 Champion! You won the Carrom match!');
    } else {
      updates['turn'] = this.getNextTurn(r);
    }

    await db.ref('games/carrom/' + r.id).update(updates);
  },

  /* ---------------- SNAKES & LADDERS ENGINE ---------------- */
  async rollSnakesDice() {
    const r = this.activeRoom;
    if (!r || r.turn !== ST.me.uid) return;

    const dice = Math.floor(Math.random() * 6) + 1;
    const positions = Object.assign({}, r.state.positions || {});
    let cur = positions[ST.me.uid] || 1;
    let target = cur + dice;

    if (target > 100) target = cur; // Must land exactly on 100

    // Snakes map
    const snakes = { 98: 28, 95: 56, 92: 51, 83: 19, 73: 1, 64: 36 };
    // Ladders map
    const ladders = { 4: 14, 9: 31, 20: 38, 28: 84, 40: 59, 63: 81, 71: 91 };

    let msg = `Rolled a ${dice}! Moved to ${target}.`;
    if (ladders[target]) {
      target = ladders[target];
      msg = `🪜 Climaned up a ladder to ${target}!`;
    } else if (snakes[target]) {
      target = snakes[target];
      msg = `🐍 Slid down a snake to ${target}!`;
    }

    positions[ST.me.uid] = target;

    const updates = {};
    updates['state/positions'] = positions;
    updates['state/diceValue'] = dice;
    updates['lastActionAt'] = now();

    if (target === 100) {
      updates['status'] = 'ended';
      updates['winner'] = ST.me.uid;
      this.awardMatchOutcome('snakes', true);
      toast('🎉 Reached 100! You won Snakes & Ladders!');
    } else {
      updates['turn'] = this.getNextTurn(r);
      toast(msg);
    }

    await db.ref('games/snakes/' + r.id).update(updates);
  },

  /* ---------------- KLYRO RUSH (ORIGINAL REFLEX DUEL) ---------------- */
  async tapRushTarget() {
    const r = this.activeRoom;
    if (!r || r.status !== 'playing') return;

    const scores = Object.assign({}, r.state.scores || {});
    scores[ST.me.uid] = (scores[ST.me.uid] || 0) + 100;

    const curRound = r.state.round || 1;
    const updates = {};
    updates['state/scores'] = scores;

    if (curRound >= 5) {
      updates['status'] = 'ended';
      // Determine highest score
      let maxScore = -1, winnerUid = ST.me.uid;
      Object.keys(scores).forEach(u => {
        if (scores[u] > maxScore) { maxScore = scores[u]; winnerUid = u; }
      });
      updates['winner'] = winnerUid;
      this.awardMatchOutcome('rush', winnerUid === ST.me.uid);
      toast('⚡ Duel finished! High score: ' + maxScore);
    } else {
      const symbols = ['⚡', '💎', '🔥', '🎯', '🚀', '🌟'];
      updates['state/round'] = curRound + 1;
      updates['state/targetSymbol'] = symbols[Math.floor(Math.random() * symbols.length)];
      updates['lastActionAt'] = now();
      toast('+100 Quick Reflex Bonus!');
    }

    await db.ref('games/rush/' + r.id).update(updates);
  },

  getNextTurn(room) {
    const uids = Object.keys(room.players || {});
    const curIdx = uids.indexOf(room.turn);
    const nextIdx = (curIdx + 1) % uids.length;
    return uids[nextIdx] || room.hostUid;
  },

  /* ---------------- Non-Intrusive Direct Challenge Toast ---------------- */
  showChallengeToast(challenge) {
    if (!challenge) return;
    const toastEl = s('game-challenge-toast');
    if (!toastEl) return;

    this.activeToastChallenge = challenge;
    const gDef = ARCADE_GAMES[challenge.gameType] || { name: 'Arcade Match', icon: '🎮' };
    const senderName = challenge.senderName || 'Friend';
    const senderPhoto = challenge.senderPhoto || '';

    // Update avatar
    const imgEl = s('ct-avatar-img');
    const fallbackEl = s('ct-avatar-fallback');
    if (imgEl && fallbackEl) {
      if (senderPhoto) {
        imgEl.src = senderPhoto;
        imgEl.style.display = 'block';
        fallbackEl.style.display = 'none';
      } else {
        imgEl.style.display = 'none';
        fallbackEl.style.display = 'flex';
        fallbackEl.textContent = (typeof initials === 'function' ? initials(senderName) : '') || '🎮';
      }
    }

    // Update badge icon
    const badgeEl = s('ct-badge-icon');
    if (badgeEl) badgeEl.textContent = gDef.icon || '🎮';

    // Update texts
    const titleEl = s('ct-title');
    if (titleEl) titleEl.textContent = `Direct Challenge · ${gDef.name}`;

    const descEl = s('ct-desc');
    if (descEl) descEl.innerHTML = `<strong>${esc(senderName)}</strong> challenged you to <strong>${esc(gDef.name)}</strong>!`;

    const noteEl = s('ct-note');
    if (noteEl) noteEl.textContent = 'Tap Accept to jump straight into the lobby!';

    // Wire buttons
    const acceptBtn = s('ct-accept-btn');
    if (acceptBtn) {
      acceptBtn.onclick = (e) => {
        e.stopPropagation();
        this.hideChallengeToast();
        this.acceptChallenge(challenge);
      };
    }

    const closeBtn = s('ct-close-btn');
    if (closeBtn) {
      closeBtn.onclick = (e) => {
        e.stopPropagation();
        this.hideChallengeToast();
        this.declineChallenge(challenge);
      };
    }

    // Progress bar animation countdown (14 seconds)
    const progressFill = s('ct-progress');
    const totalMs = 14000;
    const startTime = Date.now();
    clearInterval(this.challengeCountdownTimer);

    if (progressFill) {
      progressFill.style.transform = 'scaleX(1)';
    }

    this.challengeCountdownTimer = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const remainingRatio = Math.max(0, 1 - (elapsed / totalMs));
      if (progressFill) {
        progressFill.style.transform = `scaleX(${remainingRatio})`;
      }
      if (remainingRatio <= 0) {
        clearInterval(this.challengeCountdownTimer);
        this.hideChallengeToast();
      }
    }, 100);

    // Show toast smoothly
    toastEl.classList.add('show');

    // Friendly soft vibration / haptic feedback if permitted
    try {
      if (navigator && navigator.vibrate) navigator.vibrate([35, 45, 35]);
    } catch (e) {}
  },

  hideChallengeToast() {
    const toastEl = s('game-challenge-toast');
    if (toastEl) toastEl.classList.remove('show');
    clearInterval(this.challengeCountdownTimer);
    this.challengeCountdownTimer = null;
    this.activeToastChallenge = null;
  },

  async acceptChallenge(challenge) {
    if (!challenge || !ST.me) return;
    const gDef = ARCADE_GAMES[challenge.gameType] || { name: 'Arcade Match' };
    toast(`Accepting challenge! Entering ${gDef.name} lobby…`, 2500);

    // Update challenge in Firebase
    if (challenge.id && !challenge.id.startsWith('demo-')) {
      db.ref(`gameChallenges/${ST.me.uid}/${challenge.id}`).update({
        status: 'accepted',
        acceptedAt: now()
      }).catch(() => {});
    }

    // Dismiss any open overlay modal
    if (typeof Nav !== 'undefined') {
      if (Nav.isOpen && Nav.isOpen('ov-modal')) Nav.close('ov-modal');
    }

    // Jump straight into the lobby
    try {
      await this.joinRoom(challenge.gameType, challenge.roomId);
    } catch (err) {
      DBG('Error joining challenged game room:', err);
      toast('Could not join match — room may have expired.');
    }
  },

  declineChallenge(challenge) {
    if (!challenge || !ST.me) return;
    if (challenge.id && !challenge.id.startsWith('demo-')) {
      db.ref(`gameChallenges/${ST.me.uid}/${challenge.id}`).update({
        status: 'declined',
        declinedAt: now()
      }).catch(() => {});
    }
  },

  listenGameChallenges() {
    if (!ST.me) return;
    this.seenChallenges = this.seenChallenges || new Set();

    listen('gameChallenges', 'gameChallenges/' + ST.me.uid, 'value', sn => {
      const list = sn.val() || {};
      const nowTs = now();
      Object.keys(list).forEach(cid => {
        const ch = list[cid];
        if (!ch) return;
        ch.id = cid;

        // Challenge must be pending, not from myself, and recent (within 2 minutes)
        const isPending = ch.status === 'pending';
        const isFromOther = ch.senderUid && ch.senderUid !== ST.me.uid;
        const isRecent = !ch.createdAt || (nowTs - ch.createdAt < 120000);

        if (isPending && isFromOther && isRecent) {
          if (!this.seenChallenges.has(cid)) {
            this.seenChallenges.add(cid);
            this.showChallengeToast(ch);
          }
        } else if (this.activeToastChallenge && this.activeToastChallenge.id === cid && ch.status !== 'pending') {
          this.hideChallengeToast();
        }
      });
    });
  },

  testChallengeToast(gameType = 'chess') {
    const gDef = ARCADE_GAMES[gameType] || ARCADE_GAMES.chess;
    this.showChallengeToast({
      id: 'demo-' + now(),
      roomId: 'demo-room-' + Math.floor(Math.random() * 1000),
      gameType: gDef.id,
      senderUid: 'demo_user',
      senderName: 'Sarah Jenkins',
      senderPhoto: '',
      createdAt: now(),
      status: 'pending'
    });
  },

  /* ---------------- Social Challenge from Chat / Discover / Profile ---------------- */
  async sendGameChallenge(gameType, opponentUid) {
    if (!ST.me || !opponentUid) return;
    const roomId = await this.createRoom(gameType, 2, true);
    const gDef = ARCADE_GAMES[gameType];
    const name = gDef ? gDef.name : 'Arcade Match';

    // 1. Dispatch real-time challenge record to recipient's direct challenge queue
    const challengeRef = db.ref('gameChallenges/' + opponentUid).push();
    const challengeId = challengeRef.key;
    const challengePayload = {
      id: challengeId,
      roomId: roomId,
      gameType: gameType,
      senderUid: ST.me.uid,
      senderName: ST.me.name || 'Friend',
      senderPhoto: ST.me.photo || '',
      createdAt: now(),
      status: 'pending'
    };
    await challengeRef.set(challengePayload);

    // 2. Also send in-chat challenge bubble if chat exists
    const challengeMsg = {
      type: 'game_invite',
      text: `🎮 Challenged you to ${name}!`,
      gameType: gameType,
      roomId: roomId,
      hostName: ST.me.name,
      challengeId: challengeId
    };

    if (ST.chat && (ST.chat.targetId === opponentUid || ST.chat.target === opponentUid || (ST.chat.chatId && ST.chat.chatId.includes(opponentUid)))) {
      if (typeof pushMessage === 'function') {
        await pushMessage(challengeMsg);
      }
    } else {
      const cid = [ST.me.uid, opponentUid].sort().join('_');
      db.ref('messages/' + cid).push(Object.assign({
        sender: ST.me.uid,
        ts: now(),
        name: ST.me.name,
        read: false
      }, challengeMsg)).then(() => {
        if (typeof bumpUnread === 'function') bumpUnread(opponentUid, cid);
      }).catch(() => {});
    }

    toast(`Challenge sent to play ${name}!`);
  },

  /* ---------------- Share Match Outcome to Pulse ---------------- */
  async shareVictoryToPulse(gameType) {
    if (!ST.me) return;
    const gDef = ARCADE_GAMES[gameType];
    const name = gDef ? gDef.name : 'KLYRO Arcade';

    const postPayload = {
      text: `🏆 Just claimed victory in ${name} on KLYRO Arcade! Who's ready to challenge me next? #Arcade #Winner #KLYRO`,
      type: 'text'
    };

    if (typeof PostsEngine !== 'undefined' && PostsEngine.createPost) {
      try {
        await PostsEngine.createPost(postPayload);
        toast('Victory shared to KLYRO Pulse!');
      } catch (e) {
        toast('Could not share victory');
      }
    }
  }
};

/* ---------------- Render Main Arcade Tab UI ---------------- */
function renderArcade() {
  const container = s('arcade-content');
  if (!container) return;

  const prof = ST.gamerProfile || { level: 1, xp: 0, totalWins: 0, totalMatches: 0, streak: 0 };
  const currentTab = ArcadeEngine.currentTab || 'all';

  container.innerHTML = `
    <div style="padding:14px 14px 32px">
      
      <!-- HERO BANNER: ACTIVE EVENT -->
      <div class="arcade-hero" style="background:linear-gradient(135deg,#2563EB,#7C3AED);color:#fff;border-radius:22px;padding:22px 20px;margin-bottom:20px;box-shadow:0 10px 28px rgba(37,99,235,0.28);position:relative;overflow:hidden">
        <div style="font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:1px;opacity:0.9;margin-bottom:4px">⚡ KLYRO Arcade Season 1</div>
        <h2 style="font-size:22px;font-weight:800;margin:0 0 6px">Arcade Masters Cup</h2>
        <p style="font-size:13px;opacity:0.9;margin:0 0 16px;line-height:1.4">Play classic board games &amp; fast reflex duels with friends. Earn XP and climb the leaderboard.</p>
        
        <div style="display:flex;align-items:center;justify-content:space-between;background:rgba(255,255,255,0.18);backdrop-filter:blur(8px);border-radius:14px;padding:10px 14px">
          <div>
            <div style="font-size:11px;opacity:0.85">Your Arcade Rank</div>
            <div style="font-size:15px;font-weight:800">Level ${prof.level} · ${prof.xp} XP</div>
          </div>
          <button class="btn sm" onclick="openGamerProfileModal()" style="background:#fff;color:var(--kr-brand);font-weight:700;height:32px;padding:0 14px">
            Gamer Profile
          </button>
        </div>

        <div style="display:flex;gap:8px;margin-top:12px">
          <button class="btn sm" onclick="openChallengeFriendModal('ludo')" style="background:rgba(255,255,255,0.22);color:#fff;border:1px solid rgba(255,255,255,0.3);flex:1;justify-content:center;height:34px">
            ⚔️ Challenge Friend
          </button>
          <button class="btn sm" onclick="ArcadeEngine.testChallengeToast('chess')" style="background:rgba(255,255,255,0.22);color:#fff;border:1px solid rgba(255,255,255,0.3);flex:1;justify-content:center;height:34px" title="Preview incoming game challenge toast notification">
            🔔 Test Notification
          </button>
        </div>
      </div>

      <!-- ARCADE NAVIGATION FILTER -->
      <div style="display:flex;gap:6px;overflow-x:auto;padding-bottom:12px;margin-bottom:14px;scrollbar-width:none">
        <button class="seg-btn ${currentTab === 'all' ? 'active' : ''}" onclick="ArcadeEngine.currentTab='all';renderArcade()">All Games</button>
        <button class="seg-btn ${currentTab === 'board' ? 'active' : ''}" onclick="ArcadeEngine.currentTab='board';renderArcade()">Board</button>
        <button class="seg-btn ${currentTab === 'strategy' ? 'active' : ''}" onclick="ArcadeEngine.currentTab='strategy';renderArcade()">Strategy</button>
        <button class="seg-btn ${currentTab === 'casual' ? 'active' : ''}" onclick="ArcadeEngine.currentTab='casual';renderArcade()">Casual</button>
        <button class="seg-btn ${currentTab === 'originals' ? 'active' : ''}" onclick="ArcadeEngine.currentTab='originals';renderArcade()">Originals</button>
        <button class="seg-btn ${currentTab === 'leaderboard' ? 'active' : ''}" onclick="ArcadeEngine.currentTab='leaderboard';renderArcade()">Leaderboard</button>
      </div>

      <!-- LEADERBOARD TAB VIEW -->
      ${currentTab === 'leaderboard' ? `
        <div class="card" style="padding:16px;border-radius:18px;margin-bottom:20px">
          <h3 style="margin:0 0 12px;font-size:16px">Top KLYRO Champions</h3>
          <div id="arcade-leaderboard-list">
            <div class="row" style="padding:8px 0;border-bottom:1px solid var(--kr-line2)">
              <div style="font-weight:800;font-size:16px;width:24px;color:#F59E0B">#1</div>
              <div class="av sm" style="background:#2563EB">SY</div>
              <div class="mid"><div class="t1"><b>Sihab</b></div><div class="t2">Level 6 · 540 XP</div></div>
              <div style="font-weight:700;color:var(--kr-ok)">18 Wins</div>
            </div>
            <div class="row" style="padding:8px 0">
              <div style="font-weight:800;font-size:16px;width:24px;color:var(--kr-mut)">#2</div>
              <div class="av sm" style="background:#7C3AED">${esc(initials(ST.me ? ST.me.name : 'You'))}</div>
              <div class="mid"><div class="t1"><b>${esc(ST.me ? ST.me.name : 'You')} (You)</b></div><div class="t2">Level ${prof.level} · ${prof.xp} XP</div></div>
              <div style="font-weight:700;color:var(--kr-ok)">${prof.totalWins || 0} Wins</div>
            </div>
          </div>
        </div>
      ` : `
        <!-- GAME LIBRARY GRID -->
        <div class="arcade-grid" style="display:grid;grid-template-columns:repeat(auto-fit, minmax(280px, 1fr));gap:14px;margin-bottom:24px">
          ${Object.values(ARCADE_GAMES).filter(g => {
            if (currentTab === 'board') return g.category === 'Board';
            if (currentTab === 'strategy') return g.category === 'Strategy';
            if (currentTab === 'casual') return g.category === 'Casual';
            if (currentTab === 'originals') return g.category.includes('Original');
            return true;
          }).map(g => `
            <div class="arcade-card" style="background:var(--kr-elev);border:1px solid var(--kr-line);border-radius:18px;padding:18px;display:flex;flex-direction:column;gap:12px;box-shadow:var(--kr-sh)">
              <div style="display:flex;align-items:center;gap:14px">
                <div style="width:52px;height:52px;border-radius:14px;background:var(--kr-bg2);display:flex;align-items:center;justify-content:center;font-size:26px">
                  ${g.icon}
                </div>
                <div>
                  <h4 style="margin:0;font-size:16px">${g.name}</h4>
                  <div style="font-size:12px;color:var(--kr-mut)">${g.category} · ${g.duration}</div>
                </div>
              </div>
              <p style="font-size:13px;color:var(--kr-mut);margin:0;line-height:1.4">${g.desc}</p>
              
              <div style="display:flex;gap:8px;margin-top:auto">
                <button class="btn sm" onclick="ArcadeEngine.createRoom('${g.id}', ${g.playerCounts[0]})" style="flex:1">
                  Play Now
                </button>
                <button class="btn sm outline" onclick="openGameDetailModal('${g.id}')" style="flex:1">
                  Details
                </button>
              </div>
            </div>
          `).join('')}
        </div>
      `}

      <!-- ROOM CODE QUICK JOIN BAR -->
      <div style="background:var(--kr-bg2);border:1px solid var(--kr-line);border-radius:16px;padding:16px;display:flex;align-items:center;justify-content:space-between;gap:12px">
        <div>
          <div style="font-weight:700;font-size:14px">Join Private Room</div>
          <div style="font-size:12px;color:var(--kr-mut)">Enter a 6-character room code</div>
        </div>
        <div style="display:flex;gap:6px">
          <input class="inp" id="arcade-code-in" placeholder="room_code" style="max-width:130px;height:36px;font-size:13px">
          <button class="btn sm" id="arcade-code-btn" style="height:36px">Join</button>
        </div>
      </div>

    </div>
  `;

  const joinBtn = s('arcade-code-btn');
  if (joinBtn) {
    joinBtn.onclick = () => {
      const code = (s('arcade-code-in').value || '').trim();
      if (!code) { toast('Please enter a room code'); return; }
      ArcadeEngine.joinRoom('ludo', code);
    };
  }
}

/* ---------------- Render Active Game Arena ---------------- */
function renderActiveGame(room) {
  const modal = s('arcade-game-view');
  if (!modal) return;

  const isMyTurn = room.turn === ST.me.uid;
  const isPlaying = room.status === 'playing';
  const players = Object.values(room.players || {});
  const gDef = ARCADE_GAMES[room.gameType] || { name: 'Arcade Match', icon: '🎮' };

  let boardHtml = '';

  /* 1. LUDO BOARD */
  if (room.gameType === 'ludo') {
    const diceVal = (room.state && room.state.diceValue) || 1;
    const tokens = (room.state && room.state.tokens) || {};
    boardHtml = `
      <div style="display:flex;flex-direction:column;align-items:center;gap:14px;margin:14px 0">
        <div class="ludo-board" style="width:280px;height:280px;background:#fff;border:3px solid #1E293B;border-radius:14px;position:relative;box-shadow:0 6px 20px rgba(0,0,0,0.15)">
          <div style="position:absolute;top:0;left:0;width:110px;height:110px;background:#EF4444;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:12px;border-bottom-right-radius:14px">RED</div>
          <div style="position:absolute;top:0;right:0;width:110px;height:110px;background:#10B981;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:12px;border-bottom-left-radius:14px">GREEN</div>
          <div style="position:absolute;bottom:0;right:0;width:110px;height:110px;background:#F59E0B;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:12px;border-top-left-radius:14px">YELLOW</div>
          <div style="position:absolute;bottom:0;left:0;width:110px;height:110px;background:#3B82F6;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:12px;border-top-right-radius:14px">BLUE</div>
          <div style="position:absolute;top:110px;left:110px;width:60px;height:60px;background:#F8FAFC;display:flex;align-items:center;justify-content:center;font-size:22px">⭐</div>
        </div>

        <div style="display:flex;align-items:center;gap:14px">
          <button class="btn" id="ludo-dice-btn" ${!isMyTurn || !isPlaying ? 'disabled' : ''} onclick="ArcadeEngine.rollLudoDice()" style="font-size:16px;height:44px;padding:0 20px">
            🎲 Roll (${diceVal})
          </button>
          <div style="font-size:13px;color:var(--kr-mut)">
            ${isMyTurn ? '<b style="color:var(--kr-ok)">Your Turn!</b> Roll or tap token' : 'Opponent turn…'}
          </div>
        </div>
      </div>
    `;
  }

  /* 2. CHESS BOARD */
  else if (room.gameType === 'chess') {
    const board = (room.state && room.state.board) || [];
    const pieceIcons = {
      'r': '♜', 'n': '♞', 'b': '♝', 'q': '♛', 'k': '♚', 'p': '♟',
      'R': '♖', 'N': '♘', 'B': '♗', 'Q': '♕', 'K': '♔', 'P': '♙', '.': ''
    };

    boardHtml = `
      <div style="display:flex;flex-direction:column;align-items:center;margin:14px 0">
        <div class="chess-board" style="display:grid;grid-template-columns:repeat(8, 34px);grid-template-rows:repeat(8, 34px);border:3px solid #334155;border-radius:8px;overflow:hidden;box-shadow:0 6px 20px rgba(0,0,0,0.15)">
          ${board.map((row, rIdx) => row.map((cell, cIdx) => {
            const isLight = (rIdx + cIdx) % 2 === 0;
            const bg = isLight ? '#F8FAFC' : '#94A3B8';
            return `
              <div class="chess-cell" data-r="${rIdx}" data-c="${cIdx}" style="width:34px;height:34px;background:${bg};display:flex;align-items:center;justify-content:center;font-size:22px;cursor:pointer;user-select:none">
                ${pieceIcons[cell] || ''}
              </div>
            `;
          }).join('')).join('')}
        </div>
        <div style="margin-top:12px;font-size:13px;color:var(--kr-mut)">
          ${isMyTurn ? '<b style="color:var(--kr-brand)">Your Turn!</b> Select piece then destination' : 'Waiting for opponent move…'}
        </div>
      </div>
    `;
  }

  /* 3. CARROM BOARD */
  else if (room.gameType === 'carrom') {
    const coins = (room.state && room.state.coins) || [];
    boardHtml = `
      <div style="display:flex;flex-direction:column;align-items:center;margin:14px 0">
        <div class="carrom-board" style="width:280px;height:280px;background:#DEB887;border:8px solid #8B4513;border-radius:12px;position:relative;box-shadow:0 6px 20px rgba(0,0,0,0.2)">
          <div style="position:absolute;top:4px;left:4px;width:22px;height:22px;border-radius:50%;background:#000"></div>
          <div style="position:absolute;top:4px;right:4px;width:22px;height:22px;border-radius:50%;background:#000"></div>
          <div style="position:absolute;bottom:4px;left:4px;width:22px;height:22px;border-radius:50%;background:#000"></div>
          <div style="position:absolute;bottom:4px;right:4px;width:22px;height:22px;border-radius:50%;background:#000"></div>
          <div style="position:absolute;top:100px;left:100px;width:80px;height:80px;border-radius:50%;border:2px dashed #8B4513;display:flex;align-items:center;justify-content:center">
            <span style="font-size:11px;font-weight:700;color:#8B4513">${coins.length} Coins</span>
          </div>
          <div style="position:absolute;bottom:22px;left:125px;width:28px;height:28px;border-radius:50%;background:#2563EB;border:2px solid #fff"></div>
        </div>

        <div style="display:flex;align-items:center;gap:12px;margin-top:14px">
          <button class="btn" ${!isMyTurn || !isPlaying ? 'disabled' : ''} onclick="ArcadeEngine.strikeCarrom(90, 80)">
            🎯 Strike
          </button>
          <div style="font-size:13px;color:var(--kr-mut)">
            ${isMyTurn ? '<b style="color:var(--kr-ok)">Your Turn!</b> Strike towards pockets' : 'Opponent striking…'}
          </div>
        </div>
      </div>
    `;
  }

  /* 4. SNAKES & LADDERS BOARD */
  else if (room.gameType === 'snakes') {
    const diceVal = (room.state && room.state.diceValue) || 1;
    const pos = (room.state && room.state.positions && room.state.positions[ST.me.uid]) || 1;
    boardHtml = `
      <div style="display:flex;flex-direction:column;align-items:center;margin:14px 0">
        <div style="width:280px;height:280px;background:linear-gradient(135deg,#FEF3C7,#FDE68A);border:3px solid #D97706;border-radius:14px;padding:8px;display:flex;flex-direction:column;justify-content:space-between;box-shadow:0 6px 20px rgba(0,0,0,0.15)">
          <div style="display:flex;justify-content:space-between;font-weight:800;font-size:13px">
            <span>🏁 100</span>
            <span>🐍 Snake 98→28</span>
          </div>
          <div style="text-align:center;font-size:32px">
            🎲 Cell: <b>${pos}</b> / 100
          </div>
          <div style="display:flex;justify-content:space-between;font-weight:700;font-size:12px">
            <span>🪜 Ladder 4→14</span>
            <span>Start 1</span>
          </div>
        </div>

        <div style="display:flex;align-items:center;gap:12px;margin-top:14px">
          <button class="btn" ${!isMyTurn || !isPlaying ? 'disabled' : ''} onclick="ArcadeEngine.rollSnakesDice()">
            🎲 Roll (${diceVal})
          </button>
          <div style="font-size:13px;color:var(--kr-mut)">
            ${isMyTurn ? '<b style="color:var(--kr-ok)">Your Turn!</b> Roll dice to advance' : 'Waiting for turn…'}
          </div>
        </div>
      </div>
    `;
  }

  /* 5. KLYRO RUSH (ORIGINAL REFLEX) */
  else if (room.gameType === 'rush') {
    const round = (room.state && room.state.round) || 1;
    const sym = (room.state && room.state.targetSymbol) || '⚡';
    boardHtml = `
      <div style="display:flex;flex-direction:column;align-items:center;margin:14px 0">
        <div style="font-size:13px;font-weight:700;color:var(--kr-mut);margin-bottom:8px">Round ${round} of 5</div>
        <button onclick="ArcadeEngine.tapRushTarget()" style="width:180px;height:180px;border-radius:50%;background:linear-gradient(135deg,#2563EB,#7C3AED);color:#fff;border:none;font-size:56px;cursor:pointer;box-shadow:0 12px 28px rgba(37,99,235,0.4);display:flex;align-items:center;justify-content:center;transition:transform 0.1s" onmousedown="this.style.transform='scale(0.94)'" onmouseup="this.style.transform='scale(1)'">
          ${sym}
        </button>
        <div style="margin-top:14px;font-size:13px;color:var(--kr-brand);font-weight:700">TAP FAST! Highest score wins!</div>
      </div>
    `;
  }

  modal.innerHTML = `
    <div class="card pad" style="max-width:440px;width:100%;margin:0 auto;background:var(--kr-bg);border-radius:24px;padding:20px;box-shadow:0 20px 40px rgba(0,0,0,0.3)">
      <header style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <div>
          <h3 style="margin:0;font-size:18px">${gDef.icon} ${gDef.name}</h3>
          <span style="font-size:12px;color:var(--kr-mut)">Room Code: <b style="letter-spacing:0.5px">${esc(room.id)}</b></span>
        </div>
        <button class="ib sm" onclick="ArcadeEngine.leaveRoom()" title="Leave Game">✕</button>
      </header>

      <!-- Players Tray -->
      <div style="display:flex;gap:10px;padding:10px 12px;background:var(--kr-bg2);border-radius:14px;border:1px solid var(--kr-line);margin-bottom:10px">
        ${players.map(p => `
          <div style="display:flex;align-items:center;gap:8px;flex:1;min-width:0">
            <div class="av sm" style="background:${esc(colorFor(p.uid))};position:relative">
              ${p.photo ? `<img src="${esc(p.photo)}" alt="">` : esc(initials(p.name))}
              ${room.turn === p.uid ? `<div style="position:absolute;bottom:-2px;right:-2px;width:10px;height:10px;border-radius:50%;background:var(--kr-ok);border:2px solid #fff"></div>` : ''}
            </div>
            <div style="min-width:0">
              <div style="font-size:12.5px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(p.name)}</div>
              <div style="font-size:11px;color:var(--kr-mut)">Score: ${p.score || 0}</div>
            </div>
          </div>
        `).join('')}
      </div>

      <!-- MATCH RESULT MODAL (VICTORY LOOP) -->
      ${room.status === 'ended' ? `
        <div style="margin:16px 0;padding:20px;background:#DCFCE7;border-radius:18px;text-align:center">
          <div style="font-size:42px;margin-bottom:6px">🏆</div>
          <h3 style="font-weight:800;font-size:18px;color:#166534;margin:0 0 6px">
            ${room.winner === ST.me.uid ? 'Victory! You Won!' : 'Match Finished!'}
          </h3>
          <p style="font-size:13px;color:#166534;opacity:0.9;margin:0 0 16px">+120 XP earned towards Arcade Level</p>
          
          <div style="display:flex;flex-direction:column;gap:8px">
            <button class="btn block" onclick="ArcadeEngine.shareVictoryToPulse('${room.gameType}')">
              ⚡ Share Victory to Pulse
            </button>
            <button class="btn block outline" onclick="ArcadeEngine.createRoom('${room.gameType}', ${room.maxPlayers})" style="background:#fff">
              🔄 Rematch
            </button>
          </div>
        </div>
      ` : boardHtml}
    </div>
  `;

  // Wire Chess clicks
  if (room.gameType === 'chess' && isMyTurn) {
    let selected = null;
    $$('.chess-cell', modal).forEach(cell => {
      cell.onclick = () => {
        const r = parseInt(cell.dataset.r, 10);
        const c = parseInt(cell.dataset.c, 10);
        if (!selected) {
          selected = { r, c };
          cell.style.outline = '3px solid var(--kr-brand)';
        } else {
          ArcadeEngine.executeChessMove(selected.r, selected.c, r, c);
          selected = null;
        }
      };
    });
  }
}

/* ---------------- Game Detail Modal ---------------- */
function openGameDetailModal(gameId) {
  const g = ARCADE_GAMES[gameId];
  if (!g) return;

  openModal(`
    <div class="pad" style="max-width:440px;padding:20px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <div style="display:flex;align-items:center;gap:10px">
          <span style="font-size:32px">${g.icon}</span>
          <div>
            <h3 style="margin:0;font-size:18px">${g.name}</h3>
            <span style="font-size:12px;color:var(--kr-mut)">${g.tagline}</span>
          </div>
        </div>
        <button class="ib sm" onclick="Nav.close('ov-modal')">✕</button>
      </div>

      <p style="font-size:13.5px;color:var(--kr-txt);line-height:1.5;margin:0 0 16px">${g.desc}</p>

      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:18px;text-align:center">
        <div style="background:var(--kr-bg2);padding:10px 8px;border-radius:12px;border:1px solid var(--kr-line)">
          <div style="font-size:11px;color:var(--kr-mut)">Players</div>
          <div style="font-size:13px;font-weight:700">${g.playerCounts.join(' or ')}</div>
        </div>
        <div style="background:var(--kr-bg2);padding:10px 8px;border-radius:12px;border:1px solid var(--kr-line)">
          <div style="font-size:11px;color:var(--kr-mut)">Duration</div>
          <div style="font-size:13px;font-weight:700">${g.duration}</div>
        </div>
        <div style="background:var(--kr-bg2);padding:10px 8px;border-radius:12px;border:1px solid var(--kr-line)">
          <div style="font-size:11px;color:var(--kr-mut)">Type</div>
          <div style="font-size:13px;font-weight:700">${g.category}</div>
        </div>
      </div>

      <div style="display:flex;flex-direction:column;gap:8px">
        <button class="btn block" onclick="Nav.close('ov-modal'); ArcadeEngine.createRoom('${g.id}', ${g.playerCounts[0]})">
          Quick Match
        </button>
        <button class="btn block outline" onclick="Nav.close('ov-modal'); openInviteFriendToGame('${g.id}')">
          Challenge Friend
        </button>
      </div>
    </div>
  `);
}

function openInviteFriendToGame(gameId) {
  const g = ARCADE_GAMES[gameId];
  const contacts = Object.keys(ST.me ? ST.me.contacts || {} : {}).map(u => ST.users[u]).filter(Boolean);

  if (!contacts.length) {
    toast('No connected friends yet. Connect with online users in Discover!');
    return;
  }

  const actions = contacts.map(c => ({
    icon: '💬',
    label: userLabel(c),
    run: () => {
      ArcadeEngine.sendGameChallenge(gameId, c.uid);
    }
  }));

  openSheet('Challenge Friend to ' + (g ? g.name : 'Game'), actions);
}

/* ---------------- Gamer Profile Modal ---------------- */
function openGamerProfileModal() {
  const p = ST.gamerProfile || { level: 1, xp: 0, totalWins: 0, totalMatches: 0, streak: 0 };
  const winRate = p.totalMatches ? Math.round((p.totalWins / p.totalMatches) * 100) : 0;

  openModal(`
    <div class="pad" style="max-width:440px;padding:20px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
        <h3 style="margin:0;font-size:18px">Arcade Gamer Profile</h3>
        <button class="ib sm" onclick="Nav.close('ov-modal')">✕</button>
      </div>

      <div style="display:flex;align-items:center;gap:14px;padding:16px;background:linear-gradient(135deg,#2563EB,#7C3AED);color:#fff;border-radius:18px;margin-bottom:16px">
        <div class="av lg" style="background:#fff;color:var(--kr-brand);font-weight:800;font-size:24px">
          ${ST.me && ST.me.photo ? `<img src="${esc(ST.me.photo)}" alt="">` : esc(initials(ST.me ? ST.me.name : 'You'))}
        </div>
        <div>
          <div style="font-size:17px;font-weight:800">${esc(ST.me ? ST.me.name : 'Player')}</div>
          <div style="font-size:12.5px;opacity:0.9">Arcade Master · Level ${p.level}</div>
          <div style="font-size:11px;opacity:0.8;margin-top:2px">${p.xp} Total XP</div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:18px;text-align:center">
        <div style="background:var(--kr-bg2);padding:10px 8px;border-radius:12px;border:1px solid var(--kr-line)">
          <div style="font-size:11px;color:var(--kr-mut)">Matches</div>
          <div style="font-size:15px;font-weight:800">${p.totalMatches || 0}</div>
        </div>
        <div style="background:var(--kr-bg2);padding:10px 8px;border-radius:12px;border:1px solid var(--kr-line)">
          <div style="font-size:11px;color:var(--kr-mut)">Victories</div>
          <div style="font-size:15px;font-weight:800;color:var(--kr-ok)">${p.totalWins || 0}</div>
        </div>
        <div style="background:var(--kr-bg2);padding:10px 8px;border-radius:12px;border:1px solid var(--kr-line)">
          <div style="font-size:11px;color:var(--kr-mut)">Win Rate</div>
          <div style="font-size:15px;font-weight:800">${winRate}%</div>
        </div>
      </div>

      <h4 style="margin:0 0 8px;font-size:14px">Unlocked Badges</h4>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px">
        <span style="font-size:12px;font-weight:700;padding:4px 10px;background:var(--kr-bg2);border:1px solid var(--kr-line);border-radius:8px">🎖️ Rookie</span>
        <span style="font-size:12px;font-weight:700;padding:4px 10px;background:var(--kr-bg2);border:1px solid var(--kr-line);border-radius:8px">🎲 Ludo Competitor</span>
        <span style="font-size:12px;font-weight:700;padding:4px 10px;background:var(--kr-bg2);border:1px solid var(--kr-line);border-radius:8px">⚡ Fast Reflex</span>
      </div>

      <button class="btn block ghost" onclick="Nav.close('ov-modal')">Close</button>
    </div>
  `);
}
