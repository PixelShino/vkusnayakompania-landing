(() => {
  const CSS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
  const JS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
  let loading = null;

  function loadLeaflet() {
    if (window.L) return Promise.resolve(window.L);
    if (loading) return loading;
    loading = new Promise((resolve, reject) => {
      if (!document.querySelector('link[data-leaflet]')) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = CSS;
        link.integrity = 'sha384-sHL9NAb7lN7rfvG5lfHpm643Xkcjzp4jFvuavGOndn6pjVqS6ny56CAt3nsEVT4H';
        link.crossOrigin = 'anonymous';
        link.setAttribute('data-leaflet', '');
        document.head.appendChild(link);
      }
      const s = document.createElement('script');
      s.src = JS;
      s.integrity = 'sha384-cxOPjt7s7Iz04uaHJceBmS+qpjv2JkIHNVcuOrM+YHwZOmJGBXI00mdUXEq65HTH';
      s.crossOrigin = 'anonymous';
      s.onload = () => resolve(window.L);
      s.onerror = reject;
      document.head.appendChild(s);
    });
    return loading;
  }

  class OsmMap extends HTMLElement {
    connectedCallback() {
      if (this._done) return;
      this._done = true;
      this.style.display = 'block';
      this.style.width = '100%';
      this.style.height = '100%';
      const host = document.createElement('div');
      host.style.cssText = 'position:absolute;inset:0';
      this.appendChild(host);

      const lat = parseFloat(this.getAttribute('lat') || '53.1959');
      const lng = parseFloat(this.getAttribute('lng') || '50.1008');
      const zoom = parseFloat(this.getAttribute('zoom') || '12');
      let pins = [];
      try { pins = JSON.parse(this.getAttribute('pins') || '[]'); } catch (e) { pins = []; }

      loadLeaflet().then((L) => {
        const map = L.map(host, { zoomControl: true, scrollWheelZoom: false, attributionControl: true })
          .setView([lat, lng], zoom);
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '© OpenStreetMap contributors',
          maxZoom: 19
        }).addTo(map);

        const icon = (label) => L.divIcon({
          className: '',
          html: '<div style="width:34px;height:34px;border-radius:999px;background:#2C2927;color:#FFFAED;' +
            'font:600 15px/34px Montserrat,system-ui,sans-serif;text-align:center;' +
            'box-shadow:0 2px 8px rgba(28,24,20,.35);border:2px solid #FFFAED">' + label + '</div>',
          iconSize: [34, 34],
          iconAnchor: [17, 17]
        });

        const group = [];
        pins.forEach((p, i) => {
          const mk = L.marker([p.lat, p.lng], { icon: icon(p.label || String(i + 1)) }).addTo(map);
          if (p.title) mk.bindPopup(p.title);
          group.push([p.lat, p.lng]);
        });
        if (group.length > 1) map.fitBounds(group, { padding: [42, 42] });
        setTimeout(() => map.invalidateSize(), 120);
        this._map = map;
      });
    }
  }

  if (!customElements.get('osm-map')) customElements.define('osm-map', OsmMap);
})();
