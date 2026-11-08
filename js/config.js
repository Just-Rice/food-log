// Site configuration. Everything here is public by design: a Firebase web
// config and a reCAPTCHA site key identify the project, they do not grant
// access. Access is guarded by App Check (reCAPTCHA Enterprise), a per-user
// rate limit on the Firebase AI Logic API, and the Firestore security rules.

(function () {
  'use strict';

  window.FoodLogConfig = {
    FIREBASE: {
      apiKey: 'AIzaSyAGcaHvbQPPNW0dmNoFLHgA-uOHsBhf3so',
      authDomain: 'food-log-2ceca.firebaseapp.com',
      projectId: 'food-log-2ceca',
      storageBucket: 'food-log-2ceca.firebasestorage.app',
      messagingSenderId: '722508990106',
      appId: '1:722508990106:web:6993ac7ac7d2a3939d4123'
    },
    RECAPTCHA_SITE_KEY: '6Lc3pBUuAAAAALmy3H3QN_lYgTyK48grlASss9vj',
    FIREBASE_SDK: 'https://www.gstatic.com/firebasejs/13.1.0/',

    // Free Gemini models that read images, in the order a photo tries them.
    // Each has its own daily allowance (Google AI Studio, November 2026):
    // the Flash-Lite models 500 requests a day, the Flash models 20. In a
    // five-photo comparison 3.5 Flash-Lite named foods about as well as 3.8
    // Flash, answered in 1-2 s against 2-3 minutes, and never failed, so it
    // leads. Edit this list when Google changes its models.
    MODELS: [
      'gemini-3.5-flash-lite',
      'gemini-3.1-flash-lite',
      'gemini-3.8-flash',
      'gemini-3.6-flash',
      'gemini-3-flash-preview'
    ],
    // "Try a stronger model" on the review screen.
    STRONGER: 'gemini-3.8-flash',
    // Display names for the review screen.
    MODEL_NAMES: {
      'gemini-3.5-flash-lite': 'Gemini 3.5 Flash-Lite',
      'gemini-3.1-flash-lite': 'Gemini 3.1 Flash-Lite',
      'gemini-3.8-flash': 'Gemini 3.8 Flash',
      'gemini-3.6-flash': 'Gemini 3.6 Flash',
      'gemini-3-flash-preview': 'Gemini 3 Flash (preview)'
    }
  };
})();
