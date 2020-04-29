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

import { Howl } from 'howler';
import popUrl from './assets/pop.mp3';
import Cookies from 'js-cookie';
import Detector from './detector';

function isMobile() {
  const isAndroid = /Android/i.test(navigator.userAgent);
  const isiOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  return isAndroid || isiOS;
}

function getHowl(name) {
  if (name === 'pop') {
    return new Howl({ src: [popUrl], html5: true });
  } else {
    return null;
  }
}

function initializeCookie(name) {
  const value = Cookies.get(name);
  if (value) {
    Cookies.set(name, value);
  }
  return value;
}

// Set global expiration days
Cookies.defaults.expires = 30; // days

const VIDEO_WIDTH = 640;
const VIDEO_HEIGHT = 500;

async function main() {
  const heatmapCookie = initializeCookie('heatmap') === 'true';
  const alertAudioCookie = initializeCookie('alertAudio');
  const timeoutCookie = Number(initializeCookie('timeout'));

  const mobile = isMobile();
  const isNotificationSupported = 'Notification' in window;
  let isDetected = false;
  let touchCounter = 0;
  let alertAudio = getHowl(alertAudioCookie);

  // Request permission
  if (isNotificationSupported) {
    if (Notification.permission === 'denied') {
      $('#notification-alert-content').text(
        'Your browser has blocked notifications. If you would like to receive notifications, please update your browser settings.'
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

  function updateUI() {
    document.querySelector('#total-count').innerText = touchCounter;
    document.querySelector('#times-touched-txt').innerText =
      touchCounter === 1 ? 'time touched' : 'times touched';

    if (isDetected) {
      $('#face-touch-alert').show();
    } else {
      $('#face-touch-alert').hide();
    }
  }

  const detectorParams = {
    width: mobile ? undefined : VIDEO_WIDTH,
    height: mobile ? undefined : VIDEO_HEIGHT,
    renderPointCloud: heatmapCookie,
    renderHeatmap: heatmapCookie,
    timeout: timeoutCookie || 300,
    renderCanvas: true,
    onRendered: (result) => {
      const detection = result.detection;
      if (detection.isNew) {
        touchCounter++;
        if (alertAudio) {
          alertAudio.play();
        }
        if (isNotificationSupported && Notification.permission === 'granted') {
          const n = new Notification('You touched your face! 🤦');
          n.onclick = n.close;
        }
      }

      isDetected = detection.isDetected;
      // Update UI only the window on foreground.
      // requestAnimationFrame will stop running once the window is in background
      requestAnimationFrame(updateUI);
    },
  };


  try {
    const detector = new Detector(document.getElementById('detector-container'), detectorParams);
    await detector.load();

    // Set up the tuning knobs
    const $timeoutRange = $('#timeout-range');
    const $timeoutInput = $('#timeout-input');
    const $heatmapInput = $('#heatmap-input');
    const $soundInput = $('#sound-input');

    $timeoutRange.val(detectorParams.timeout);
    $timeoutInput.val(detectorParams.timeout);
    $timeoutRange.change(event => {
      const value = event.target.value;
      $timeoutInput.val(value);
      detector.update({ timeout: value });
      Cookies.set('timeout', String(value));
    });
    $timeoutInput.change(event => {
      const value = event.target.value;
      $timeoutRange.val(value);
      detector.update({ timeout: value });
    });
    $heatmapInput.prop('checked', heatmapCookie);
    $heatmapInput.change(event => {
      const value = $(event.target).is(':checked');
      Cookies.set('heatmap', value);
      detector.update({ renderPointCloud: value, renderHeatmap: value });
    });

    $soundInput.val(alertAudioCookie || 'built-in');
    $soundInput.change(event => {
      const value = event.target.value;
      alertAudio = getHowl(value);
      Cookies.set('alertAudio', value);
    });

    $('#loading-container').remove();
    $('#main-container').show();

    detector.start();
  } catch (err) {
    $('#loading-spin').remove();
    $('#loading-message').html('<h1><strong>🚫Sorry, we are not able to access the webcam.</strong></h1>');
  }
}

main();