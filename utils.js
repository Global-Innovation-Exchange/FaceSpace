import * as workerTimers from 'worker-timers';

function sleep(ms) {
    return new Promise((resolve) => workerTimers.setTimeout(resolve, ms));
  }

export { sleep };