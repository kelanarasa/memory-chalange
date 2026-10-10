/* ==========================================================
   Memory Challenge - game.js
   Seluruh logika permainan ada di file ini.

   Alur permainan (fase / "phase"):
     idle     -> belum mulai
     memorize -> gambar ditampilkan, pemain menghafal
     hiding   -> gambar sedang menghilang (animasi singkat)
     solve    -> pemain mengisi kotak kosong (timer pengerjaan berjalan)
     result   -> jawaban sudah diperiksa / waktu habis (menunggu tombol)

   Aturan permainan:
     - Ada 3 level. Level 1 dan 2 masing-masing 10 sesi.
       Level 3 tanpa batas sesi: terus berlanjut sampai ada jawaban salah.
     - Jawaban salah atau waktu mengerjakan habis = GUGUR,
       permainan diulang dari Level 1 sesi 1.

   Seluruh kode dibungkus IIFE agar variabel (termasuk kunci jawaban)
   tidak bocor menjadi variabel global di browser.
   ========================================================== */
(() => {
  'use strict';

  // Suara (musik & efek) berasal dari audio.js.
  // Jika audio.js tidak dimuat, semua pemanggilan di bawah diabaikan begitu saja.
  const S = window.Suara || new Proxy({}, { get: () => () => {} });

  /* ========================================================
     1. DATA & PENGATURAN
     ======================================================== */

  // Kumpulan gambar bawaan (emoji) - tambahkan sendiri jika mau.
  const ITEMS = [
    { id: 'apel',    emoji: '🍎', name: 'Apel' },
    { id: 'pisang',  emoji: '🍌', name: 'Pisang' },
    { id: 'anggur',  emoji: '🍇', name: 'Anggur' },
    { id: 'kucing',  emoji: '🐱', name: 'Kucing' },
    { id: 'penguin', emoji: '🐧', name: 'Penguin' },
    { id: 'mobil',   emoji: '🚗', name: 'Mobil' },
    { id: 'sepeda',  emoji: '🚲', name: 'Sepeda' },
    { id: 'topi',    emoji: '🧢', name: 'Topi' },
    { id: 'bola',    emoji: '⚽', name: 'Bola' },
    { id: 'jamur',   emoji: '🍄', name: 'Jamur' },
    { id: 'donat',   emoji: '🍩', name: 'Donat' },
    { id: 'kakbah',  emoji: '🕋', name: 'Kakbah' },
    { id: 'bintang', emoji: '⭐', name: 'Bintang' },
    { id: 'bunga',   emoji: '🌸', name: 'Bunga' },
    { id: 'ikan',    emoji: '🐟', name: 'Ikan' },
    { id: 'pizza',   emoji: '🍕', name: 'Pizza' }
  ];

  // Untuk mencari data gambar dengan cepat berdasarkan id.
  const ITEM_BY_ID = {};
  ITEMS.forEach((item) => { ITEM_BY_ID[item.id] = item; });

  // Pengaturan tiap level:
  //   count           = jumlah gambar (jumlah kolom)
  //   memorizeSeconds = waktu menghafal
  //   solveSeconds    = batas waktu mengerjakan (hitung mundur)
  //   sessions        = jumlah sesi di level ini.
  //                     null = tanpa batas (terus sampai ada yang salah).
  //                     Level TERAKHIR harus null.
  const LEVELS = [
    { count: 3, memorizeSeconds: 10, solveSeconds: 40, sessions: 10 },
    { count: 4, memorizeSeconds: 15, solveSeconds: 50, sessions: 10 },
    { count: 5, memorizeSeconds: 20, solveSeconds: 60, sessions: null }
  ];

  const BASE_SCORE = 100;       // skor dasar per sesi (jika semua urutan benar)
  const MAX_SPEED_BONUS = 100;  // bonus kecepatan maksimal per sesi

  const REVEAL_STEP_MS = 180;   // jeda munculnya gambar satu per satu (fase menghafal)
  const HIDE_ANIMATION_MS = 350; // lama animasi gambar menghilang

  // Ukuran kotak urutan (dalam px desain bingkai 960x540).
  // Saat menghafal kotak dibuat BESAR (area papan masih kosong);
  // saat menjawab dikecilkan supaya muat bersama pilihan gambar & tombol.
  const SLOT_GAP = 12;          // harus sama dengan "gap" di .slots (style.css)
  const SLOT_AREA_WIDTH = 890;  // lebar area kotak
  const MEMO_SLOT_MAX = 270;    // ukuran maksimal kotak saat menghafal
  const SOLVE_SLOT_MAX = 112;   // ukuran maksimal kotak saat menjawab

  /* ========================================================
     2. RUMUS SKOR
     ========================================================
     Bonus kecepatan dihitung dari SISA WAKTU pengerjaan:

        bonus = 100 x (sisa waktu / batas waktu level)

     Contoh (Level 1, batas waktu 40 detik):
       - selesai dengan sisa 40 dtk (instan) -> bonus 100
       - selesai dengan sisa 20 dtk          -> bonus 50
       - selesai dengan sisa 0 dtk           -> bonus 0

     Hasilnya dibulatkan dan dijaga di antara 0 sampai 100,
     sehingga bonus (dan skor) tidak pernah negatif.
     Skor per sesi = skor dasar (100) + bonus kecepatan (maksimal 200).
  */
  function calculateSpeedBonus(timeLeftSeconds, solveLimitSeconds) {
    const ratio = Math.min(Math.max(timeLeftSeconds / solveLimitSeconds, 0), 1);
    return Math.round(MAX_SPEED_BONUS * ratio);
  }

  /* ========================================================
     3. STATE (data permainan yang berubah-ubah)
     ======================================================== */
  function createInitialState() {
    return {
      phase: 'idle',
      levelIndex: 0,          // 0 = Level 1
      sessionIndex: 0,        // 0 = sesi 1 di level ini
      totalScore: 0,
      sessionsCorrect: 0,     // jumlah sesi yang dijawab benar (semua level)
      gameStartTime: 0,       // untuk menghitung waktu bermain
      sessionScored: false,   // pengaman: skor sesi hanya dihitung SEKALI

      sequence: [],           // KUNCI JAWABAN: urutan id gambar yang benar
      choices: [],            // urutan id gambar pilihan (sudah diacak)
      answer: [],             // jawaban pemain per kotak (id gambar atau null)
      slotResults: null,      // hasil per kotak setelah diperiksa (true/false)

      selectedSlot: null,     // kotak yang sedang dipilih
      selectedChoice: null,   // gambar pilihan yang sedang dipilih
      lastPlacedSlot: null,   // untuk animasi "pop" saat gambar ditempatkan

      timerEndTime: 0         // waktu (ms) kapan timer yang sedang berjalan berakhir
    };
  }

  let state = createInitialState();

  // Info drag-and-drop yang sedang berlangsung.
  let dragInfo = null;

  // Pengelola timer: satu interval + daftar timeout agar bisa dibersihkan semua sekaligus.
  let intervalId = null;
  const timeoutEntries = [];   // { id, callback, fireAt } -> supaya bisa dijeda
  let activeCountdown = null;  // info hitung mundur yang sedang berjalan
  let paused = false;          // true saat HP tegak (permainan menunggu)
  let pausedSnapshot = null;   // data timer yang disimpan selama jeda

  /* ========================================================
     4. REFERENSI ELEMEN HTML
     ======================================================== */
  const $ = (id) => document.getElementById(id);

  const root = document.documentElement;

  const els = {
    stage: $('stage'),
    startScreen: $('start-screen'),
    gameScreen: $('game-screen'),

    startBtn: $('start-btn'),
    clearBtn: $('clear-btn'),
    checkBtn: $('check-btn'),
    retryBtn: $('retry-btn'),
    nextBtn: $('next-btn'),

    levelText: $('level-text'),
    scoreText: $('score-text'),
    sessionText: $('session-text'),
    levelDots: $('level-dots'),

    timerBox: $('timer-box'),
    timerLabel: $('timer-label'),
    timerValue: $('timer-value'),
    timerBar: $('timer-bar'),

    status: $('status'),
    slots: $('slots'),
    tray: $('tray'),
    choices: $('choices'),
    actions: $('actions'),

    resultPanel: $('result-panel'),
    resultTitle: $('result-title'),
    resultMessage: $('result-message'),
    resultBreakdown: $('result-breakdown'),

    confetti: $('confetti'),

    nameInput: $('player-name'),
    nameError: $('name-error'),
    menuBtn: $('menu-btn'),
    scoreboard: $('scoreboard'),
    scoreboardEmpty: $('scoreboard-empty'),
    resetScores: $('reset-scores'),
    tabs: document.querySelectorAll('.tab'),
    panelScore: $('panel-score'),
    panelHow: $('panel-how')
  };

  /* ========================================================
     5b. NAMA PEMAIN & PAPAN SKOR (disimpan di localStorage)
     ======================================================== */
  const SCORE_KEY = 'memoryChallenge.scores';
  const NAME_KEY = 'memoryChallenge.lastName';
  const MAX_SCORES = 10;
  let playerName = '';
  let lastEntryId = null; // entri skor terbaru (disorot di papan skor)

  function loadScores() {
    try {
      const list = JSON.parse(localStorage.getItem(SCORE_KEY) || '[]');
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  function saveScores(list) {
    try { localStorage.setItem(SCORE_KEY, JSON.stringify(list)); } catch (e) { /* abaikan */ }
  }

  // Menambahkan skor baru, mengurutkan, dan menyisakan MAX_SCORES teratas.
  function addScore(name, score, level) {
    if (score <= 0) return;
    const entry = { id: Date.now() + '-' + Math.random().toString(36).slice(2, 7), name: name, score: score, level: level };
    const list = loadScores();
    list.push(entry);
    list.sort((a, b) => b.score - a.score || b.level - a.level);
    saveScores(list.slice(0, MAX_SCORES));
    lastEntryId = entry.id;
  }

  function renderScoreboard() {
    const list = loadScores();
    els.scoreboard.innerHTML = '';
    els.scoreboardEmpty.hidden = list.length > 0;
    els.resetScores.hidden = list.length === 0;

    const medals = ['🥇', '🥈', '🥉'];
    list.forEach((entry, i) => {
      const li = makeEl('li', 'sb-row');
      if (i < 3) li.classList.add('top' + (i + 1));
      if (entry.id === lastEntryId) li.classList.add('me');
      li.appendChild(makeEl('span', 'sb-rank', i < 3 ? medals[i] : String(i + 1)));
      li.appendChild(makeEl('span', 'sb-name', entry.name)); // textContent: aman dari HTML
      li.appendChild(makeEl('span', 'sb-level', 'Lv ' + entry.level));
      li.appendChild(makeEl('span', 'sb-score', String(entry.score)));
      els.scoreboard.appendChild(li);
    });
  }

  function showTab(name) {
    els.tabs.forEach((tab) => {
      const active = tab.dataset.tab === name;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    els.panelScore.hidden = name !== 'score';
    els.panelHow.hidden = name !== 'how';
  }

  // Mengembalikan nama yang valid, atau null jika kosong (sekaligus menampilkan peringatan).
  function readPlayerName() {
    const name = els.nameInput.value.replace(/\s+/g, ' ').trim();
    const ok = name.length > 0;
    els.nameError.hidden = ok;
    els.nameInput.classList.remove('invalid');
    if (!ok) {
      void els.nameInput.offsetWidth;
      els.nameInput.classList.add('invalid');
      els.nameInput.focus();
      return null;
    }
    return name;
  }

  // Pop-up konfirmasi bertema game (pengganti confirm() bawaan browser).
  let modalOpen = false;
  let modalOnOk = null;
  let modalOnCancel = null;

  function openModal(opts, onOk, onCancel) {
    modalOpen = true;
    modalOnOk = onOk || null;
    modalOnCancel = onCancel || null;
    $('modal-icon').textContent = opts.icon;
    $('modal-title').textContent = opts.title;
    $('modal-text').textContent = opts.text;
    $('modal-ok').textContent = opts.okText;
    $('modal-cancel').textContent = opts.cancelText;
    $('modal-ok').className = 'btn ' + (opts.danger ? 'btn-danger' : 'btn-primary');
    $('modal').hidden = false;
    $('modal-cancel').focus({ preventScroll: true });
  }

  function closeModal(confirmed) {
    if (!modalOpen) return;
    modalOpen = false;
    $('modal').hidden = true;
    const handler = confirmed ? modalOnOk : modalOnCancel;
    modalOnOk = modalOnCancel = null;
    if (handler) handler();
  }

  function goToMenu() {
    clearAllTimers();
    clearConfetti();
    state = createInitialState();
    renderScoreboard();
    showTab('score');
    showScreen('start');
  }

  /* ========================================================
     5. FUNGSI BANTU
     ======================================================== */

  // Mengacak array dengan algoritma Fisher-Yates (mengembalikan array baru).
  function shuffle(array) {
    const copy = array.slice();
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  // Memilih `count` gambar acak TANPA duplikat, mengembalikan array id.
  function pickRandomItemIds(count) {
    return shuffle(ITEMS).slice(0, count).map((item) => item.id);
  }

  // Mengacak urutan pilihan, memastikan hasilnya TIDAK sama dengan urutan jawaban.
  function shuffleDifferentFrom(sequence) {
    let result;
    do {
      result = shuffle(sequence);
    } while (sequence.length > 1 && result.every((id, i) => id === sequence[i]));
    return result;
  }

  // Membuat elemen HTML dengan cepat.
  function makeEl(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }

  // Membuat elemen non-tombol bisa diklik dengan mouse, sentuhan, dan keyboard.
  function makeActivatable(el, handler) {
    el.tabIndex = 0;
    el.addEventListener('click', handler);
    el.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        handler();
      }
    });
  }

  // Format detik menjadi "mm:ss".
  function formatClock(totalSeconds) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = Math.floor(totalSeconds % 60);
    return String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0');
  }

  function setStatus(message) {
    els.status.textContent = message;
  }

  function showScreen(name) {
    els.startScreen.hidden = name !== 'start';
    els.gameScreen.hidden = name !== 'game';
  }

  /* ========================================================
     6. TIMER
     ======================================================== */

  function stopInterval() {
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
    activeCountdown = null;
  }

  // Menjalankan sebuah timeout yang tercatat, supaya bisa dibatalkan / dijeda.
  function later(callback, delayMs) {
    const entry = { id: null, callback: callback, fireAt: Date.now() + delayMs };
    entry.id = setTimeout(() => {
      const index = timeoutEntries.indexOf(entry);
      if (index > -1) timeoutEntries.splice(index, 1);
      callback();
    }, delayMs);
    timeoutEntries.push(entry);
    return entry.id;
  }

  // Menghentikan SEMUA timer (interval + timeout). Dipanggil sebelum ronde baru
  // dimulai agar timer tidak pernah berjalan ganda.
  function clearAllTimers() {
    stopInterval();
    timeoutEntries.forEach((entry) => clearTimeout(entry.id));
    timeoutEntries.length = 0;
    pausedSnapshot = null;
  }

  // Memperbarui tampilan timer (angka, bar, dan warna peringatan).
  function updateTimerUI(remainingSeconds, totalSeconds, label) {
    els.timerLabel.textContent = label;
    els.timerValue.textContent = Math.ceil(remainingSeconds);
    const ratio = totalSeconds > 0 ? remainingSeconds / totalSeconds : 0;
    els.timerBar.style.width = (ratio * 100) + '%';
    els.timerBox.classList.toggle('warning', ratio <= 0.25 && remainingSeconds > 0);
  }

  // Hitung mundur berbasis jam sistem (Date.now) agar tetap akurat.
  // `startFrom` (opsional) dipakai untuk melanjutkan timer setelah dijeda.
  function startCountdown(seconds, label, mode, onFinish, startFrom) {
    stopInterval();
    const from = startFrom === undefined ? seconds : startFrom;
    const endTime = Date.now() + from * 1000;
    state.timerEndTime = endTime;
    els.timerBox.dataset.mode = mode;
    activeCountdown = { total: seconds, label: label, mode: mode, onFinish: onFinish };

    let finished = false;
    let lastWhole = Math.ceil(from);
    const tick = () => {
      const remaining = Math.max(0, (endTime - Date.now()) / 1000);
      updateTimerUI(remaining, seconds, label);

      // Bunyi "tik" pada 3 detik terakhir.
      const whole = Math.ceil(remaining);
      if (whole !== lastWhole) {
        lastWhole = whole;
        if (whole > 0 && whole <= 3) S.tick();
      }
      if (remaining <= 0) {
        finished = true;
        stopInterval();
        onFinish();
      }
    };

    tick();
    if (!finished) intervalId = setInterval(tick, 100);
  }

  function getTimeLeftSeconds() {
    return Math.max(0, (state.timerEndTime - Date.now()) / 1000);
  }

  // ---- Jeda otomatis saat HP berposisi tegak (pemberitahuan landscape) ----
  // Semua timer dihentikan dan sisa waktunya disimpan, lalu dilanjutkan
  // dari sisa waktu yang sama ketika HP kembali landscape.
  function pauseGame() {
    if (paused) return;
    paused = true;
    S.pause();

    const now = Date.now();
    const snapshot = { timeouts: [], countdown: null };

    timeoutEntries.forEach((entry) => {
      clearTimeout(entry.id);
      snapshot.timeouts.push({ callback: entry.callback, remaining: Math.max(0, entry.fireAt - now) });
    });
    timeoutEntries.length = 0;

    if (intervalId !== null && activeCountdown) {
      snapshot.countdown = Object.assign({}, activeCountdown, { remaining: getTimeLeftSeconds() });
      stopInterval();
    }
    pausedSnapshot = snapshot;
  }

  function resumeGame() {
    if (!paused) return;
    paused = false;
    S.resume();

    const snapshot = pausedSnapshot;
    pausedSnapshot = null;
    if (!snapshot) return;

    snapshot.timeouts.forEach((item) => later(item.callback, item.remaining));
    if (snapshot.countdown) {
      const c = snapshot.countdown;
      startCountdown(c.total, c.label, c.mode, c.onFinish, c.remaining);
    }
  }

  /* ========================================================
     7. ALUR PERMAINAN
     ======================================================== */

  // Tombol "Mulai Game" / "Main dari Awal": mengatur ulang SEMUANYA.
  function startGame() {
    // Permainan baru hanya boleh dimulai saat layar landscape (HP tidak tegak).
    if (root.classList.contains('tegak')) return;

    // Nama pemain wajib diisi sebelum mulai.
    const name = readPlayerName();
    if (!name) return;
    playerName = name;
    lastEntryId = null;
    try { localStorage.setItem(NAME_KEY, name); } catch (e) { /* abaikan */ }

    clearAllTimers();
    clearConfetti();
    state = createInitialState();
    state.gameStartTime = Date.now();
    showScreen('game');
    S.start();
    beginLevel(0);
  }

  // Memulai sebuah level, dimulai dari sesi pertamanya.
  function beginLevel(levelIndex) {
    state.levelIndex = levelIndex;
    state.sessionIndex = 0;
    state.sessionScored = false;
    updateHud();
    startRound();
  }

  // Lanjut ke sesi berikutnya di level yang sama.
  function beginNextSession() {
    state.sessionIndex += 1;
    state.sessionScored = false;
    updateHud();
    startRound();
  }

  // Memulai satu sesi: urutan gambar baru, lalu fase menghafal.
  function startRound() {
    clearAllTimers();   // pastikan tidak ada timer lama yang masih hidup
    clearConfetti();

    const config = LEVELS[state.levelIndex];

    state.sequence = pickRandomItemIds(config.count);       // kunci jawaban
    state.choices = shuffleDifferentFrom(state.sequence);   // pilihan diacak (terpisah dari kunci)
    state.answer = new Array(config.count).fill(null);
    state.slotResults = null;
    state.selectedSlot = null;
    state.selectedChoice = null;
    state.lastPlacedSlot = null;
    state.phase = 'memorize';

    // Atur tampilan untuk fase menghafal.
    els.resultPanel.hidden = true;
    els.retryBtn.hidden = true;
    els.menuBtn.hidden = true;
    els.nextBtn.hidden = true;
    els.tray.hidden = true;
    els.actions.hidden = true;
    els.slots.classList.remove('hiding', 'shake');
    setStatus('👀 Perhatikan dan hafalkan urutan gambar dari kiri ke kanan!');

    renderSlots(); // menampilkan gambar (animasi muncul satu per satu)
    updateTimerUI(config.memorizeSeconds, config.memorizeSeconds, 'Waktu Menghafal');
    els.timerBox.dataset.mode = 'memorize';

    // Timer menghafal baru mulai setelah semua gambar selesai muncul.
    const revealMs = config.count * REVEAL_STEP_MS + 450;
    later(() => {
      startCountdown(config.memorizeSeconds, 'Waktu Menghafal', 'memorize', endMemorizePhase);
    }, revealMs);

    // Bunyi "pop" untuk tiap gambar yang muncul (selaras dengan animasi).
    for (let i = 0; i < config.count; i++) {
      later(() => S.pop(i), i * REVEAL_STEP_MS);
    }
  }

  // Fase menghafal selesai: gambar menghilang, kotak kosong bernomor muncul.
  function endMemorizePhase() {
    if (state.phase !== 'memorize') return;
    state.phase = 'hiding';
    S.whoosh();

    els.slots.classList.add('hiding');
    setStatus('🙈 Gambar disembunyikan...');

    later(() => {
      const config = LEVELS[state.levelIndex];

      state.phase = 'solve';
      els.slots.classList.remove('hiding');
      state.selectedSlot = 0; // kotak pertama langsung terpilih

      els.tray.hidden = false;
      els.actions.hidden = false;
      setStatus('🧩 Isi kotak sesuai urutan awal. Klik gambar pilihan, atau tarik ke kotak.');

      renderAnswerArea(); // sekarang kotak kosong; gambar asli sudah hilang dari tampilan

      startCountdown(config.solveSeconds, 'Waktu Mengerjakan', 'solve', handleTimeout);
    }, HIDE_ANIMATION_MS);
  }

  /* ========================================================
     8. TAMPILAN (RENDER)
     ======================================================== */

  function updateHud(bumpScore) {
    const config = LEVELS[state.levelIndex];

    els.levelText.textContent = (state.levelIndex + 1) + ' / ' + LEVELS.length;
    els.scoreText.textContent = state.totalScore;
    els.sessionText.textContent = config.sessions
      ? (state.sessionIndex + 1) + ' / ' + config.sessions
      : String(state.sessionIndex + 1);

    // Titik kemajuan sesi. Level tanpa batas sesi menampilkan keterangan saja.
    els.levelDots.innerHTML = '';
    if (config.sessions) {
      for (let i = 0; i < config.sessions; i++) {
        const dot = makeEl('span', 'dot');
        if (i < state.sessionIndex || (i === state.sessionIndex && state.sessionScored)) {
          dot.classList.add('done');
        } else if (i === state.sessionIndex) {
          dot.classList.add('current');
        }
        els.levelDots.appendChild(dot);
      }
    } else {
      els.levelDots.appendChild(makeEl('span', 'endless-note', 'Terus sampai ada yang salah'));
    }

    if (bumpScore) {
      els.scoreText.classList.remove('bump');
      void els.scoreText.offsetWidth; // memicu ulang animasi
      els.scoreText.classList.add('bump');
    }
  }

  // Menggambar kotak urutan.
  //  - Fase menghafal: berisi gambar yang benar (hanya selama fase ini).
  //  - Fase mengerjakan: berisi jawaban pemain atau kotak kosong bernomor.
  function renderSlots() {
    els.slots.innerHTML = '';

    const showingSequence = state.phase === 'memorize' || state.phase === 'hiding';
    const interactive = state.phase === 'solve';
    const total = state.sequence.length;

    // Ukuran kotak menyesuaikan jumlah gambar & fase (besar saat menghafal).
    const maxByWidth = Math.floor((SLOT_AREA_WIDTH - SLOT_GAP * (total - 1)) / total);
    const slotSize = Math.min(maxByWidth, showingSequence ? MEMO_SLOT_MAX : SOLVE_SLOT_MAX);
    els.slots.style.setProperty('--slot', slotSize + 'px');

    for (let i = 0; i < total; i++) {
      const wrap = makeEl('div', 'slot-wrap');
      const slot = makeEl('div', 'slot');

      if (showingSequence) {
        // --- Fase menghafal: tampilkan gambar yang harus dihafal ---
        const item = ITEM_BY_ID[state.sequence[i]];
        slot.classList.add('memo', 'filled');
        slot.style.setProperty('--delay', (i * REVEAL_STEP_MS) + 'ms');
        slot.setAttribute('role', 'img');
        slot.setAttribute('aria-label', 'Gambar ' + (i + 1) + ': ' + item.name);
        slot.appendChild(makeEl('span', 'slot-badge', String(i + 1)));
        slot.appendChild(makeEl('span', 'slot-emoji', item.emoji));
      } else {
        // --- Fase mengerjakan / hasil: tampilkan jawaban pemain ---
        const answerId = state.answer[i];
        const item = answerId ? ITEM_BY_ID[answerId] : null;

        slot.setAttribute('role', 'button');
        slot.setAttribute(
          'aria-label',
          'Kotak ' + (i + 1) + (item ? ', berisi ' + item.name : ', kosong')
        );

        if (item) {
          slot.classList.add('filled');
          slot.appendChild(makeEl('span', 'slot-badge', String(i + 1)));
          slot.appendChild(makeEl('span', 'slot-emoji', item.emoji));
          if (i === state.lastPlacedSlot) slot.classList.add('pop');
        } else {
          slot.appendChild(makeEl('span', 'slot-placeholder', String(i + 1)));
        }

        if (interactive) {
          if (i === state.selectedSlot) slot.classList.add('selected');
          makeActivatable(slot, () => onSlotClick(i));

          // Drag: kotak yang terisi bisa ditarik ke kotak lain / dikembalikan ke pilihan.
          if (item) {
            slot.draggable = true;
            slot.addEventListener('dragstart', (event) => {
              dragInfo = { type: 'slot', index: i };
              event.dataTransfer.setData('text/plain', 'slot:' + i);
              event.dataTransfer.effectAllowed = 'move';
              els.tray.classList.add('drop-ready');
            });
            slot.addEventListener('dragend', endDrag);
          }

          // Drop: kotak ini bisa menerima gambar.
          wrap.addEventListener('dragover', (event) => {
            if (!dragInfo) return;
            event.preventDefault();
            wrap.classList.add('drag-over');
          });
          wrap.addEventListener('dragleave', () => wrap.classList.remove('drag-over'));
          wrap.addEventListener('drop', (event) => {
            event.preventDefault();
            wrap.classList.remove('drag-over');
            handleDropOnSlot(i);
          });

          // Tombol hapus (x) pada kotak yang terisi.
          if (item) {
            wrap.appendChild(slot);
            const removeBtn = makeEl('button', 'slot-remove', '✕');
            removeBtn.type = 'button';
            removeBtn.setAttribute('aria-label', 'Hapus gambar dari kotak ' + (i + 1));
            removeBtn.addEventListener('click', () => removeFromSlot(i));
            wrap.appendChild(removeBtn);
            els.slots.appendChild(wrap);
            continue;
          }
        } else if (state.phase === 'result') {
          slot.classList.add('locked');
          if (state.slotResults) {
            slot.classList.add(state.slotResults[i] ? 'correct' : 'wrong');
          }
        }
      }

      wrap.appendChild(slot);
      els.slots.appendChild(wrap);
    }

    state.lastPlacedSlot = null; // animasi "pop" hanya sekali
  }

  // Menggambar kumpulan gambar pilihan (urutan sudah diacak).
  function renderTray() {
    els.choices.innerHTML = '';

    state.choices.forEach((id) => {
      const item = ITEM_BY_ID[id];
      const used = state.answer.includes(id);

      const tile = makeEl('div', 'tile');
      if (used) tile.classList.add('used');
      if (state.selectedChoice === id) tile.classList.add('selected');

      tile.setAttribute('role', 'button');
      tile.setAttribute('aria-label', item.name + (used ? ' (sudah dipakai)' : ''));
      tile.appendChild(makeEl('span', 'tile-emoji', item.emoji));
      tile.appendChild(makeEl('span', 'tile-name', item.name));

      makeActivatable(tile, () => onChoiceClick(id));

      // Drag-and-drop dari pilihan ke kotak.
      tile.draggable = true;
      tile.addEventListener('dragstart', (event) => {
        dragInfo = { type: 'choice', id: id };
        event.dataTransfer.setData('text/plain', 'choice:' + id);
        event.dataTransfer.effectAllowed = 'move';
        tile.classList.add('dragging');
      });
      tile.addEventListener('dragend', endDrag);

      els.choices.appendChild(tile);
    });
  }

  function updateCheckButton() {
    els.checkBtn.disabled = state.phase !== 'solve' || state.answer.includes(null);
  }

  // Menggambar ulang area jawaban (kotak + pilihan + tombol periksa).
  function renderAnswerArea() {
    renderSlots();
    renderTray();
    updateCheckButton();
  }

  /* ========================================================
     9. INTERAKSI PEMAIN
     ======================================================== */

  // Mencari kotak kosong berikutnya setelah posisi `fromIndex` (berputar ke awal).
  function findNextEmptySlot(fromIndex) {
    const total = state.answer.length;
    for (let step = 1; step <= total; step++) {
      const index = (fromIndex + step) % total;
      if (state.answer[index] === null) return index;
    }
    return null; // semua kotak sudah terisi
  }

  // Menempatkan gambar ke sebuah kotak.
  // Jika gambar itu sudah ada di kotak lain, gambar dipindahkan (atau ditukar
  // jika kotak tujuan sudah terisi) - sehingga tidak ada gambar ganda.
  function placeItem(itemId, slotIndex) {
    if (state.phase !== 'solve') return;
    S.place();

    const oldIndex = state.answer.indexOf(itemId);
    const displaced = state.answer[slotIndex];

    state.answer[slotIndex] = itemId;
    if (oldIndex !== -1 && oldIndex !== slotIndex) {
      state.answer[oldIndex] = displaced; // tukar (atau kosongkan jika displaced = null)
    }

    state.lastPlacedSlot = slotIndex;
    state.selectedChoice = null;
    state.selectedSlot = findNextEmptySlot(slotIndex);
    renderAnswerArea();
  }

  // Menukar isi dua kotak (dipakai saat drag kotak ke kotak).
  function swapSlots(fromIndex, toIndex) {
    if (state.phase !== 'solve' || fromIndex === toIndex) return;
    S.place();
    const temp = state.answer[fromIndex];
    state.answer[fromIndex] = state.answer[toIndex];
    state.answer[toIndex] = temp;
    state.lastPlacedSlot = toIndex;
    state.selectedChoice = null;
    state.selectedSlot = findNextEmptySlot(toIndex);
    renderAnswerArea();
  }

  // Menghapus gambar dari sebuah kotak (gambar kembali tersedia di pilihan).
  function removeFromSlot(slotIndex) {
    if (state.phase !== 'solve') return;
    S.remove();
    state.answer[slotIndex] = null;
    state.selectedSlot = slotIndex;
    state.selectedChoice = null;
    renderAnswerArea();
  }

  function clearAllAnswers() {
    if (state.phase !== 'solve') return;
    state.answer = new Array(state.sequence.length).fill(null);
    state.selectedSlot = 0;
    state.selectedChoice = null;
    renderAnswerArea();
  }

  // Klik pada gambar pilihan.
  function onChoiceClick(itemId) {
    if (state.phase !== 'solve') return;

    if (state.selectedSlot !== null) {
      placeItem(itemId, state.selectedSlot);         // ada kotak terpilih -> isi kotak itu
    } else {
      // Belum ada kotak terpilih: tandai gambar, lalu pemain klik kotak tujuan.
      state.selectedChoice = state.selectedChoice === itemId ? null : itemId;
      S.select();
      renderAnswerArea();
    }
  }

  // Klik pada kotak.
  function onSlotClick(slotIndex) {
    if (state.phase !== 'solve') return;

    if (state.selectedChoice !== null) {
      placeItem(state.selectedChoice, slotIndex);    // ada gambar terpilih -> taruh di kotak ini
      return;
    }
    state.selectedSlot = state.selectedSlot === slotIndex ? null : slotIndex;
    S.select();
    renderAnswerArea();
  }

  // Drag-and-drop
  function handleDropOnSlot(slotIndex) {
    const info = dragInfo;
    dragInfo = null;
    els.tray.classList.remove('drop-ready');
    if (!info || state.phase !== 'solve') return;

    if (info.type === 'choice') placeItem(info.id, slotIndex);
    else if (info.type === 'slot') swapSlots(info.index, slotIndex);
  }

  function handleDropOnTray() {
    const info = dragInfo;
    dragInfo = null;
    els.tray.classList.remove('drop-ready');
    if (!info || state.phase !== 'solve') return;

    // Menjatuhkan gambar dari kotak ke area pilihan = menghapusnya dari kotak.
    if (info.type === 'slot') removeFromSlot(info.index);
  }

  function endDrag() {
    dragInfo = null;
    els.tray.classList.remove('drop-ready');
    document.querySelectorAll('.dragging').forEach((el) => el.classList.remove('dragging'));
    document.querySelectorAll('.drag-over').forEach((el) => el.classList.remove('drag-over'));
  }

  /* ========================================================
     10. MEMERIKSA JAWABAN
     ======================================================== */

  function checkAnswer() {
    // Pengaman: hanya bisa diperiksa SEKALI per ronde, dan hanya saat fase mengerjakan.
    if (state.phase !== 'solve') return;
    if (state.answer.includes(null)) return;

    const timeLeft = getTimeLeftSeconds();
    stopInterval(); // hentikan timer segera

    if (timeLeft <= 0) {
      handleTimeout();
      return;
    }

    state.phase = 'result'; // mengunci interaksi & mencegah klik ganda

    const total = state.sequence.length;
    state.slotResults = state.answer.map((id, i) => id === state.sequence[i]);
    const correctCount = state.slotResults.filter(Boolean).length;

    if (correctCount === total) handleCorrect(timeLeft);
    else handleWrong(correctCount, total);
  }

  function handleCorrect(timeLeft) {
    const config = LEVELS[state.levelIndex];
    const bonus = calculateSpeedBonus(timeLeft, config.solveSeconds);

    // Skor hanya dihitung SEKALI per sesi.
    let sessionScore = 0;
    if (!state.sessionScored) {
      state.sessionScored = true;
      sessionScore = BASE_SCORE + bonus;
      state.totalScore += sessionScore;
      state.sessionsCorrect += 1;
    }

    updateHud(true);
    renderSlots();
    setStatus('Urutanmu benar semua!');

    // Sesi terakhir di level yang punya batas sesi = naik level.
    const isLevelEnd = config.sessions !== null && state.sessionIndex >= config.sessions - 1;
    const sessionNumber = state.sessionIndex + 1;
    spawnConfetti(isLevelEnd ? 80 : 40);
    if (isLevelEnd) S.levelUp();
    else S.correct();

    let title;
    let message;
    if (isLevelEnd) {
      const nextConfig = LEVELS[state.levelIndex + 1];
      els.nextBtn.textContent = 'Naik ke Level ' + (state.levelIndex + 2) + ' ➜';
      title = 'Hebat! Level ' + (state.levelIndex + 1) + ' selesai!';
      message = 'Kamu naik ke Level ' + (state.levelIndex + 2) + '. Sekarang ada ' + nextConfig.count +
        ' gambar dengan waktu menghafal ' + nextConfig.memorizeSeconds + ' detik.';
    } else {
      els.nextBtn.textContent = 'Sesi Berikutnya ➜';
      title = 'Benar! Sesi ' + sessionNumber + ' selesai';
      message = 'Semua gambar ada di posisi yang tepat.';
    }

    const breakdown =
      row('Skor dasar', '+' + BASE_SCORE) +
      row('Bonus kecepatan <small>(sisa ' + timeLeft.toFixed(1) + ' dtk dari ' + config.solveSeconds + ' dtk)</small>', '+' + bonus) +
      row('Skor sesi ini', '+' + sessionScore, 'total') +
      row('Total skor', String(state.totalScore));

    showResult('success', title, message, breakdown, 'next');
  }

  // Jawaban salah = gugur.
  function handleWrong(correctCount, total) {
    renderSlots(); // tampilkan warna benar/salah per kotak
    els.slots.classList.remove('shake');
    void els.slots.offsetWidth;
    els.slots.classList.add('shake');
    setStatus('Belum tepat.');

    const detail =
      correctCount === 0
        ? 'Belum ada posisi yang tepat.'
        : 'Kamu benar di ' + correctCount + ' dari ' + total + ' posisi.';

    eliminate(detail);
  }

  // Waktu pengerjaan habis = gugur.
  function handleTimeout() {
    if (state.phase !== 'solve') return;
    stopInterval();
    state.phase = 'result';
    state.slotResults = null;

    renderSlots();
    setStatus('Waktu habis!');

    eliminate('Waktu mengerjakan habis.');
  }

  // Pemain gugur: tampilkan ringkasan, tombol "Main dari Awal" mengulang dari Level 1.
  function eliminate(detail) {
    S.wrong();
    addScore(playerName, state.totalScore, state.levelIndex + 1); // simpan ke papan skor
    const totalSeconds = (Date.now() - state.gameStartTime) / 1000;
    const isEndless = LEVELS[state.levelIndex].sessions === null;
    const survived = state.sessionIndex; // sesi yang sudah berhasil di level ini

    let message = detail + ' ';
    if (isEndless) {
      message += survived > 0
        ? 'Kamu bertahan ' + survived + ' sesi di Level ' + (state.levelIndex + 1) + '. '
        : 'Kamu belum berhasil melewati sesi pertama di Level ' + (state.levelIndex + 1) + '. ';
    }
    message += 'Permainan diulang dari Level 1.';

    const breakdown =
      row('Level yang dicapai', (state.levelIndex + 1) + ' / ' + LEVELS.length) +
      row('Sesi yang benar', String(state.sessionsCorrect)) +
      row('Total skor', String(state.totalScore), 'total') +
      row('Waktu bermain', formatClock(totalSeconds));

    showResult('error', 'Kamu gugur', message, breakdown, 'retry');
  }

  // Membuat satu baris rincian skor.
  function row(label, value, extraClass) {
    return '<div class="row' + (extraClass ? ' ' + extraClass : '') + '">' +
      '<span>' + label + '</span><strong>' + value + '</strong></div>';
  }

  // Menampilkan panel hasil. buttonKind: 'next' atau 'retry'.
  function showResult(type, title, message, breakdownHtml, buttonKind) {
    els.tray.hidden = true;
    els.actions.hidden = true;

    els.resultPanel.className = 'result ' + type;
    els.resultTitle.textContent = title;
    els.resultMessage.textContent = message;
    els.resultBreakdown.innerHTML = breakdownHtml;

    els.menuBtn.hidden = buttonKind !== 'retry';
    els.nextBtn.hidden = buttonKind !== 'next';
    els.retryBtn.hidden = buttonKind !== 'retry';
    els.resultPanel.hidden = false;

    (buttonKind === 'next' ? els.nextBtn : els.retryBtn).focus({ preventScroll: true });
  }

  /* ========================================================
     11. TOMBOL "BERIKUTNYA" & "MAIN DARI AWAL"
     ======================================================== */

  function goToNextLevel() {
    // Hanya boleh jika sesi ini SUDAH benar dan hasilnya sedang ditampilkan.
    if (state.phase !== 'result' || !state.sessionScored) return;

    const config = LEVELS[state.levelIndex];
    const isLevelEnd = config.sessions !== null && state.sessionIndex >= config.sessions - 1;

    if (isLevelEnd) beginLevel(state.levelIndex + 1);
    else beginNextSession();
  }

  // Setelah gugur: ulang permainan dari awal (Level 1, sesi 1, skor 0).
  function restartAfterElimination() {
    // Hanya boleh jika sesi ini SALAH / waktu habis dan hasilnya sedang ditampilkan.
    if (state.phase !== 'result' || state.sessionScored) return;
    startGame();
  }

  /* ========================================================
     13. EFEK CONFETTI
     ======================================================== */

  function spawnConfetti(amount) {
    clearConfetti();
    const colors = ['#6c63ff', '#ff7a90', '#ffa726', '#22b573', '#4dabf7', '#ffd43b'];
    for (let i = 0; i < amount; i++) {
      const piece = document.createElement('span');
      piece.style.left = Math.random() * 100 + '%';
      piece.style.background = colors[i % colors.length];
      piece.style.setProperty('--dur', (1.6 + Math.random() * 1.4) + 's');
      piece.style.setProperty('--delay', (Math.random() * 0.5) + 's');
      els.confetti.appendChild(piece);
    }
    setTimeout(clearConfetti, 3500);
  }

  function clearConfetti() {
    els.confetti.innerHTML = '';
  }

  /* ========================================================
     14. MENGHUBUNGKAN TOMBOL
     ======================================================== */

  // Bunyi klik untuk semua tombol (tombol biasa dan tombol ikon).
  document.addEventListener('click', (event) => {
    if (event.target.closest('.btn, .icon-btn')) S.click();
  });

  els.startBtn.addEventListener('click', startGame);
  els.checkBtn.addEventListener('click', checkAnswer);
  els.clearBtn.addEventListener('click', clearAllAnswers);
  els.retryBtn.addEventListener('click', restartAfterElimination);
  els.nextBtn.addEventListener('click', goToNextLevel);
  els.menuBtn.addEventListener('click', () => {
    if (state.phase === 'result' && !state.sessionScored) goToMenu();
  });

  // Tombol menu utama di bilah atas (saat permainan berjalan).
  $('home-btn').addEventListener('click', () => {
    // Jika sudah gugur, skor sudah tersimpan: langsung ke menu.
    if (state.phase === 'result' && !state.sessionScored) { goToMenu(); return; }

    pauseGame(); // waktu berhenti selagi pemain memutuskan
    openModal({
      icon: '🏠',
      title: 'Kembali ke menu utama?',
      text: 'Permainan akan berhenti' +
        (state.totalScore > 0 ? ', skormu (' + state.totalScore + ') tetap dicatat di papan skor.' : '.'),
      okText: 'Ya, ke Menu',
      cancelText: 'Lanjut Main'
    }, () => {
      addScore(playerName, state.totalScore, state.levelIndex + 1);
      paused = false;
      S.resume();
      goToMenu();
    }, () => resumeGame());
  });

  // Tab menu awal, input nama, dan reset papan skor.
  els.tabs.forEach((tab) => tab.addEventListener('click', () => showTab(tab.dataset.tab)));
  els.nameInput.addEventListener('input', () => {
    els.nameError.hidden = true;
    els.nameInput.classList.remove('invalid');
  });
  els.nameInput.addEventListener('keydown', (event) => {
    event.stopPropagation(); // jangan ganggu pintasan keyboard saat mengetik
    if (event.key === 'Enter') startGame();
  });
  els.resetScores.addEventListener('click', () => {
    openModal({
      icon: '🗑️',
      title: 'Hapus papan skor?',
      text: 'Semua skor akan dihapus dan tidak bisa dikembalikan.',
      okText: 'Ya, Hapus',
      cancelText: 'Batal',
      danger: true
    }, () => {
      saveScores([]);
      lastEntryId = null;
      renderScoreboard();
    });
  });

  // Tombol pop-up. Tombol Esc = batal.
  $('modal-ok').addEventListener('click', () => closeModal(true));
  $('modal-cancel').addEventListener('click', () => closeModal(false));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && modalOpen) closeModal(false);
  });

  // Area pilihan juga bisa menerima gambar yang ditarik dari kotak (untuk menghapusnya).
  els.tray.addEventListener('dragover', (event) => {
    if (dragInfo && dragInfo.type === 'slot') event.preventDefault();
  });
  els.tray.addEventListener('drop', (event) => {
    event.preventDefault();
    handleDropOnTray();
  });

  /* ========================================================
     15. PEMBERITAHUAN LANDSCAPE (bekerja sama dengan layar.js)
     ========================================================
     layar.js memberi class "tegak" pada <html> saat HP/tablet berposisi
     tegak. Saat itu: bingkai game dikunci (inert) dan semua timer dijeda,
     sehingga pemain harus memutar HP ke landscape dulu. Setelah landscape,
     timer dilanjutkan dari sisa waktu yang sama. */
  function syncOrientation() {
    const blocked = root.classList.contains('tegak');
    els.stage.inert = blocked;
    if (blocked) pauseGame();
    else if (!modalOpen) resumeGame(); // jika pop-up terbuka, tetap dijeda sampai pemain memilih
  }

  new MutationObserver(syncOrientation).observe(root, { attributes: true, attributeFilter: ['class'] });
  syncOrientation();

  // Isi nama terakhir yang dipakai, lalu tampilkan papan skor.
  try { els.nameInput.value = localStorage.getItem(NAME_KEY) || ''; } catch (e) { /* abaikan */ }
  renderScoreboard();
  showTab('score');
  showScreen('start');
})();
