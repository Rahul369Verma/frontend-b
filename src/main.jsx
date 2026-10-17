import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import axios from 'axios'
import './index.css'
import App from './App.jsx'
import { API_URL } from './config/api.js'
import { installSlownessReporter } from './utils/slownessReporter.js'

// ── Global axios + fetch defaults ───────────────────────────────────────────
// MUST run before any component fires its first request, so we set this at
// module-init time rather than inside React's useEffect (which runs after the
// first render).
//
// Why `withCredentials`:
//   The dashboard auth uses an HttpOnly session cookie. Cross-origin browsers
//   only attach it when the request explicitly opts in. Without this, every
//   API call comes back 401 even with a valid session.
axios.defaults.withCredentials = true;

// Same idea for native fetch() — patch it once so every call includes
// credentials by default. Components that already pass options keep their
// settings; we only fill in `credentials` when it's absent.
const _origFetch = window.fetch.bind(window);
const _credFetch = (input, init = {}) => {
    if (init.credentials === undefined) init.credentials = 'include';
    return _origFetch(input, init);
};

// ── Slowness reporting (utils/slownessReporter.js) ──────────────────────────
// Frozen screens (≥ 500 ms) and API answers that took ≥ 5 s end to end go to
// the server every 30 s and become notifications (bell + Telegram). Wraps axios
// and fetch, so it must also run before the first request.
const _slow = installSlownessReporter({ axios, apiUrl: API_URL, fetchImpl: _credFetch });
window.fetch = _slow.fetch || _credFetch;

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
