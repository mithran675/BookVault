/* BookVault — the offline shell.

   This caches the APP: the page, the icon, the manifest. It does not cache the
   books. The books are not files on a server, they are rows in IndexedDB on
   this device, which is why they work offline whether this file runs or not.
   What this adds is the app itself still opening when there is no internet.

   Bump CACHE on every release or phones keep the old copy. */
var CACHE = "bookvault-v2";
var ASSETS = ["./", "./index.html", "./manifest.webmanifest", "./icon.svg",
              "./apple-touch-icon.png"];

/* The two optional outside tools — the PDF reader and the text reader — are
   kept in their own cache with no version in the name, so that updating the
   app does not throw away a 15 MB download the user already waited for. The
   activate handler below spares it by name. */
var EXTRA = "bookvault-tools";
var TOOL_RE = /^https:\/\/cdn\.jsdelivr\.net\/npm\/(pdfjs-dist|tesseract\.js)/;

self.addEventListener("install", function(e){
  e.waitUntil(
    caches.open(CACHE)
      .then(function(c){ return c.addAll(ASSETS); })
      .catch(function(){})
      .then(function(){ return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function(e){
  e.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.map(function(k){
        return (k === CACHE || k === EXTRA) ? null : caches.delete(k);
      }));
    }).then(function(){ return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function(e){
  var req = e.request;
  if(req.method !== "GET") return;

  /* The optional tools: cache first, so the second time they cost nothing and
     may even work with no connection. Fetched with CORS rather than passing an
     opaque request through — an opaque response is counted against the storage
     limit at a padded size far bigger than the file really is. */
  if(TOOL_RE.test(req.url)){
    e.respondWith(
      caches.open(EXTRA).then(function(c){
        return c.match(req).then(function(hit){
          if(hit) return hit;
          return fetch(req.url, {mode:"cors", credentials:"omit"}).then(function(res){
            if(res && res.ok) c.put(req, res.clone()).catch(function(){});
            return res;
          }).catch(function(){
            return fetch(req).catch(function(){
              return new Response("", {status:504, statusText:"Offline"});
            });
          });
        });
      })
    );
    return;
  }

  var url;
  try{ url = new URL(req.url); }catch(e2){ return; }
  if(url.origin !== self.location.origin) return;     /* leave anything else alone */

  var wantsPage = req.mode === "navigate" || req.destination === "document"
               || /\/(index\.html)?$/.test(url.pathname);

  if(wantsPage){
    /* Network first so a new version arrives the moment it is uploaded, with
       the saved copy as the answer when there is no network. The marker check
       is there because a host answering 200 with a "site suspended" page would
       otherwise be written over the good copy and destroy the one thing
       keeping the app working offline.

       no-store on the page fetch, because "network first" was not quite true:
       plain fetch(req) is allowed to be answered out of the browser's own HTTP
       cache, so an app that had already been visited could keep handing back
       yesterday's copy while this code believed it had just been to the
       network. That was caught the hard way — a fix was tested against a
       stale page for half an hour. A data-safety fix nobody receives is not
       a fix, so the page itself is always asked for fresh. */
    var saved = function(orElse){
      return caches.match("./index.html").then(function(hit){
        return hit || orElse || new Response("", {status:504, statusText:"Offline"});
      });
    };
    e.respondWith(
      fetch(req.url, {cache:"no-store", credentials:"same-origin"}).then(function(res){
        if(!res || res.status !== 200) return saved(res);
        var keep = res.clone();
        return res.clone().text().then(function(body){
          if(body.indexOf("__bvError") < 0) return saved(res);
          caches.open(CACHE).then(function(c){ c.put("./index.html", keep); });
          return res;
        }).catch(function(){ return res; });
      }).catch(function(){ return saved(); })
    );
    return;
  }

  e.respondWith(
    caches.match(req).then(function(hit){
      if(hit) return hit;
      return fetch(req).then(function(res){
        if(res && res.status === 200 && res.type === "basic"){
          var copy = res.clone();
          caches.open(CACHE).then(function(c){ c.put(req, copy); }).catch(function(){});
        }
        return res;
      }).catch(function(){
        return new Response("", {status:504, statusText:"Offline"});
      });
    })
  );
});
