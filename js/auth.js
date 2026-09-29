(() => {
    const notice = document.getElementById('auth-notice');
    const start = document.getElementById('btn-welcome-start');
    const retry = document.getElementById('btn-auth-retry');
    const app = document.getElementById('app-container');
    const welcome = document.getElementById('welcome-screen');
    let activeUserId = null;
    let opening = false;

    function showError(message) {
        notice.textContent = message;
        retry.classList.remove('hidden');
    }

    function loadScript(src, attributes = {}) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src;
            script.async = true;
            for (const [key, value] of Object.entries(attributes)) script.setAttribute(key, value);
            script.onload = resolve;
            script.onerror = () => reject(new Error('No se pudo cargar el acceso. Revisá tu conexión y reintentá.'));
            document.head.appendChild(script);
        });
    }

    window.geoAuth = {
        userId: null,
        async fetch(path, options = {}) {
            const url = new URL(path, location.origin);
            if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) throw new Error('Destino no permitido.');
            const token = await window.Clerk?.session?.getToken();
            if (!token) throw new Error('Iniciá sesión para continuar.');
            const headers = new Headers(options.headers);
            headers.set('Authorization', `Bearer ${token}`);
            const response = await fetch(url, { ...options, headers, cache: 'no-store', credentials: 'omit' });
            if (response.status === 401) {
                app.classList.add('hidden');
                welcome.classList.remove('hidden');
                showError('Tu sesión venció. Volvé a ingresar.');
            }
            return response;
        }
    };

    async function openApp(clerk) {
        if (opening || activeUserId || !clerk.session || !clerk.user) return;
        opening = true;
        try {
            const sessionId = clerk.session.id;
            const response = await window.geoAuth.fetch('/api/session');
            if (!response.ok) throw new Error('No se pudo validar tu sesión. Reintentá en unos instantes.');
            const { userId } = await response.json();
            if (clerk.user?.id !== userId || clerk.session?.id !== sessionId) return;
            activeUserId = userId;
            window.geoAuth.userId = userId;
            document.getElementById('auth-user-name').textContent = clerk.user.fullName || clerk.user.primaryEmailAddress?.emailAddress || 'Mi cuenta';
            await loadScript('/js/script.js');
            if (clerk.user?.id !== userId || clerk.session?.id !== sessionId) { location.reload(); return; }
            app.classList.remove('hidden');
            welcome.classList.add('hidden');
            window.initializeGeoVision();
            clerk.mountUserButton(document.getElementById('clerk-user-button'));
        } catch (error) {
            app.classList.add('hidden');
            welcome.classList.remove('hidden');
            showError(error.message || 'No se pudo abrir GeoVision.');
        } finally { opening = false; }
    }

    async function initialize() {
        retry.onclick = () => location.reload();
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch(() => {});
        }
        try {
            const response = await fetch('/api/config', { cache: 'no-store' });
            if (!response.ok) throw new Error(response.status === 503
                ? 'El acceso todavía no está habilitado. Contactá al administrador.'
                : 'No se pudo conectar. Revisá tu conexión y reintentá.');
            const { publishableKey } = await response.json();
            const host = atob(publishableKey.slice(8).replace(/-/g, '+').replace(/_/g, '/')).replace(/\$$/, '');
            if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z]{2,}$/i.test(host)) throw new Error('Configuración de acceso inválida.');
            await loadScript(`https://${host}/npm/@clerk/ui@1/dist/ui.browser.js`, { crossorigin: 'anonymous' });
            await loadScript(`https://${host}/npm/@clerk/clerk-js@6/dist/clerk.browser.js`, {
                crossorigin: 'anonymous', 'data-clerk-publishable-key': publishableKey
            });
            const clerk = window.Clerk;
            await clerk.load({ ui: { ClerkUI: window.__internal_ClerkUICtor } });
            start.disabled = false;
            notice.textContent = 'Iniciá sesión para continuar.';
            start.onclick = () => clerk.session ? openApp(clerk) : clerk.openSignIn();
            document.getElementById('btn-sign-out').onclick = async () => {
                app.classList.add('hidden');
                welcome.classList.remove('hidden');
                try { await clerk.signOut(); location.reload(); }
                catch { showError('No se pudo cerrar la sesión. Revisá tu conexión y reintentá.'); }
            };
            clerk.addListener(({ user, session }) => {
                if (activeUserId && (!session || user?.id !== activeUserId)) {
                    app.classList.add('hidden');
                    welcome.classList.remove('hidden');
                    location.reload();
                    return;
                }
                if (session && user) void openApp(clerk);
            });
            await openApp(clerk);
        } catch (error) { showError(error.message || 'No se pudo iniciar el servicio de acceso.'); }
    }

    void initialize();
})();
