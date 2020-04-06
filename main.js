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

import Detector from './detector';
import faviconUrl from './favicon.ico';
import touchUrl from './touch.ico';
import popUrl from './pop.mp3';
import coronavirusUrl from './coronavirus.mp3';
import { Howl } from 'howler';

function isMobile() {
  const isAndroid = /Android/i.test(navigator.userAgent);
  const isiOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  return isAndroid || isiOS;
}

const VIDEO_WIDTH = 640;
const VIDEO_HEIGHT = 500;

async function main() {
  const mobile = isMobile();
  const isFirefox = (navigator.userAgent.toLowerCase().indexOf('firefox') > -1);
  const favicon = document.getElementById('favicon');
  const isNotificationSupported = 'Notification' in window;
  const touchBuffer = [false, false, false];

  let alertAudio = isFirefox ? null : new Howl({ src: [popUrl], html5: true });
  let touchCounter = 0;

  // Request permission
  if (isNotificationSupported) {
    if (Notification.permission === 'denied') {
      $('#notification-alert-content').text(
        'Your browser has blocked notifications. If you would like to receive notification, please update your browser settings.'
      );
      $('#notification-alert').show();
    } else if (Notification.permission === 'default') { // default
      $('#notification-request').show();
      $('#notification-request-yes-btn').click(async () => {
        await Notification.requestPermission();
        $('#notification-request').hide();
      });
      $('#notification-request-no-btn').click(() => {
        $('#notification-request').hide();
      });
    }
  }

  $('#timesTouchedText').hide();
  $('#totalCount').hide();
  $('#title').hide();
  $('#footer').hide();

  function updateUI() {
    $('#face-touch-alert').show();
    document.querySelector('#totalCount').innerText = touchCounter;
    document.querySelector('#timesTouchedText').innerText =
      touchCounter === 1 ? 'time touched' : 'times touched';

    // if it is not currently touch
    if (!touchBuffer[2]) {
      favicon.href = faviconUrl;
      $('#face-touch-alert').hide();
    }
  }
  const detectorParams = {
    width: mobile ? undefined : VIDEO_WIDTH,
    height: mobile ? undefined : VIDEO_HEIGHT,
    renderPointCloud: false,
    timeout: 300,
    renderCanvas: true,
    onRendered: (result) => {
      touchBuffer.push(result.detected);
      touchBuffer.shift();

      if (!touchBuffer[0] && touchBuffer[1] && touchBuffer[2]) {
        touchCounter++;
        if (alertAudio) {
          alertAudio.play();
        }
        if (isNotificationSupported && Notification.permission === 'granted') {
          new Notification('🤭 You touched your face! 🤭', { silent: true });
          favicon.href = touchUrl;
        }
      }

      // Update UI only the window on foreground.
      // requestAnimationFrame will stop running once the window is in background
      requestAnimationFrame(updateUI);
    },
  };

  const detector = new Detector(document.getElementById('detector-container'), detectorParams);
  await detector.load();

  $('#timesTouchedText').show();
  $('#totalCount').show();
  $('#title').show();
  $('#footer').show();
  $('#loading-animation').remove();

  const gui = new dat.GUI();
  const state = {
    'frame timeout': detectorParams.timeout,
    'sound': 'pop',
  };
  gui.add(state, 'frame timeout', 100, 1000).onChange((value) => { detector.update({ timeout: value }); });
  // Firefox has a default notification sound that can't be turned off so not supporting sound.
  if (!isFirefox) {
    gui.add(state, 'sound', ['none', 'pop', 'coronavirus']).onChange((value) => {
      if (value === 'pop') {
        alertAudio = new Howl({ src: [popUrl], html5: true });
      } else if (value === 'coronavirus') {
        alertAudio = new Howl({ src: [coronavirusUrl], html5: true });
      } else {
        alertAudio = null;
      }
    });
  }


  detector.start();
}

main();
