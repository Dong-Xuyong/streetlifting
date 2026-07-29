/* Streetlifting — rest timer */
(function () {
  "use strict";

  window.SL = window.SL || {};

  var intervalId = null;
  var remainingSec = 0;
  var endAt = 0;
  var totalSec = 0;
  var tickCb = null;
  var doneCb = null;
  var notificationPermissionAsked = false;

  function clearTimer() {
    if (intervalId != null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  }

  function emitTick(onTick) {
    if (typeof onTick === "function") onTick(remainingSec);
  }

  function vibrateEnabled() {
    try {
      if (!SL.store || typeof SL.store.get !== "function") return true;
      var data = SL.store.get();
      if (!data || !data.settings) return true;
      return data.settings.vibrate !== false;
    } catch (e) {
      return true;
    }
  }

  /**
   * Request Notification permission once, lazily on first rest completion.
   * Never throws; no-op when Notification API is missing.
   */
  function requestNotificationPermissionLazy() {
    if (notificationPermissionAsked) return;
    if (typeof Notification === "undefined") return;
    try {
      if (Notification.permission !== "default") return;
      notificationPermissionAsked = true;
      Notification.requestPermission();
    } catch (e) {
      notificationPermissionAsked = true;
    }
  }

  /**
   * Completion feedback: vibrate + Notification when allowed.
   * Silent no-op when unsupported, denied, or settings.vibrate is false.
   * Never throws.
   */
  function notifyOnDone() {
    try {
      if (!vibrateEnabled()) return;

      if (
        typeof navigator !== "undefined" &&
        typeof navigator.vibrate === "function"
      ) {
        try {
          navigator.vibrate([200, 100, 200]);
        } catch (eVibrate) {
          /* ignore */
        }
      }

      requestNotificationPermissionLazy();

      if (
        typeof Notification !== "undefined" &&
        Notification.permission === "granted"
      ) {
        try {
          new Notification("Rest complete", {
            body: "Time for your next set",
            silent: false,
          });
        } catch (eNotify) {
          /* ignore */
        }
      }
    } catch (e) {
      /* never throw */
    }
  }

  function finish() {
    remainingSec = 0;
    endAt = 0;
    clearTimer();
    var onTick = tickCb;
    var onDone = doneCb;
    emitTick(onTick);
    notifyOnDone();
    tickCb = null;
    doneCb = null;
    if (typeof onDone === "function") onDone();
  }

  /**
   * Start (or restart) a countdown. Uses wall-clock end time so background
   * tab throttling does not stretch rest on the gym floor.
   * @param {number} seconds
   * @param {function(number)=} onTick remaining whole seconds
   * @param {function()=} onDone
   */
  function start(seconds, onTick, onDone) {
    clearTimer();
    tickCb = onTick;
    doneCb = onDone;
    remainingSec = Math.max(0, Math.floor(Number(seconds) || 0));
    totalSec = remainingSec;
    if (remainingSec <= 0) {
      finish();
      return;
    }
    endAt = Date.now() + remainingSec * 1000;
    emitTick(onTick);

    intervalId = setInterval(function () {
      var left = Math.ceil((endAt - Date.now()) / 1000);
      if (left <= 0) {
        finish();
        return;
      }
      if (left !== remainingSec) {
        remainingSec = left;
        emitTick(tickCb);
      }
    }, 250);
  }

  /**
   * Start rest using the store's per-exercise duration (fallback 180).
   * @param {string} exerciseId
   * @param {function(number)=} onTick
   * @param {function()=} onDone
   */
  function startFor(exerciseId, onTick, onDone) {
    var seconds = 180;
    try {
      if (SL.store && typeof SL.store.restSecondsFor === "function") {
        var n = Number(SL.store.restSecondsFor(exerciseId));
        if (isFinite(n)) {
          seconds = Math.max(0, Math.floor(n));
        }
      }
    } catch (e) {
      seconds = 180;
    }
    start(seconds, onTick, onDone);
  }

  /**
   * Add or subtract seconds on a running timer. Floors at 0.
   * Adjusting to 0 finishes the timer (notify + onDone).
   * @param {number} deltaSeconds
   * @returns {number} new remaining whole seconds, or 0 if not running
   */
  function adjust(deltaSeconds) {
    if (intervalId == null) return 0;
    var delta = Number(deltaSeconds);
    if (!isFinite(delta)) delta = 0;
    endAt = endAt + delta * 1000;
    var left = Math.ceil((endAt - Date.now()) / 1000);
    if (left <= 0) {
      finish();
      return 0;
    }
    if (left !== remainingSec) {
      remainingSec = left;
      emitTick(tickCb);
    }
    return remainingSec;
  }

  function stop() {
    clearTimer();
    endAt = 0;
    tickCb = null;
    doneCb = null;
  }

  function remaining() {
    if (endAt > 0) {
      return Math.max(0, Math.ceil((endAt - Date.now()) / 1000));
    }
    return remainingSec;
  }

  function isRunning() {
    return intervalId != null;
  }

  /** Duration (whole seconds) the current run started with. */
  function totalSeconds() {
    return totalSec;
  }

  SL.timer = {
    start: start,
    stop: stop,
    remaining: remaining,
    startFor: startFor,
    adjust: adjust,
    isRunning: isRunning,
    notifyOnDone: notifyOnDone,
    totalSeconds: totalSeconds,
  };
})();
