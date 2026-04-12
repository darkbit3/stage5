const countdownState = {
  '1': { seconds: 60, active: true },
  '2': { seconds: 60, active: true }
};

const DEFAULT_COUNTDOWN_SECONDS = 60;

function ensureRoomCountdown(room) {
  if (!countdownState[room]) {
    countdownState[room] = { seconds: DEFAULT_COUNTDOWN_SECONDS, active: true };
  }
  return countdownState[room];
}

function getRoomCountdown(room) {
  return ensureRoomCountdown(room);
}

function resetRoomCountdown(room) {
  countdownState[room] = { seconds: DEFAULT_COUNTDOWN_SECONDS, active: true };
  return countdownState[room];
}

function decrementCountdowns() {
  Object.keys(countdownState).forEach((room) => {
    const state = countdownState[room];
    if (!state.active) return;

    if (typeof state.seconds !== 'number' || isNaN(state.seconds)) {
      state.seconds = DEFAULT_COUNTDOWN_SECONDS;
    }

    if (state.seconds > 0) {
      state.seconds -= 1;
    } else {
      // Reset countdown for next game cycle
      state.seconds = DEFAULT_COUNTDOWN_SECONDS;
      state.active = true;
      console.log(`🔄 Countdown reset for room ${room}: ${DEFAULT_COUNTDOWN_SECONDS}s`);
    }
  });
}

function setRoomCountdown(room, seconds, active = true) {
  countdownState[room] = {
    seconds: Number.isInteger(seconds) ? seconds : DEFAULT_COUNTDOWN_SECONDS,
    active: active === false ? false : true
  };
  return countdownState[room];
}

function getAllCountdowns() {
  return {
    ...countdownState
  };
}

module.exports = {
  getRoomCountdown,
  resetRoomCountdown,
  decrementCountdowns,
  setRoomCountdown,
  getAllCountdowns,
  DEFAULT_COUNTDOWN_SECONDS
};