importScripts('../shared/sw-factory.js');
toolboxSW('chess-v1', ['./', 'index.html', 'app.js', 'app.css', 'board.js', 'repertoire.js', 'engine.js', 'vendor/chess.js', 'vendor/pieces.svg',
  'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-180.png', '../shared/style.css', '../shared/store.js', '../shared/pwa.js']);
