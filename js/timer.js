/* Streetlifting — rest timer */
(function () {
  "use strict";

  window.SL = window.SL || {};

  var intervalId = null;
  var remainingSec = 0;

  function clearTimer() {
    if (intervalId != null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  }

  function start(seconds, onTick, onDone) {
    clearTimer();
    remainingSec = Math.max(0, Math.floor(Number(seconds) || 0));
    if (typeof onTick === "function") onTick(remainingSec);
    if (remainingSec <= 0) {
      remainingSec = 0;
      if (typeof onDone === "function") onDone();
      return;
    }
    intervalId = setInterval(function () {
      remainingSec -= 1;
      if (remainingSec <= 0) {
        remainingSec = 0;
        clearTimer();
        if (typeof onTick === "function") onTick(0);
        if (typeof onDone === "function") onDone();
        return;
      }
      if (typeof onTick === "function") onTick(remainingSec);
    }, 1000);
  }

  function stop() {
    clearTimer();
  }

  function remaining() {
    return remainingSec;
  }

  SL.timer = {
    start: start,
    stop: stop,
    remaining: remaining,
  };
})();
