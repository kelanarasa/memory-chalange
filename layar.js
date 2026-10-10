/* Layar: bingkai 16:9, layar penuh, dan pemberitahuan landscape.
   Dimuat di <head> sebelum game.js. Tidak bergantung pada file lain. */
(function () {
  'use strict';
  var W = 960, H = 540;                       // ukuran desain bingkai (rasio 16:9)
  var root = document.documentElement;
  var coarse = window.matchMedia('(pointer: coarse)');   // true di layar sentuh (HP/tablet)

  // ---- skala bingkai agar selalu muat di layar, rasio 16:9 terjaga ----
  function fit() {
    var w = window.innerWidth, h = window.innerHeight;
    root.style.setProperty('--fit', Math.min(w / W, h / H));
    // HP/tablet posisi tegak: tampilkan pemberitahuan, permainan menunggu
    root.classList.toggle('tegak', h > w && coarse.matches);
  }
  fit();
  window.addEventListener('resize', fit);
  window.addEventListener('orientationchange', function () { setTimeout(fit, 250); });

  // ---- layar penuh ----
  var canFs = !!(root.requestFullscreen || root.webkitRequestFullscreen);
  var standalone = window.navigator.standalone ||
    window.matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches;
  if (standalone) root.classList.add('no-fs');   // sudah tampil penuh (mis. dipasang di layar utama)

  function isFs() { return !!(document.fullscreenElement || document.webkitFullscreenElement); }

  function lock(on) {
    try {
      if (!screen.orientation) return;
      if (on && screen.orientation.lock) screen.orientation.lock('landscape').catch(function () {});
      if (!on && screen.orientation.unlock) screen.orientation.unlock();
    } catch (e) { /* tidak didukung: abaikan */ }
  }

  var toastTimer = null;
  function toast(text) {
    var t = document.getElementById('toast');
    if (!t) return;
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 4500);
  }

  function toggleFs() {
    if (!canFs) {   // contoh: Safari di iPhone
      toast('Browser ini tidak mendukung layar penuh. Di iPhone: ketuk Bagikan, lalu "Tambah ke Layar Utama".');
      return;
    }
    if (isFs()) {
      (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      return;
    }
    var req = root.requestFullscreen || root.webkitRequestFullscreen;
    var p;
    try { p = req.call(root); } catch (e) { p = Promise.reject(e); }
    Promise.resolve(p).then(function () { lock(true); }).catch(function () {
      toast('Layar penuh tidak diizinkan oleh browser ini.');
    });
  }

  function onFsChange() {
    root.classList.toggle('is-fs', isFs());
    if (!isFs()) lock(false);
    setTimeout(fit, 120);
  }
  document.addEventListener('fullscreenchange', onFsChange);
  document.addEventListener('webkitfullscreenchange', onFsChange);

  // semua tombol dengan atribut data-fs menjadi tombol layar penuh
  document.addEventListener('click', function (e) {
    if (e.target.closest && e.target.closest('[data-fs]')) toggleFs();
  });
  // pintasan keyboard di laptop: tekan F
  document.addEventListener('keydown', function (e) {
    if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey && !e.altKey &&
        !/^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || '')) {
      toggleFs();
    }
  });

  window.Layar = { fit: fit, toggleFullscreen: toggleFs };
})();
