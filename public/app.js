// Emanet Saha: names the photo an agent took, under the camera button (src/pages.ts photoInput).
(() => {
  const tr = document.documentElement.lang === 'tr';
  for (const input of document.querySelectorAll('input[data-photo]')) {
    const name = input.closest('.photo-field')?.querySelector('[data-photo-name]');
    input.addEventListener('change', () => {
      if (!name) return;
      const file = input.files && input.files[0];
      name.hidden = !file;
      name.textContent = file
        ? tr
          ? `Fotoğraf hazır: ${file.name}`
          : `Photo ready: ${file.name}`
        : '';
    });
  }
})();

// Emanet Saha: fills in the phone's location and time when an agent reports a sighting.
// Without it (location refused, no script) the server falls back to the photo's own GPS data.
(() => {
  const form = document.getElementById('sighting');
  if (!form || !('geolocation' in navigator)) return;
  const status = form.querySelector('[data-location]');
  const set = (name, value) => {
    const input = form.elements.namedItem(name);
    if (input) input.value = String(value);
  };
  const say = (text) => {
    if (status) status.textContent = text;
  };
  const tr = document.documentElement.lang === 'tr';
  navigator.geolocation.watchPosition(
    (position) => {
      set('lat', position.coords.latitude.toFixed(6));
      set('lng', position.coords.longitude.toFixed(6));
      set('accuracy', Math.round(position.coords.accuracy));
      set('taken_at', Date.now());
      say(
        tr
          ? `Konum alındı (±${Math.round(position.coords.accuracy)} m).`
          : `Location found (±${Math.round(position.coords.accuracy)} m).`,
      );
    },
    () => {
      say(
        tr
          ? 'Konum alınamadı. Bu site için konuma izin verin ya da fotoğrafı konum açıkken çekin.'
          : 'No location. Allow location for this site, or take the photo with location on.',
      );
    },
    { enableHighAccuracy: true, maximumAge: 30000, timeout: 20000 },
  );
})();
