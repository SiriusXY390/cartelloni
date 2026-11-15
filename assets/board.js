/* Cartelloni 90 numeri — logica tavola pubblica
   Mostra solo numeri liberi/occupati: nessun nome, nessun dato personale.

   Dati: se assets/firebase-config.js contiene un progetto Firebase, la pagina
   ascolta il documento "boards/<brand>" su Firestore e si aggiorna in tempo
   reale (meno di un secondo). Altrimenti legge data/<brand>.json ogni 20 s. */

(function () {
  const brand = document.body.dataset.brand || 'avon';
  const grid = document.getElementById('grid');
  const statFree = document.getElementById('stat-free');
  const statBusy = document.getElementById('stat-busy');
  const statTotal = document.getElementById('stat-total');
  const progress = document.getElementById('progress-bar');
  const updatedEl = document.getElementById('updated');
  const priceEl = document.querySelectorAll('[data-price]');
  const toast = document.getElementById('toast');

  const TOTAL = 90;
  const FIREBASE_VERSION = '10.14.1';
  let toastTimer = null;
  let liveActive = false;
  let lastSignature = '';

  function showToast(msg) {
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 3200);
  }

  function fmtDate(iso) {
    if (!iso) return null;
    const d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    const today = new Date();
    const sameDay = d.toDateString() === today.toDateString();
    const time = d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    if (sameDay) return `oggi alle ${time}`;
    return d.toLocaleDateString('it-IT', { day: 'numeric', month: 'long' }) + ` alle ${time}`;
  }

  function animateNumber(el, to) {
    const from = Number(el.textContent) || 0;
    if (from === to) return;
    const start = performance.now();
    const dur = 700;
    function tick(now) {
      const p = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(from + (to - from) * eased);
      if (p < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  function updateStamp(meta) {
    if (!updatedEl) return;
    const when = fmtDate(meta.updatedAt);
    if (when) {
      updatedEl.textContent = (liveActive ? 'in tempo reale · aggiornato ' : 'aggiornato ') + when;
    } else {
      updatedEl.textContent = liveActive ? 'in tempo reale' : 'dati di esempio';
    }
  }

  function render(occupied, meta) {
    const busy = new Set(occupied.map(Number));
    const frag = document.createDocumentFragment();

    for (let n = 1; n <= TOTAL; n++) {
      const btn = document.createElement('button');
      const isBusy = busy.has(n);
      btn.className = 'num ' + (isBusy ? 'busy' : 'free');
      btn.style.animationDelay = (n * 9) + 'ms';
      btn.type = 'button';
      btn.dataset.n = String(n);

      if (isBusy) {
        btn.setAttribute('aria-label', `Numero ${n}: occupato`);
        btn.innerHTML = `<span class="n">${n}</span><span class="tick" aria-hidden="true">✓</span>`;
      } else {
        btn.setAttribute('aria-label', `Numero ${n}: libero`);
        btn.innerHTML = `<span class="n">${n}</span>`;
      }

      btn.addEventListener('click', () => {
        if (isBusy) {
          btn.classList.remove('shake');
          void btn.offsetWidth;
          btn.classList.add('shake');
          showToast(`Il numero ${n} è già stato assegnato.`);
        } else {
          showToast(`Il numero ${n} è ancora libero! Scrivimi per aggiudicartelo.`);
        }
      });

      frag.appendChild(btn);
    }

    grid.innerHTML = '';
    grid.appendChild(frag);

    const busyCount = [...busy].filter(n => n >= 1 && n <= TOTAL).length;
    animateNumber(statBusy, busyCount);
    animateNumber(statFree, TOTAL - busyCount);
    if (statTotal) statTotal.textContent = String(meta.total || TOTAL);
    if (progress) progress.style.width = ((busyCount / TOTAL) * 100).toFixed(1) + '%';

    if (meta.price) {
      priceEl.forEach(el => { el.textContent = meta.price + '€'; });
    }

    updateStamp(meta);

    const wa = document.getElementById('wa');
    if (wa) {
      const digits = String(meta.contact || '').replace(/[^\d]/g, '');
      if (digits.length >= 8) {
        const brandName = brand === 'avon' ? 'Avon' : 'Stanhome';
        const msg = `Ciao! Ho visto il cartellone ${brandName} e vorrei un numero. Sono ancora liberi?`;
        wa.href = `https://wa.me/${digits}?text=${encodeURIComponent(msg)}`;
        wa.hidden = false;
      } else {
        wa.hidden = true;
      }
    }
  }

  function signature(occupied, meta) {
    return [
      occupied.map(Number).sort((a, b) => a - b).join(','),
      meta.price || '',
      meta.contact || ''
    ].join('|');
  }

  /** Aggiorna la pagina solo se qualcosa è davvero cambiato. */
  function show(occupied, meta, force) {
    const sig = signature(occupied, meta);
    if (!force && sig === lastSignature) {
      updateStamp(meta);
      return;
    }
    lastSignature = sig;
    render(occupied, meta);
    document.documentElement.dataset.ready = '1';
  }

  function renderSkeleton() {
    const frag = document.createDocumentFragment();
    for (let n = 1; n <= TOTAL; n++) {
      const d = document.createElement('div');
      d.className = 'num skeleton';
      d.style.animationDelay = (n * 5) + 'ms';
      frag.appendChild(d);
    }
    grid.innerHTML = '';
    grid.appendChild(frag);
  }

  // ---------------------------------------------------------------- Firebase

  async function startRealtime() {
    const cfg = window.FIREBASE_CONFIG;
    if (!cfg || !cfg.projectId || !cfg.apiKey) return false;

    let appMod, fsMod;
    try {
      [appMod, fsMod] = await Promise.all([
        import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app.js`),
        import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-firestore.js`)
      ]);
    } catch (err) {
      console.warn('[cartelloni] Firebase non disponibile, uso i dati salvati.', err && err.message);
      return false;
    }

    try {
      const app = appMod.initializeApp(cfg);
      const db = fsMod.getFirestore(app);
      fsMod.onSnapshot(
        fsMod.doc(db, 'boards', brand),
        (snap) => {
          if (!snap.exists()) return;
          const data = snap.data() || {};
          if (!liveActive) {
            liveActive = true;
            document.body.classList.add('is-live');
            document.documentElement.dataset.live = '1';
          }
          show(Array.isArray(data.occupied) ? data.occupied : [], data, false);
        },
        (err) => {
          console.warn('[cartelloni] Firebase non raggiungibile, resto sui dati salvati.', err && err.message);
        }
      );
      return true;
    } catch (err) {
      console.warn('[cartelloni] Firebase non avviato, uso i dati salvati.', err && err.message);
      return false;
    }
  }

  // ---------------------------------------------------------------- fallback

  async function load(force) {
    if (liveActive) return;
    if (force) renderSkeleton();
    try {
      const res = await fetch(`data/${brand}.json?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      if (liveActive) return; // nel frattempo è arrivato il dato in tempo reale
      const occupied = Array.isArray(data.occupied) ? data.occupied : [];
      show(occupied, data, force || lastSignature === '');
    } catch (err) {
      if (lastSignature !== '') return; // we already have something on screen
      render([], { updatedAt: null, price: null });
      if (updatedEl) updatedEl.textContent = 'in attesa del primo aggiornamento';
      if (navigator.onLine) {
        showToast('Dati non ancora pubblicati: il cartellone si aggiorna da solo.');
      }
    }
  }

  renderSkeleton();
  load(true);
  startRealtime();

  // Rete di sicurezza quando Firebase non è configurato: controllo ogni 20 secondi.
  setInterval(() => {
    if (!document.hidden && !liveActive) load(false);
  }, 20000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !liveActive) load(false);
  });
  window.addEventListener('online', () => {
    if (!liveActive) load(false);
  });

  const refreshBtn = document.getElementById('refresh');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      if (liveActive) {
        showToast('Aggiornamento in tempo reale già attivo.');
        return;
      }
      load(true);
      showToast('Aggiornamento in corso…');
    });
  }

  const shareBtn = document.getElementById('share');
  if (shareBtn) {
    const title = document.title;
    const text = `Guarda i numeri ancora liberi del cartellone!`;
    shareBtn.addEventListener('click', async () => {
      const url = location.href;
      if (navigator.share) {
        try { await navigator.share({ title, text, url }); } catch (_) {}
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(url);
        showToast('Link copiato! Incollalo dove vuoi.');
      } else {
        showToast(url);
      }
    });
  }
})();
