// Utilidades compartidas para las páginas del proyecto

function getCookieValue(name) {
  const cookies = document.cookie ? document.cookie.split('; ') : [];
  const cookie = cookies.find((item) => item.startsWith(`${name}=`));
  return cookie ? cookie.substring(name.length + 1) : '';
}

// Cada rol tiene su propia cookie de sesión (ver nombreCookieSesion en index.js).
function getCurrentUser(role) {
  try {
    const cookieUser = getCookieValue(`sesion_${role}`);
    return cookieUser ? JSON.parse(decodeURIComponent(cookieUser)) : null;
  } catch (e) {
    return null;
  }
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
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
