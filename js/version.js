// Versión de la app: se muestra arriba a la derecha. Subir este número (y CACHE_NAME en sw.js) en cada cambio.
const APP_VERSION = { numero: 34, fecha: '29/10/2026' };
(function () {
  function mostrar() {
    const h = document.querySelector('.app-header');
    if (!h || document.getElementById('app-version')) return;
    const b = document.createElement('button');
    b.type = 'button'; b.id = 'app-version'; b.className = 'app-version';
    b.textContent = 'v' + APP_VERSION.numero;
    b.title = 'Versión ' + APP_VERSION.numero + ' · ' + APP_VERSION.fecha;
    b.addEventListener('click', () => { b.textContent = b.textContent.indexOf('·') < 0 ? 'v' + APP_VERSION.numero + ' · ' + APP_VERSION.fecha : 'v' + APP_VERSION.numero; });
    h.appendChild(b);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mostrar); else mostrar();
})();
