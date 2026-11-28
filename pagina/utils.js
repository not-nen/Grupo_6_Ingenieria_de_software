// Utilidades compartidas para las páginas del proyecto

function getCookieValue(name) {
  const cookies = document.cookie ? document.cookie.split("; ") : [];
  const cookie = cookies.find((item) => item.startsWith(`${name}=`));
  return cookie ? cookie.substring(name.length + 1) : "";
}

function base64UrlToUtf8(value) {
  const padded =
    value.replace(/-/g, "+").replace(/_/g, "/") +
    "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

// La cookie de sesión va firmada (payload.firma). El navegador solo lee el payload;
// la firma la valida el servidor.
function decodeSessionToken(token) {
  const raw = decodeURIComponent(token);
  const dot = raw.indexOf(".");
  if (dot > 0 && !raw.trim().startsWith("{")) {
    return JSON.parse(base64UrlToUtf8(raw.slice(0, dot)));
  }
  return JSON.parse(raw);
}

// Cada rol tiene su propia cookie de sesión (ver nombreCookieSesion en index.js).
function getCurrentUser(role) {
  try {
    const cookieUser = getCookieValue(`sesion_${role}`);
    if (!cookieUser) return null;
    const user = decodeSessionToken(cookieUser);
    return user?.role === role ? user : null;
  } catch (e) {
    return null;
  }
}

// Si no hay sesión del rol pedido, vuelve al login.
function requireSession(role) {
  const user = getCurrentUser(role);
  if (!user) {
    window.location.replace("/");
    return null;
  }
  return user;
}

// Recibe la respuesta de /api/estudiante/postulaciones; null si aún puede postular.
function mensajeLimiteAyudantias(data) {
  if (!data) return null;
  const aceptadas = Number(data.ayudantiasAceptadas);
  const maximo = Number(data.maxAyudantiasAceptadas);
  if (!Number.isFinite(aceptadas) || !Number.isFinite(maximo) || aceptadas < maximo) {
    return null;
  }
  return "No puedes postular a más ayudantías";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
