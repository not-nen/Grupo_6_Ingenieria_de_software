// Utilidades compartidas para las páginas del proyecto

function getCookieValue(name) {
  const cookies = document.cookie ? document.cookie.split('; ') : [];
  const cookie = cookies.find((item) => item.startsWith(`${name}=`));
  return cookie ? cookie.substring(name.length + 1) : '';
}

function getCurrentUser() {
  try {
    const storedUser =
      localStorage.getItem('currentUser') ||
      sessionStorage.getItem('currentUser');
    if (storedUser) return JSON.parse(storedUser);
    const cookieUser = getCookieValue('currentUser');
    if (cookieUser) return JSON.parse(decodeURIComponent(cookieUser));
    return null;
  } catch (e) {
    return null;
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
