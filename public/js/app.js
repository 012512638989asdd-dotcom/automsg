/* ============================
   automsg Dashboard — Shared JS
============================ */

// ── API Helper ──────────────────────────────────────────
const api = {
  async req(method, url, body) {
    const opts = { method, credentials: 'include', headers: {} };
    if (body && !(body instanceof FormData)) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    } else if (body) {
      opts.body = body;
    }
    const r = await fetch(url, opts);
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(data.message || 'خطأ'), { status: r.status, data });
    return data;
  },
  get:    (url)        => api.req('GET', url),
  post:   (url, body)  => api.req('POST', url, body),
  put:    (url, body)  => api.req('PUT', url, body),
  delete: (url)        => api.req('DELETE', url),
};

// ── Toast ────────────────────────────────────────────────
const toasts = (() => {
  const container = document.createElement('div');
  container.className = 'toast-container';
  document.body.appendChild(container);

  const icons = { success: '✓', error: '✕', info: 'ℹ' };
  return {
    show(msg, type = 'info', dur = 3500) {
      const t = document.createElement('div');
      t.className = `toast ${type}`;
      t.innerHTML = `
        <span class="toast-icon">${icons[type] || icons.info}</span>
        <span class="toast-msg">${msg}</span>
        <span class="toast-close" onclick="this.parentElement.remove()">✕</span>`;
      container.appendChild(t);
      setTimeout(() => t.remove(), dur);
    },
    success: (m, d) => toasts.show(m, 'success', d),
    error:   (m, d) => toasts.show(m, 'error',   d),
    info:    (m, d) => toasts.show(m, 'info',     d),
  };
})();

// ── Confirm Dialog ───────────────────────────────────────
function confirm(msg, title = 'تأكيد') {
  return new Promise(resolve => {
    const ov = document.createElement('div');
    ov.className = 'dialog-overlay';
    ov.innerHTML = `
      <div class="dialog">
        <h3>${title}</h3>
        <p>${msg}</p>
        <div class="dialog-actions">
          <button class="btn btn-secondary" id="d-cancel">إلغاء</button>
          <button class="btn btn-danger"    id="d-confirm">تأكيد</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    ov.querySelector('#d-cancel').onclick  = () => { ov.remove(); resolve(false); };
    ov.querySelector('#d-confirm').onclick = () => { ov.remove(); resolve(true);  };
    ov.onclick = e => { if (e.target === ov) { ov.remove(); resolve(false); } };
  });
}

// ── Auth Guard ───────────────────────────────────────────
async function authGuard() {
  try {
    const me = await api.get('/api/auth/me');
    return me;
  } catch {
    location.href = '/';
    return null;
  }
}

// ── Logout ───────────────────────────────────────────────
async function logout() {
  await api.post('/api/auth/logout').catch(() => {});
  location.href = '/';
}

// ── Show/hide admin nav items ────────────────────────────
function showAdminNav(isAdmin) {
  if (isAdmin) {
    document.querySelectorAll('.admin-only').forEach(el => {
      el.style.display = '';
    });
  }
}

// ── Sidebar Toggle ───────────────────────────────────────
function initSidebar(currentPage) {
  const sidebar   = document.getElementById('sidebar');
  const overlay   = document.getElementById('overlay');
  const hamburger = document.getElementById('hamburger');
  if (hamburger && sidebar && overlay) {
    hamburger.onclick = () => {
      sidebar.classList.toggle('open');
      overlay.classList.toggle('show');
    };
    overlay.onclick = () => {
      sidebar.classList.remove('open');
      overlay.classList.remove('show');
    };
  }
  document.querySelectorAll('.nav-item').forEach(a => {
    if (a.dataset.page === currentPage) a.classList.add('active');
  });
}

// ── Format helpers ───────────────────────────────────────
function timeAgo(date) {
  const d = new Date(date), now = new Date();
  const s = Math.floor((now - d) / 1000);
  if (s < 60)    return 'الآن';
  if (s < 3600)  return `${Math.floor(s/60)} د`;
  if (s < 86400) return `${Math.floor(s/3600)} س`;
  return d.toLocaleDateString('ar');
}
function fmtDate(date) {
  return new Date(date).toLocaleString('ar-EG', { dateStyle:'short', timeStyle:'short' });
}
function fmtInterval(secs) {
  if (secs < 60)   return `${secs}ث`;
  if (secs < 3600) return `${Math.floor(secs/60)}د`;
  return `${Math.floor(secs/3600)}س`;
}
function maskToken(t) {
  if (!t) return '—';
  if (t.length <= 8) return '••••••••';
  return '•'.repeat(Math.min(t.length - 4, 20)) + t.slice(-4);
}
