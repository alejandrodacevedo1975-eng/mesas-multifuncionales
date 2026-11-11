(function () {
  try {
    var r = JSON.parse(localStorage.getItem('mm_ref') || 'null');
    if (!r || !r.c || (Date.now() - r.t) >= 2592000000) return;
    var L = document.querySelectorAll('a[href*="wa.me"]');
    for (var i = 0; i < L.length; i++) {
      var a = L[i];
      if (a.id === 'mmWa') continue;
      a.setAttribute('href', '#pedido');
      a.removeAttribute('target');
      a.removeAttribute('rel');
      for (var j = a.childNodes.length - 1; j >= 0; j--) {
        var n = a.childNodes[j];
        if (n.nodeType === 3 && n.textContent.trim()) { n.textContent = ' Hacer mi pedido '; break; }
      }
    }
  } catch (e) {}
})();
