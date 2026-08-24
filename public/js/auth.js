/**
 * Google OAuth Authentication & Whitelist Guard Service
 * Restricts access exclusively to:
 * - jaffadan@gmail.com
 * - Tracy734g@gmail.com
 */

const LOCAL_CLIENT_ID_STORAGE = 'fantasy_draft_google_client_id';

export class AuthService {
  constructor() {
    this.user = null;
    this.googleClientId = localStorage.getItem(LOCAL_CLIENT_ID_STORAGE) || '816919087026-400mjujbr7cklrmbulggu1jhf0jf03o5.apps.googleusercontent.com';
    this.allowedEmails = ['jaffadan@gmail.com', 'tracy734g@gmail.com'];
    this.authListeners = [];
    this.isInitialized = false;
  }

  onAuthStateChanged(callback) {
    this.authListeners.push(callback);
    if (this.isInitialized) {
      callback(Boolean(this.user), this.user);
    }
  }

  notifyListeners() {
    for (const cb of this.authListeners) {
      try {
        cb(Boolean(this.user), this.user);
      } catch (e) {
        console.error('Auth state listener error:', e);
      }
    }
  }

  async init() {
    // 1. Fetch server auth config
    try {
      const configRes = await fetch('/api/auth/config');
      if (configRes.ok) {
        const configData = await configRes.json();
        if (configData.googleClientId) {
          this.googleClientId = configData.googleClientId;
        }
        if (configData.allowedEmails && Array.isArray(configData.allowedEmails)) {
          this.allowedEmails = configData.allowedEmails;
        }
      }
    } catch (e) {
      console.warn('Could not fetch /api/auth/config, using client defaults', e);
    }

    // 2. Check current session cookie with server
    try {
      const meRes = await fetch('/api/auth/me');
      if (meRes.ok) {
        const meData = await meRes.json();
        if (meData.authenticated && meData.user) {
          this.user = meData.user;
        }
      }
    } catch (e) {
      console.warn('Could not check /api/auth/me', e);
    }

    this.isInitialized = true;
    this.notifyListeners();

    // 3. If unauthenticated, setup Google Identity Services
    if (!this.user) {
      this.setupGoogleSignIn();
    }
  }

  setClientId(clientId) {
    this.googleClientId = (clientId || '').trim();
    localStorage.setItem(LOCAL_CLIENT_ID_STORAGE, this.googleClientId);
    this.setupGoogleSignIn();
  }

  setupGoogleSignIn() {
    const renderBtn = () => {
      const btnContainer = document.getElementById('google-signin-btn-container');
      if (!btnContainer) return;

      if (!window.google || !window.google.accounts || !window.google.accounts.id) {
        // Retry when GSI script finishes loading
        setTimeout(renderBtn, 200);
        return;
      }

      const activeClientId = this.googleClientId || 'YOUR_GOOGLE_CLIENT_ID';

      window.google.accounts.id.initialize({
        client_id: activeClientId,
        callback: (resp) => this.handleGoogleCredential(resp),
        auto_select: false,
        cancel_on_tap_outside: true
      });

      btnContainer.innerHTML = '';
      window.google.accounts.id.renderButton(btnContainer, {
        theme: 'filled_blue',
        size: 'large',
        type: 'standard',
        shape: 'pill',
        text: 'signin_with',
        logo_alignment: 'left',
        width: 280
      });
    };

    renderBtn();
  }

  async handleGoogleCredential(response) {
    const errorEl = document.getElementById('auth-error-msg');
    const loadingEl = document.getElementById('auth-loading-spinner');

    if (errorEl) {
      errorEl.classList.add('hidden');
      errorEl.textContent = '';
    }
    if (loadingEl) loadingEl.classList.remove('hidden');

    try {
      const serverRes = await fetch('/api/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential: response.credential })
      });

      const data = await serverRes.json();

      if (serverRes.ok && data.success && data.user) {
        this.user = data.user;
        this.notifyListeners();
      } else {
        if (serverRes.status === 403 || data.error === 'UNAUTHORIZED_EMAIL') {
          this.showAuthError(data.message || 'Access Denied: Your Google account is not on the authorized manager list.');
        } else {
          this.showAuthError(data.error || 'Failed to authenticate with Google.');
        }
      }
    } catch (e) {
      console.error('Google Auth submission error:', e);
      this.showAuthError(`Sign-in error: ${e.message}`);
    } finally {
      if (loadingEl) loadingEl.classList.add('hidden');
    }
  }

  showAuthError(msg) {
    const errorEl = document.getElementById('auth-error-msg');
    if (errorEl) {
      errorEl.textContent = msg;
      errorEl.classList.remove('hidden');
    }
  }

  async logout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch (e) {
      console.warn('Logout API error:', e);
    }
    this.user = null;
    this.notifyListeners();
    this.setupGoogleSignIn();
  }
}
