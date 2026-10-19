(() => {
    const notice = document.getElementById('auth-notice');
    const start = document.getElementById('btn-welcome-start');
    const retry = document.getElementById('btn-auth-retry');
    let app = null;
    const welcome = document.getElementById('welcome-screen');
    let activeUserId = null;
    let opening = false;
    let locked = false;
    let leaseUntil = 0;

    function lock(message) {
        locked = true;
        activeUserId = null;
        window.geoAuth.userId = null;
        if (app) app.classList.add('hidden');
        document.getElementById('private-root')?.replaceChildren();
        welcome.classList.remove('hidden');
        showError(message);
        // Destroy map, photos, pending callbacks and object URLs in this document.
        // Account-scoped persistent drafts remain intact for their owner.
        location.reload();
    }

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
            if (locked || navigator.onLine === false) throw new Error('Se requiere conexión y una sesión validada.');
            const url = new URL(path, location.origin);
            if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) throw new Error('Destino no permitido.');
            const token = await window.Clerk?.session?.getToken();
            if (!token) {
                if (activeUserId) lock('Tu sesión venció. Volvé a ingresar.');
                throw new Error('Iniciá sesión para continuar.');
            }
            const headers = new Headers(options.headers);
            headers.set('Authorization', `Bearer ${token}`);
            const response = await fetch(url, { ...options, headers, cache: 'no-store', credentials: 'omit', redirect: 'error', signal: options.signal || AbortSignal.timeout(15000) });
            if (response.status === 401) {
                if (activeUserId) lock('Tu sesión venció. Volvé a ingresar.');
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
            leaseUntil = Date.now() + 60000;
            document.getElementById('private-root').append(document.getElementById('private-template').content.cloneNode(true));
            app = document.getElementById('app-container');
            document.getElementById('auth-user-name').textContent = clerk.user.fullName || clerk.user.primaryEmailAddress?.emailAddress || 'Mi cuenta';
            await loadScript('/js/script.js');
            if (clerk.user?.id !== userId || clerk.session?.id !== sessionId) { location.reload(); return; }
            app.classList.remove('hidden');
            welcome.classList.add('hidden');
            window.initializeGeoVision();
            clerk.mountUserButton(document.getElementById('clerk-user-button'));
        } catch (error) {
            if (activeUserId) { lock('No se pudo abrir GeoVision.'); return; }
            app?.classList.add('hidden');
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
            if (window.sessionStorage?.getItem('geovision:signout-pending')) {
                await clerk.signOut();
                window.sessionStorage.removeItem('geovision:signout-pending');
            }
            start.disabled = false;
            notice.textContent = 'Iniciá sesión para continuar.';
            start.onclick = () => clerk.session ? openApp(clerk) : clerk.openSignIn({
                forceRedirectUrl: location.origin + '/', transferable: false, withSignUp: false,
                appearance: { elements: { footerAction: { display: 'none' } } }
            });
            document.addEventListener('click', async event => {
                if (!event.target.closest('#btn-sign-out')) return;
                window.sessionStorage?.setItem('geovision:signout-pending', '1');
                locked = true;
                window.geoAuth.userId = null;
                app?.classList.add('hidden');
                document.getElementById('private-root').replaceChildren();
                try {
                    await clerk.signOut();
                    window.sessionStorage?.removeItem('geovision:signout-pending');
                }
                catch { /* Reload remains locked until the server can validate again. */ }
                finally { location.reload(); }
            });
            clerk.addListener(({ user, session }) => {
                if (activeUserId && (!session || user?.id !== activeUserId)) {
                    lock('La sesión cambió. Volvé a ingresar.');
                    return;
                }
                if (session && user) void openApp(clerk);
            });
            await openApp(clerk);
            let validating = false;
            const validate = async () => {
                if (!activeUserId || locked || validating) return;
                if (Date.now() >= leaseUntil || navigator.onLine === false) {
                    lock('Volvé a validar tu sesión para continuar.'); return;
                }
                validating = true;
                try {
                    const response = await window.geoAuth.fetch('/api/session');
                    if (!response.ok || (await response.json()).userId !== activeUserId) throw new Error();
                    leaseUntil = Date.now() + 60000;
                } catch { lock('No se pudo validar tu sesión.'); }
                finally { validating = false; }
            };
            setInterval(validate, 30000);
            window.addEventListener('offline', () => { if (activeUserId) lock('Se requiere conexión.'); });
            document.addEventListener('visibilitychange', () => { if (!document.hidden) void validate(); });
            window.addEventListener('pageshow', () => { void validate(); });
        } catch (error) { showError(error.message || 'No se pudo iniciar el servicio de acceso.'); }
    }

    void initialize();
})();
