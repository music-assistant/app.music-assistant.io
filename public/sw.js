/**
 * Cleanup Service Worker for Music Assistant PWA Migration
 *
 * This service worker handles the migration of existing PWA users who have
 * the old app installed (pointing to /) to the new channel-based structure
 * (/stable, /beta, /nightly).
 *
 * It immediately unregisters itself and clears all caches to force a fresh
 * load from the new channel URLs where the proper service workers exist.
 */

// On install, activate immediately
self.addEventListener('install', (event) => {
  console.log('[SW] Cleanup service worker installed - will clear old caches');
  self.skipWaiting();
});

// On activate, clear all caches and unregister
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      console.log('[SW] Cleaning up old caches...');

      // Delete all caches
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames.map(cacheName => {
          console.log('[SW] Deleting cache:', cacheName);
          return caches.delete(cacheName);
        })
      );

      // Take control of all clients immediately
      await self.clients.claim();

      // Notify all clients to reload
      const clients = await self.clients.matchAll({ type: 'window' });
      clients.forEach(client => {
        console.log('[SW] Notifying client to reload');
        client.postMessage({ type: 'FORCE_RELOAD' });
      });

      // Unregister this service worker after cleanup
      const registration = await self.registration;
      console.log('[SW] Unregistering cleanup service worker');
      await registration.unregister();

      console.log('[SW] Cleanup complete');
    })()
  );
});

// Don't cache anything - just pass through
self.addEventListener('fetch', (event) => {
  // Let all requests pass through without caching
  event.respondWith(fetch(event.request));
});
