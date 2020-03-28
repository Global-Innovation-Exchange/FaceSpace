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
import Stats from 'stats.js';
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

  const stats = new Stats();
  stats.showPanel(0); // 0: fps, 1: ms, 2: mb, 3+: custom
  document.getElementById('main').appendChild(stats.dom);
  
  let touchCounter = 0;
  const mobile = isMobile();
  const detectorParams = {
    renderPointCloud: !mobile,
    width: mobile ? undefined : VIDEO_WIDTH,
    height: mobile ? undefined : VIDEO_HEIGHT,
    timeout: 500,
    renderPointCloud: true,
    renderCanvas: true,
    renderFaceMesh: true,
    onDetected: () => { touchCounter++; },
    onRender: () => { stats.begin(); },
    onRendered: (result) => {
      const minDistance = result.minDistance;
      const handBox = result.handBox;
      const faceBox = result.faceBox;
      const deltaVolume = result.deltaVolume;

      document.querySelector('#distance').innerText = minDistance
        ? `Closest ||p||: ${f(minDistance.distance)}, Δx: ${f(minDistance.diffX)}, Δy: ${f(minDistance.diffY)}, Δz: ${f(minDistance.diffZ)}, Δdistance: ${f(minDistance.distance)}`
        : `Closest ||p||: Undefined`;

      document.querySelector('#intersection').innerText =
        `Volume intersected: ${deltaVolume}`;
      document.querySelector('#deltaCenter').innerText = minDistance
        ? `Center bounding box ||p||: ${f(Math.sqrt(Math.pow(handBox.xCenter - faceBox.xCenter, 2) + Math.pow(handBox.yCenter - faceBox.yCenter, 2) + Math.pow(handBox.zCenter - faceBox.zCenter, 2)))} Δx:${f(handBox.xCenter - faceBox.xCenter)} Δy:${f(handBox.yCenter - faceBox.yCenter)} Δz:${f(handBox.zCenter - faceBox.zCenter)}`
        : `Center bounding box: Undefined`;

      document.querySelector('#detection').innerText =
        `Detection: ${result.detected ? 'Yes' : 'No'}`;
      stats.end();
    }
  };

  // Check every 5 secs with at least three touches
  workerTimers.setInterval(() => {
    if (touchCounter > 2 && Notification.permission === 'granted') {
      new Notification('You touched your face!');
    }
    touchCounter = 0;
  }, 5 * 1000);

  const detector = new Detector(document.getElementById('detector-container'), detectorParams);

  const state = {
    timeout: detectorParams.timeout,
    renderPointCloud: detectorParams.renderPointCloud,
    renderCanvas: detectorParams.renderCanvas,
    triangulateMesh: detectorParams.renderFaceMesh,
  };
  const gui = new dat.GUI();
  gui.add(state, 'timeout', 0, 2000).onChange((value) => { detector.update({ timeout: value }); });
  gui.add(state, 'renderPointCloud').onChange((value) => { detector.update({ renderPointCloud: value }); });
  gui.add(state, 'renderCanvas').onChange((value) => { detector.update({ renderCanvas: value }); });
  gui.add(state, 'triangulateMesh').onChange((value) => { detector.update({ renderFaceMesh: value }); });

  await detector.load();
  detector.start();
}

main();
