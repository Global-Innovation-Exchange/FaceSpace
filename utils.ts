import workerTimers from 'worker-timers';

function sleep(ms: number) {
    return new Promise((resolve) => workerTimers.setTimeout(resolve, ms));
  }

export { sleep };