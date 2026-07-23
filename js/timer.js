/* Streetlifting — rest timer */
(function () {
  "use strict";

  window.SL = window.SL || {};

  var intervalId = null;
  var remainingSec = 0;
  var endAt = 0;

  function clearTimer() {
    if (intervalId != null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  }

  function emitTick(onTick) {
    if (typeof onTick === "function") onTick(remainingSec);
  }

  function finish(onTick, onDone) {
    remainingSec = 0;
    endAt = 0;
    clearTimer();
    emitTick(onTick);
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
    remainingSec = Math.max(0, Math.floor(Number(seconds) || 0));
    if (remainingSec <= 0) {
      finish(onTick, onDone);
      return;
    }
    endAt = Date.now() + remainingSec * 1000;
    emitTick(onTick);

    intervalId = setInterval(function () {
      var left = Math.ceil((endAt - Date.now()) / 1000);
      if (left <= 0) {
        finish(onTick, onDone);
        return;
      }
      if (left !== remainingSec) {
        remainingSec = left;
        emitTick(onTick);
      }
    }, 250);
  }

  function stop() {
    clearTimer();
    endAt = 0;
  }

  function remaining() {
    if (endAt > 0) {
      return Math.max(0, Math.ceil((endAt - Date.now()) / 1000));
    }
    return remainingSec;
  }

  SL.timer = {
    start: start,
    stop: stop,
    remaining: remaining,
  };
})();
