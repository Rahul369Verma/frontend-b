/**
 * api.js — the one place the backend origin is defined.
 *
 * WHY. Fifteen modules each declared their own copy of this expression, in three
 * slightly different shapes. Twelve were byte-identical, and the other three
 * differed in ways that are easy to misread as bugs but are not:
 * `API_BASE`/`SOCKET_URL` deliberately omit `/api` because socket.io and a few
 * non-API endpoints hang off the origin itself. Keeping all three shapes here,
 * named for what they are, means the distinction is explicit instead of looking
 * like drift — and changing the origin is one edit rather than fifteen.
 *
 *   API_ORIGIN  the server origin, no path      → socket.io, non-API routes
 *   API_URL     API_ORIGIN + '/api'             → every REST call
 */
export const API_ORIGIN = import.meta.env.VITE_API_URL || 'http://localhost:5000';
export const API_URL = `${API_ORIGIN}/api`;

/** Alias kept because both names are already in use across the app. */
export const API_BASE = API_ORIGIN;
export const SOCKET_URL = API_ORIGIN;

export default API_URL;
