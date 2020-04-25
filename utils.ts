import { setTimeout } from 'worker-timers';

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

export { sleep };