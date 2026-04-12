const countdownState = {
  seconds: 60,
  active: true
};

const DEFAULT_COUNTDOWN_SECONDS = 60;

function getRoomCountdown(room) {
  return countdownState;
}

function resetRoomCountdown(room) {
  countdownState.seconds = DEFAULT_COUNTDOWN_SECONDS;
  countdownState.active = true;
  return countdownState;
}

function decrementCountdowns() {
  const state = countdownState;
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
    console.log(`🔄 Countdown reset: ${DEFAULT_COUNTDOWN_SECONDS}s`);
  }
}

function setRoomCountdown(room, seconds, active = true) {
  countdownState.seconds = Number.isInteger(seconds) ? seconds : DEFAULT_COUNTDOWN_SECONDS;
  countdownState.active = active === false ? false : true;
  return countdownState;
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