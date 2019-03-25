// suicide_worker.js (sw.js) - delete all cache

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keyList) {
      return Promise.all(keyList.map(function(key) {
        return caches.delete(key);
      }));
    })
  );
});