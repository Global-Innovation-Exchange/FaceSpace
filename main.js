/* eslint-disable arrow-parens */
/**
 * @license
 * Copyright 2020 Google LLC. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * =============================================================================
 */

import * as workerTimers from 'worker-timers';
import Detector from './detector';

function isMobile() {
  const isAndroid = /Android/i.test(navigator.userAgent);
  const isiOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  return isAndroid || isiOS;
}

const VIDEO_WIDTH = 640;
const VIDEO_HEIGHT = 500;

// Format to number to have consistent length
function f(d) {
  const options = { minimumIntegerDigits: 3, minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false };
  let str = d.toLocaleString('en', options);
  if (d >= 0) {
    str = ` ${str}`;
  }
  return str;
}

async function main() {
  // Request permission
  await Notification.requestPermission();

  $("#timesTouchedText").hide();
  $("#totalCount").hide();
  $("#title").hide();
  $("#footer").hide();

  let touchCounter = 0;
  let totalTouches = 0;
  let faceAlreadyTouched = false;
  let faceCurrentlyTouched = false;

  const mobile = isMobile();
  const detectorParams = {
    width: mobile ? undefined : VIDEO_WIDTH,
    height: mobile ? undefined : VIDEO_HEIGHT,
    renderPointCloud: false,
    timeout: 300,
    renderCanvas: true,
    onDetected: () => { touchCounter++; },
    onRendered: (result) => {
      faceCurrentlyTouched = result.detected;
    }
  };

  // Check every second with at least three touches
  workerTimers.setInterval(() => {
    if (touchCounter >= 2 && !faceAlreadyTouched) {

      if (Notification.permission === 'granted') {
        new Notification('🤭 You touched your face! 🤭');
      }

      $("#face-touch-alert").show();
      totalTouches++;
      document.querySelector('#totalCount').innerText = totalTouches;
      document.querySelector('#timesTouchedText').innerText = totalTouches === 1 ? 'time touched' : 'times touched';
      window.document.title = '😱 - FaceSpace'
      faceAlreadyTouched = true;
    }
    if (!faceCurrentlyTouched) {
      window.document.title = '☺️ - FaceSpace'
      faceAlreadyTouched = false;
      $("#face-touch-alert").hide();
    }
    touchCounter = 0;
  }, 1000);

  const detector = new Detector(document.getElementById('detector-container'), detectorParams);
  await detector.load();

  $("#timesTouchedText").show();
  $("#totalCount").show();
  $("#title").show();
  $("#footer").show();
  let el = document.getElementById('loading-animation');
  el.parentNode.removeChild(el);

  const gui = new dat.GUI();
  const state = {
    'frame timeout': detectorParams.timeout,
  };
  gui.add(state, 'frame timeout', 100, 1000).onChange((value) => { detector.update({ timeout: value }); });

  detector.start();
}

main();
