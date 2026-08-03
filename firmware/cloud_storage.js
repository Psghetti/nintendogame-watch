/* ===========================================================================
   firmware/cloud_storage.js  —  load the content pack from your cloud drive
   ---------------------------------------------------------------------------
   Optional "sign in and pick your .zip" providers for the DEPLOYED site.
   Currently: Google Drive, via Google Identity Services (sign-in) + the Google
   Picker, using the narrow `drive.file` scope — the site only ever sees the one
   file the visitor picks, nothing else in their Drive. The chosen .zip is handed
   straight to the SAME content-pack pipeline (window.__GNW_PACK.importZip), so
   after one pick it lives in this browser's IndexedDB and no further sign-in is
   needed. Google's scripts are loaded lazily (only when the button is clicked),
   so normal page loads stay self-contained and offline-friendly.

   Only used when the site is served from a real host (not localhost): the local
   dev server's cross-origin-isolation headers block Google's sign-in popup, and
   locally you can just copy the files down from Drive yourself anyway.

   ┌────────────────────────────────────────────────────────────────────────┐
   │  ►► SET UP GOOGLE DRIVE — paste the two PUBLIC values from your Google    │
   │     Cloud project between the quotes below (see the setup steps in the    │
   │     README). These are NOT secrets — an OAuth *Client ID* and an *API     │
   │     key* are designed to live in client-side code. Leave them blank to    │
   │     simply hide the Google Drive option.                                  │
   └────────────────────────────────────────────────────────────────────────┘ */
(function () {
  'use strict';

  // ---- MASTER SWITCH -------------------------------------------------------
  // Google Drive / cloud storage is intentionally HIDDEN for now (not ready to ship).
  // All the cloud code below stays intact; this one flag gates every cloud UI + provider.
  // TO RE-ENABLE later: set CLOUD_ENABLED = true AND fill in CONFIG.google below.
  var CLOUD_ENABLED = false;

  var CONFIG = {
    google: {
      clientId: '',   // OAuth 2.0 Client ID   e.g. '1234567890-abcd....apps.googleusercontent.com'
      apiKey:   '',   // API key               e.g. 'AIzaSy....'
      appId:    ''    // OPTIONAL: Google Cloud project NUMBER (digits only) — improves drive.file access
    }
  };

  // ---------------------------------------------------------------------------
  var GSI   = 'https://accounts.google.com/gsi/client';   // sign-in / token client
  var GAPI  = 'https://apis.google.com/js/api.js';        // loader for the Picker
  var SCOPE = 'https://www.googleapis.com/auth/drive.file';

  function loadScript(src) {
    return new Promise(function (res, rej) {
      var ex = document.querySelector('script[data-cloud="' + src + '"]');
      if (ex && ex._done) { res(); return; }
      if (ex) { ex.addEventListener('load', function () { res(); }); ex.addEventListener('error', function () { rej(new Error('load ' + src)); }); return; }
      var s = document.createElement('script');
      s.src = src; s.async = true; s.defer = true; s.setAttribute('data-cloud', src);
      s.onload = function () { s._done = true; res(); };
      s.onerror = function () { rej(new Error('Could not load ' + src + ' (offline, or the host blocked it).')); };
      document.head.appendChild(s);
    });
  }

  // ---- Google Drive ---------------------------------------------------------
  var _pickerReady = false;
  function ensureGoogle() {
    return loadScript(GSI).then(function () { return loadScript(GAPI); }).then(function () {
      if (_pickerReady) return;
      return new Promise(function (res, rej) {
        gapi.load('picker', { callback: function () { _pickerReady = true; res(); }, onerror: function () { rej(new Error('Google Picker failed to load.')); } });
      });
    });
  }

  function getToken(clientId) {
    return new Promise(function (res, rej) {
      try {
        var tc = google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: SCOPE,
          callback: function (r) { if (r && r.access_token) res(r.access_token); else rej(new Error('No access token was returned.')); },
          error_callback: function (e) {
            var t = e && e.type;
            rej(new Error((t === 'popup_closed' || t === 'popup_failed_to_open') ? 'cancelled' : ('Sign-in failed: ' + ((e && e.message) || t || 'unknown'))));
          }
        });
        tc.requestAccessToken({ prompt: '' });
      } catch (e) { rej(e); }
    });
  }

  function pickFile(token, cfg) {
    return new Promise(function (res, rej) {
      try {
        var view = new google.picker.DocsView(google.picker.ViewId.DOCS)
          .setMode(google.picker.DocsViewMode.LIST)
          .setMimeTypes('application/zip,application/x-zip-compressed');   // the content pack is a .zip
        var pb = new google.picker.PickerBuilder()
          .addView(view)
          .setOAuthToken(token)
          .setDeveloperKey(cfg.apiKey)
          .setTitle('Pick your Game & Watch content pack (.zip)')
          .setCallback(function (data) {
            var A = google.picker.Action;
            if (data.action === A.PICKED) {
              var d = data.docs && data.docs[0];
              if (d) res({ id: d.id, name: d.name, token: token }); else rej(new Error('Nothing was selected.'));
            } else if (data.action === A.CANCEL) { rej(new Error('cancelled')); }
          });
        if (cfg.appId) pb.setAppId(cfg.appId);
        pb.build().setVisible(true);
      } catch (e) { rej(e); }
    });
  }

  function download(file) {
    return fetch('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(file.id) + '?alt=media', {
      headers: { Authorization: 'Bearer ' + file.token }
    }).then(function (r) {
      if (!r.ok) throw new Error('Download failed (HTTP ' + r.status + ').');
      return r.blob();
    }).then(function (blob) { return { name: file.name, blob: blob }; });
  }

  function googlePick() {
    var cfg = CONFIG.google;
    if (!cfg.clientId || !cfg.apiKey) return Promise.reject(new Error('Google Drive isn’t configured yet.'));
    return ensureGoogle()
      .then(function () { return getToken(cfg.clientId); })
      .then(function (token) { return pickFile(token, cfg); })
      .then(function (file) { return download(file); });
  }

  // ---- provider registry (OneDrive can slot in here later) ------------------
  var PROVIDERS = {
    google: {
      id: 'google', label: 'Google Drive',
      configured: function () { return CLOUD_ENABLED && !!(CONFIG.google.clientId && CONFIG.google.apiKey); },
      pick: googlePick
    }
  };

  window.__GNW_CLOUD = {
    config: CONFIG,
    list: function () { return Object.keys(PROVIDERS).map(function (k) { return { id: k, label: PROVIDERS[k].label, configured: PROVIDERS[k].configured() }; }); },
    anyConfigured: function () { return Object.keys(PROVIDERS).some(function (k) { return PROVIDERS[k].configured(); }); },
    configured: function (id) { return !!(PROVIDERS[id] && PROVIDERS[id].configured()); },
    // pick(id) -> Promise<{ name, blob }>; rejects with message 'cancelled' if the user backs out.
    pick: function (id) { return PROVIDERS[id] ? PROVIDERS[id].pick() : Promise.reject(new Error('Unknown provider: ' + id)); }
  };
})();
