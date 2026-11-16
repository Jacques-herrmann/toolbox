// Enregistre le service worker de l'app courante (sw.js dans le même dossier).
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(console.error);
}
