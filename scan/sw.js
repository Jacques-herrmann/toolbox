importScripts('../shared/sw-factory.js');
toolboxSW('scan-v1', ['./', 'index.html', 'app.js', 'detect.js', 'manifest.webmanifest', 'icon.svg',
  '../shared/style.css', '../shared/store.js', '../shared/pwa.js']);
