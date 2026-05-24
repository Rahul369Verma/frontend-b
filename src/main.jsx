import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import axios from 'axios'
import './index.css'
import App from './App.jsx'

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
window.fetch = (input, init = {}) => {
    if (init.credentials === undefined) init.credentials = 'include';
    return _origFetch(input, init);
};

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
