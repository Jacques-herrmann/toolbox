importScripts('../shared/sw-factory.js');
toolboxSW('scan-v2', ['./', 'index.html', 'app.js', 'detect.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-180.png',
  '../shared/style.css', '../shared/store.js', '../shared/pwa.js']);
