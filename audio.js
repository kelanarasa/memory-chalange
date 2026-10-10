/* ==========================================================
   Memory Challenge - audio.js
   Musik latar (BGM) dan efek suara (SFX).

   Semua suara DISINTESIS langsung oleh browser (Web Audio API),
   jadi tidak ada file mp3/wav yang perlu diunduh dan tetap jalan
   saat offline.

   Cara pakai dari game.js:  Suara.click(), Suara.correct(), dst.
   (Nama "Suara" dipakai agar tidak bentrok dengan bawaan browser.)

   Catatan: browser baru mengizinkan suara setelah pemain menyentuh
   layar sekali. Karena itu musik mulai otomatis pada sentuhan/klik
   pertama (misalnya saat menekan "Mulai Game").
   ========================================================== */
(() => {
  'use strict';

  /* ---------- Pengaturan yang mudah diubah ---------- */
  const MUSIC_VOLUME = 0.2;   // kerasnya musik latar (0 - 1)
  const SFX_VOLUME = 0.85;    // kerasnya efek suara (0 - 1)
  const BPM = 112;            // kecepatan musik
  const SWING = 0.08;         // 0 = lurus, makin besar makin "melompat-lompat"
  const STORAGE_KEY = 'memoryChallengeAudio';

  const STEP_SEC = 60 / BPM / 2;   // satu langkah = not seperdelapan
  const LOOKAHEAD = 0.4;           // seberapa jauh ke depan not dijadwalkan (detik)

  /* ---------- Status nyala / mati (diingat di perangkat) ---------- */
  const settings = { music: true, sfx: true };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && typeof saved === 'object') {
      if (typeof saved.music === 'boolean') settings.music = saved.music;
      if (typeof saved.sfx === 'boolean') settings.sfx = saved.sfx;
    }
  } catch (e) { /* localStorage tidak tersedia: abaikan */ }

  function saveSettings() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch (e) { /* abaikan */ }
  }

  /* ---------- Mesin audio ---------- */
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  let ctx = null;
  let musicBus = null;
  let sfxBus = null;
  let noiseBuffer = null;

  let externalPause = false;   // dijeda oleh game (HP tegak)
  let schedulerId = null;
  let nextTime = 0;
  let step = 0;

  function mtof(midi) { return 440 * Math.pow(2, (midi - 69) / 12); }

  const NOTE_OFFSET = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  // 'E5' -> nomor MIDI. '-' = diam.
  function noteToMidi(name) {
    if (name === '-') return null;
    return 12 * (Number(name[1]) + 1) + NOTE_OFFSET[name[0]];
  }

  function ensureContext() {
    if (!AudioCtx) return null;
    if (!ctx) {
      ctx = new AudioCtx();

      const compressor = ctx.createDynamicsCompressor(); // mencegah suara pecah
      const master = ctx.createGain();
      master.gain.value = 0.9;

      musicBus = ctx.createGain();
      musicBus.gain.value = settings.music ? MUSIC_VOLUME : 0;
      sfxBus = ctx.createGain();
      sfxBus.gain.value = settings.sfx ? SFX_VOLUME : 0;

      musicBus.connect(master);
      sfxBus.connect(master);
      master.connect(compressor);
      compressor.connect(ctx.destination);

      // Derau putih 1 detik (untuk hi-hat, tepukan, desir).
      noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    return ctx;
  }

  function mustStayPaused() {
    return externalPause || document.hidden;
  }

  // Menyamakan kondisi audio dengan jeda (HP tegak / tab disembunyikan).
  function applyPause() {
    if (!ctx) return;
    if (mustStayPaused()) {
      if (ctx.state === 'running') ctx.suspend().catch(() => {});
    } else if (unlocked && ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
  }

  /* ---------- Pembuat bunyi dasar ---------- */
  function envelope(gain, t, peak, attack, decay) {
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(peak, t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  // Satu nada. `dest` = jalur tujuan (musicBus / sfxBus).
  function tone(dest, freq, t, decay, type, peak, attack) {
    const a = attack === undefined ? 0.005 : attack;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    envelope(gain, t, peak, a, decay);
    osc.connect(gain);
    gain.connect(dest);
    osc.start(t);
    osc.stop(t + a + decay + 0.05);
  }

  // Nada yang meluncur dari frekuensi f0 ke f1.
  function slide(dest, f0, f1, t, decay, type, peak) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(f1, t + decay);
    envelope(gain, t, peak, 0.005, decay);
    osc.connect(gain);
    gain.connect(dest);
    osc.start(t);
    osc.stop(t + decay + 0.06);
  }

  // Derau yang disaring (hi-hat, tepukan, desir). `sweepTo` opsional: frekuensi akhir saringan.
  function noise(dest, t, decay, peak, filterType, freq, q, sweepTo) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(freq, t);
    if (sweepTo) filter.frequency.exponentialRampToValueAtTime(sweepTo, t + decay);
    filter.Q.value = q || 1;
    const gain = ctx.createGain();
    envelope(gain, t, peak, 0.004, decay);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(dest);
    src.start(t, Math.random() * 0.5);
    src.stop(t + decay + 0.06);
  }

  /* ==========================================================
     MUSIK LATAR
     Lagu 8 birama, 4 akor berulang (C - Am - F - G) dengan
     melodi marimba, bass, ketukan ringan, dan petikan "ukulele".
     Tiap birama = 8 langkah (not seperdelapan).
     ========================================================== */
  const BARS = 8;
  const TOTAL_STEPS = BARS * 8;

  const CHORD_TONES = [
    [60, 64, 67],   // C
    [57, 60, 64],   // Am
    [57, 60, 65],   // F
    [59, 62, 67]    // G
  ];
  const BASS_ROOTS = [48, 45, 41, 43]; // C3, A2, F2, G2

  const MELODY_A = [
    ['E5', '-', 'G5', 'E5', 'C5', '-', 'E5', '-'],
    ['C5', '-', 'E5', 'C5', 'A4', '-', 'C5', '-'],
    ['A4', 'C5', 'F5', '-', 'F5', 'C5', 'A4', '-'],
    ['B4', 'D5', 'G5', '-', 'D5', 'B4', 'G4', '-']
  ].map((bar) => bar.map(noteToMidi));

  const MELODY_B = [
    ['G5', '-', 'E5', 'G5', 'C6', '-', 'G5', '-'],
    ['E5', '-', 'A5', 'E5', 'C5', '-', 'E5', '-'],
    ['F5', 'A5', 'C6', '-', 'A5', 'F5', 'C5', '-'],
    ['D5', 'G5', 'B5', '-', 'G5', 'D5', 'B4', '-']
  ].map((bar) => bar.map(noteToMidi));

  function playStep(stepIndex, time) {
    const bar = Math.floor(stepIndex / 8);
    const pos = stepIndex % 8;
    const chordIndex = bar % 4;
    const t = pos % 2 === 1 ? time + STEP_SEC * SWING : time; // langkah ganjil sedikit "tertunda"

    // Melodi marimba
    const melody = bar < 4 ? MELODY_A[bar] : MELODY_B[bar - 4];
    const note = melody[pos];
    if (note !== null) {
      const f = mtof(note);
      tone(musicBus, f, t, 0.32, 'sine', 0.5);
      tone(musicBus, f * 4, t, 0.07, 'sine', 0.1);
    }

    // Bass (melompat)
    const root = BASS_ROOTS[chordIndex];
    if (pos === 0 || pos === 3) tone(musicBus, mtof(root), t, 0.22, 'triangle', 0.6);
    if (pos === 4) tone(musicBus, mtof(root + 7), t, 0.22, 'triangle', 0.55);
    if (pos === 6) tone(musicBus, mtof(root + 12), t, 0.18, 'triangle', 0.4);

    // Petikan akor di ketukan lemah (seperti ukulele)
    if (pos === 3 || pos === 7) {
      CHORD_TONES[chordIndex].forEach((m) => tone(musicBus, mtof(m + 12), t, 0.14, 'triangle', 0.1));
    }

    // Ketukan
    if (pos === 0 || pos === 4) slide(musicBus, 150, 45, t, 0.16, 'sine', 0.7);        // kick
    if (pos === 2 || pos === 6) noise(musicBus, t, 0.09, 0.22, 'bandpass', 1800, 0.8); // tepukan
    if (pos % 2 === 1) noise(musicBus, t, 0.035, 0.1, 'highpass', 7000, 0.7);          // hi-hat
  }

  function scheduler() {
    if (!ctx) return;
    // Jika tertinggal jauh (mis. tab lama tidak aktif), mulai ulang dari sekarang.
    if (nextTime < ctx.currentTime - 0.5) nextTime = ctx.currentTime + 0.05;

    while (nextTime < ctx.currentTime + LOOKAHEAD) {
      if (settings.music) playStep(step, nextTime);
      nextTime += STEP_SEC;
      step = (step + 1) % TOTAL_STEPS;
    }
  }

  function startMusic() {
    if (!ctx || schedulerId !== null) return;
    nextTime = ctx.currentTime + 0.1;
    step = 0;
    schedulerId = setInterval(scheduler, 60);
  }

  /* ==========================================================
     EFEK SUARA
     ========================================================== */
  // Mengembalikan audio context jika efek suara boleh dibunyikan.
  function sfxReady() {
    if (!settings.sfx) return null;
    const c = ensureContext();
    if (!c) return null;
    return c;
  }

  const POP_NOTES = [72, 74, 76, 79, 81, 84]; // tangga nada pentatonik: C D E G A C

  const sfx = {
    // Tombol ditekan
    click() {
      if (!sfxReady()) return;
      const t = ctx.currentTime;
      tone(sfxBus, 660, t, 0.07, 'triangle', 0.35);
      tone(sfxBus, 990, t + 0.02, 0.05, 'sine', 0.15);
    },

    // Memilih gambar / kotak
    select() {
      if (!sfxReady()) return;
      tone(sfxBus, 784, ctx.currentTime, 0.07, 'sine', 0.3);
    },

    // Menaruh gambar di kotak
    place() {
      if (!sfxReady()) return;
      const t = ctx.currentTime;
      slide(sfxBus, 380, 760, t, 0.1, 'sine', 0.5);
      tone(sfxBus, 1200, t + 0.06, 0.09, 'sine', 0.15);
    },

    // Mengeluarkan gambar dari kotak
    remove() {
      if (!sfxReady()) return;
      slide(sfxBus, 700, 300, ctx.currentTime, 0.12, 'triangle', 0.35);
    },

    // Gambar muncul satu per satu saat menghafal (nadanya naik)
    pop(index) {
      if (!sfxReady()) return;
      const t = ctx.currentTime;
      const f = mtof(POP_NOTES[(index || 0) % POP_NOTES.length]);
      tone(sfxBus, f, t, 0.28, 'sine', 0.45);
      tone(sfxBus, f * 2, t, 0.14, 'sine', 0.12);
    },

    // Gambar disembunyikan
    whoosh() {
      if (!sfxReady()) return;
      noise(sfxBus, ctx.currentTime, 0.3, 0.28, 'bandpass', 500, 1.2, 2600);
    },

    // Detik terakhir hitung mundur
    tick() {
      if (!sfxReady()) return;
      tone(sfxBus, 1000, ctx.currentTime, 0.05, 'triangle', 0.25);
    },

    // Mulai permainan
    start() {
      if (!sfxReady()) return;
      const t = ctx.currentTime;
      [67, 72, 76, 79].forEach((m, i) => {
        tone(sfxBus, mtof(m), t + i * 0.07, 0.2, 'triangle', 0.35);
      });
    },

    // Jawaban benar
    correct() {
      if (!sfxReady()) return;
      const t = ctx.currentTime;
      [72, 76, 79, 84].forEach((m, i) => {
        const last = i === 3;
        tone(sfxBus, mtof(m), t + i * 0.08, last ? 0.5 : 0.22, 'triangle', 0.4);
        tone(sfxBus, mtof(m + 12), t + i * 0.08, last ? 0.4 : 0.14, 'sine', 0.14);
      });
    },

    // Naik level
    levelUp() {
      if (!sfxReady()) return;
      const t = ctx.currentTime;
      [72, 76, 79, 84, 88, 91].forEach((m, i) => {
        tone(sfxBus, mtof(m), t + i * 0.09, 0.25, 'triangle', 0.4);
        tone(sfxBus, mtof(m + 12), t + i * 0.09, 0.15, 'sine', 0.12);
      });
      const end = t + 6 * 0.09;
      [84, 88, 91].forEach((m) => tone(sfxBus, mtof(m), end, 0.8, 'triangle', 0.3));
    },

    // Salah / gugur (lembut, tidak mengagetkan)
    wrong() {
      if (!sfxReady()) return;
      const t = ctx.currentTime;
      slide(sfxBus, 392, 330, t, 0.22, 'triangle', 0.4);
      slide(sfxBus, 330, 247, t + 0.22, 0.4, 'triangle', 0.4);
    }
  };

  /* ==========================================================
     KONTROL (tombol nyala/mati, jeda, pembukaan kunci audio)
     ========================================================== */
  function setMusic(on) {
    settings.music = !!on;
    saveSettings();
    if (musicBus) musicBus.gain.setTargetAtTime(settings.music ? MUSIC_VOLUME : 0, ctx.currentTime, 0.05);
    refreshButtons();
  }

  function setSfx(on) {
    settings.sfx = !!on;
    saveSettings();
    if (sfxBus) sfxBus.gain.setTargetAtTime(settings.sfx ? SFX_VOLUME : 0, ctx.currentTime, 0.05);
    refreshButtons();
  }

  function refreshButtons() {
    document.querySelectorAll('[data-audio]').forEach((btn) => {
      const kind = btn.getAttribute('data-audio');
      const on = kind === 'music' ? settings.music : settings.sfx;
      btn.classList.toggle('off', !on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      const name = kind === 'music' ? 'Musik' : 'Efek suara';
      btn.setAttribute('aria-label', name + (on ? ': nyala' : ': mati'));
      btn.title = name + (on ? ': nyala (klik untuk mematikan)' : ': mati (klik untuk menyalakan)');
    });
  }

  // Browser hanya mengizinkan suara setelah ada sentuhan/klik pemain.
  let unlocked = false;
  const UNLOCK_EVENTS = ['pointerdown', 'touchend', 'click', 'keydown'];

  function unlock() {
    const c = ensureContext();
    if (!c) return;
    startMusic();
    if (mustStayPaused()) return;
    c.resume().then(() => {
      if (c.state === 'running') {
        unlocked = true;
        UNLOCK_EVENTS.forEach((name) => document.removeEventListener(name, unlock, true));
      }
    }).catch(() => {});
  }

  function init() {
    refreshButtons();

    document.querySelectorAll('[data-audio]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const kind = btn.getAttribute('data-audio');
        if (kind === 'music') setMusic(!settings.music);
        else setSfx(!settings.sfx);
      });
    });

    UNLOCK_EVENTS.forEach((name) => document.addEventListener(name, unlock, true));
    document.addEventListener('visibilitychange', applyPause);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.Suara = Object.assign({
    // Dipanggil game.js saat HP tegak (jeda) / kembali landscape (lanjut).
    pause() { externalPause = true; applyPause(); },
    resume() { externalPause = false; applyPause(); },
    setMusic: setMusic,
    setSfx: setSfx,
    isMusicOn() { return settings.music; },
    isSfxOn() { return settings.sfx; }
  }, sfx);
})();
