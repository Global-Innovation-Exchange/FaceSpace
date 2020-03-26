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
// TODO: store this state in a better place
var loading = true
async function main() {
  // Request permission
  await Notification.requestPermission();
  const stats = new Stats();
  stats.showPanel(0); // 0: fps, 1: ms, 2: mb, 3+: custom
  document.getElementById('main').appendChild(stats.dom);
  
  let touchCounter = 0;
  let totalTouches = 0;
  let faceAlreadyTouched = false;
  let faceCurrentlyTouched = false;
  const mobile = isMobile();
  const detectorParams = {
    renderPointCloud: !mobile,
    width: mobile ? undefined : VIDEO_WIDTH,
    height: mobile ? undefined : VIDEO_HEIGHT,
    timeout: 300,
    // renderPointCloud: true, //don't render on mobile
    renderCanvas: true,
    renderFaceMesh: true,
    onDetected: () => { touchCounter++; },
    onRender: () => { 
      stats.begin();
      // clearInterval(loadingAnimation);
      if (loading){
        let el = document.getElementById('loading-header');
        el.parentNode.removeChild(el);
        el = document.getElementById('loading-animation');
        el.parentNode.removeChild(el);
        loading = false;
      }
    },
    onRendered: (result) => {
      const d = result.minDistance;
      const handBox = result.handBox;
      const faceBox = result.faceBox;
      const deltaVolume = result.deltaVolume;

      document.querySelector('#distance').innerText = d
        ? `Closest ||p||: ${f(d.d)}, Δx: ${f(d.x)}, Δy: ${f(d.y)}, Δz: ${f(d.z)}`
        : `Closest ||p||: Undefined`;

      document.querySelector('#intersection').innerText =
        `Volume intersected: ${deltaVolume}`;
      document.querySelector('#deltaCenter').innerText = d
        ? `Center bounding box ||p||: ${f(Math.sqrt(Math.pow(handBox.xCenter - faceBox.xCenter, 2) + Math.pow(handBox.yCenter - faceBox.yCenter, 2) + Math.pow(handBox.zCenter - faceBox.zCenter, 2)))} Δx:${f(handBox.xCenter - faceBox.xCenter)} Δy:${f(handBox.yCenter - faceBox.yCenter)} Δz:${f(handBox.zCenter - faceBox.zCenter)}`
        : `Center bounding box: Undefined`;

      document.querySelector('#detection').innerText =
        `Detection: ${result.detected ? 'Yes' : 'No'}`;
      faceCurrentlyTouched = result.detected;
      stats.end();
    }
  };

  // Check every second with at least three touches
  setInterval(() => {
    if (touchCounter >= 2 && Notification.permission === 'granted' && !faceAlreadyTouched) {
      new Notification('You touched your face! 😱');
      totalTouches++;
      document.querySelector('#totalCount').innerText = totalTouches;
      window.document.title = '😱'
      faceAlreadyTouched = true;
    }
    if (!faceCurrentlyTouched) {
      window.document.title = '☺️'
      faceAlreadyTouched = false;
    }
    touchCounter = 0;
  }, 1000);

  // Check loading status
  function loadingAnimation(){   

  
    while(!loaded){
       clearInterval(loaded);
    }
  }

  const detector = new Detector(document.getElementById('detector-container'), detectorParams);

  const state = {
    timeout: detectorParams.timeout,
    renderPointCloud: detectorParams.renderPointCloud,
    renderCanvas: detectorParams.renderCanvas,
    triangulateMesh: detectorParams.renderFaceMesh,
  };
  const gui = new dat.GUI();
  gui.add(state, 'timeout', 100, 1000).onChange((value) => { detector.update({ timeout: value }); });
  gui.add(state, 'renderPointCloud').onChange((value) => { detector.update({ renderPointCloud: value }); });
  gui.add(state, 'renderCanvas').onChange((value) => { detector.update({ renderCanvas: value }); });
  gui.add(state, 'triangulateMesh').onChange((value) => { detector.update({ renderFaceMesh: value }); });

  await detector.load();
  detector.start();
}

main();
