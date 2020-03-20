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

import * as facemesh from '@tensorflow-models/facemesh';
import * as handpose from '@tensorflow-models/handpose';
import Stats from 'stats.js';
import * as tf from '@tensorflow/tfjs-core';
import * as tfjsWasm from '@tensorflow/tfjs-backend-wasm';

import { TRIANGULATION } from './triangulation';

tfjsWasm.setWasmPath(
  `https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-backend-wasm@${
  tfjsWasm.version_wasm}/dist/tfjs-backend-wasm.wasm`);

function isMobile() {
  const isAndroid = /Android/i.test(navigator.userAgent);
  const isiOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  return isAndroid || isiOS;
}

const fingerLookupIndices = {
  thumb: [0, 1, 2, 3, 4],
  indexFinger: [0, 5, 6, 7, 8],
  middleFinger: [0, 9, 10, 11, 12],
  ringFinger: [0, 13, 14, 15, 16],
  pinky: [0, 17, 18, 19, 20],
}; // for rendering each finger as a polyline
function drawKeypoints(ctx, keypoints) {
  const keypointsArray = keypoints;

  for (let i = 0; i < keypointsArray.length; i++) {
    const y = keypointsArray[i][0];
    const x = keypointsArray[i][1];
    drawPoint(ctx, x - 2, y - 2, 3);
  }

  const fingers = Object.keys(fingerLookupIndices);
  for (let i = 0; i < fingers.length; i++) {
    const finger = fingers[i];
    const points = fingerLookupIndices[finger].map(idx => keypoints[idx]);
    drawPath(ctx, points, false);
  }
}

function drawPoint(ctx, y, x, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, 2 * Math.PI);
  ctx.fill();
}

function drawPath(ctx, points, closePath) {
  const region = new Path2D();
  region.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) {
    const point = points[i];
    region.lineTo(point[0], point[1]);
  }

  if (closePath) {
    region.closePath();
  }
  ctx.stroke(region);
}

let ctx, videoWidth, videoHeight, video, canvas,
  scatterGLHasInitialized = false, scatterGL;
let faceModel, handModel;

const VIDEO_WIDTH = 640;
const VIDEO_HEIGHT = 500;
const mobile = isMobile();
// Don't render the point cloud on mobile in order to maximize performance and
// to avoid crowding limited screen space.
const renderPointcloud = mobile === false;
const stats = new Stats();
const state = {
  backend: 'webgl',
  maxFaces: 1,
  triangulateMesh: true,
};

if (renderPointcloud) {
  state.renderPointcloud = true;
}

function setupDatGui() {
  const gui = new dat.GUI();
  gui.add(state, 'backend', ['wasm', 'webgl', 'cpu'])
    .onChange(async backend => {
      await tf.setBackend(backend);
      await tf.ready();
    });

  gui.add(state, 'maxFaces', 1, 20, 1).onChange(async val => {
    faceModel = await facemesh.load({ maxFaces: val });
  });

  gui.add(state, 'triangulateMesh');

  if (renderPointcloud) {
    gui.add(state, 'renderPointcloud').onChange(render => {
      document.querySelector('#scatter-gl-container').style.display =
        render ? 'inline-block' : 'none';
    });
  }
}

async function setupCamera() {
  video = document.getElementById('video');

  const stream = await navigator.mediaDevices.getUserMedia({
    'audio': false,
    'video': {
      facingMode: 'user',
      // Only setting the video to a specified size in order to accommodate a
      // point cloud, so on mobile devices accept the default size.
      width: mobile ? undefined : VIDEO_WIDTH,
      height: mobile ? undefined : VIDEO_HEIGHT,
    },
  });
  video.srcObject = stream;

  return new Promise((resolve) => {
    video.onloadedmetadata = () => {
      resolve(video);
    };
  });
}

async function renderFacePrediction(predictions) {
  if (predictions.length > 0) {
    predictions.forEach(prediction => {
      const keypoints = prediction.scaledMesh;

      if (state.triangulateMesh) {
        for (let i = 0; i < TRIANGULATION.length / 3; i++) {
          const points = [
            TRIANGULATION[i * 3], TRIANGULATION[i * 3 + 1],
            TRIANGULATION[i * 3 + 2],
          ].map(index => keypoints[index]);

          drawPath(ctx, points, true);
        }
      } else {
        for (let i = 0; i < keypoints.length; i++) {
          const x = keypoints[i][0];
          const y = keypoints[i][1];

          ctx.beginPath();
          ctx.arc(x, y, 1 /* radius */, 0, 2 * Math.PI);
          ctx.fill();
        }
      }
    });

    if (renderPointcloud && state.renderPointcloud && scatterGL != null) {
      const pointsData = predictions.map(prediction => {
        let scaledMesh = prediction.scaledMesh;
        return scaledMesh.map(point => ([-point[0], -point[1], -point[2]]));
      });

      let flattenedPointsData = [];
      for (let i = 0; i < pointsData.length; i++) {
        flattenedPointsData = flattenedPointsData.concat(pointsData[i]);
      }
      return flattenedPointsData;
    }
  }
  return [];
}
async function renderHandPrediction(predictions) {
  if (predictions.length > 0) {
    for (let i = 0; i < predictions.length; i++) {
      const result = predictions[i].landmarks;
      drawKeypoints(ctx, result, predictions[i].annotations);

      if (renderPointcloud && state.renderPointcloud && scatterGL != null) {
        const pointsData = result.map(point => {
          return [-point[0], -point[1], -point[2]];
        });
        return pointsData;
      }
    }
  }
  return [];
}

function getBoundingBox3D(points, isFace) {
  let box = undefined;

  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const x = p[0];
    const y = p[1];
    const z = p[2];
    if (box === undefined) {
      box = {
        xMin: x,
        xMax: x,
        yMin: y,
        yMax: y,
        zMin: z,
        zMax: z,
      };
    }
    if (x < box.xMin) {
      box.xMin = x;
    }
    if (x > box.xMax) {
      box.xMax = x;
    }
    if (y < box.yMin) {
      box.yMin = y;
    }
    if (y > box.yMax) {
      box.yMax = y;
    }
    if (z < box.zMin) {
      box.zMin = z;
    }
    if (z > box.zMax) {
      box.zMax = z;
    }
  }

  if (box !== undefined) {
    if (isFace) {
      // Hard code to extend the bounding box of the face
      // to cover the ear
      box.zMax = box.zMax + 20;
      box.xMax = box.xMax + 15;
      box.xMin = box.xMin - 15;
    }

    box.xCenter = box.xMax - Math.abs(box.xMax - box.xMin);
    box.yCenter = box.yMax - Math.abs(box.yMax - box.yMin);
    box.zCenter = box.zMax - Math.abs(box.zMax - box.zMin);
  }

  return box;
}

function getIntersectionVolume(box1, box2) {
  if (!box1 || !box2) return 0.0;

  // determine the coordinates of the intersection rectangle
  const xMin = Math.max(box1.xMin, box2.xMin);
  const yMin = Math.max(box1.yMin, box2.yMin);
  const zMin = Math.max(box1.zMin, box2.zMin);

  const xMax = Math.min(box1.xMax, box2.xMax);
  const yMax = Math.min(box1.yMax, box2.yMax);
  const zMax = Math.min(box1.zMax, box2.zMax);

  if (xMax < xMin || yMax < yMin || zMax < zMin) {
    return 0.0;
  }

  return (xMax - xMin) * (yMax - yMin) * (zMax - zMin);
}

function comparePoints(points1, points2) {
  // TODO better algorithm
  let shortestDistance = undefined;
  for (let i = 0; i < points1.length; i++) {
    for (let j = 0; j < points2.length; j++) {
      const p1 = points1[i];
      const p2 = points2[j];
      const x = p1[0] - p2[0];
      const y = p1[1] - p2[1];
      const z = p1[2] - p2[2];
      const d = Math.sqrt(Math.pow(x, 2) + Math.pow(y, 2) + Math.pow(z, 2));
      if (shortestDistance === undefined || d < shortestDistance.d) {
        shortestDistance = { x, y, z, d };
      }
    }
  }
  return shortestDistance;
}

// These anchor points allow the hand pointcloud to resize according to its
// position in the input.
const ANCHOR_POINTS = [
  [0, 0, 0],
  [0, -VIDEO_HEIGHT, 0],
  [-VIDEO_WIDTH, 0, 0],
  [-VIDEO_WIDTH, -VIDEO_HEIGHT, 0],
];
async function renderPrediction() {
  stats.begin();
  const [fp, hp] = await Promise.all([faceModel.estimateFaces(video), handModel.estimateHands(video)]);
  ctx.drawImage(video, 0, 0, videoWidth, videoHeight, 0, 0, canvas.width, canvas.height);
  const points = await Promise.all([renderFacePrediction(fp), renderHandPrediction(hp)]);
  const dataset = new ScatterGL.Dataset(points.flat().concat(ANCHOR_POINTS));
  if (!scatterGLHasInitialized) {
    scatterGL.render(dataset);
  } else {
    // const fingers = Object.keys(fingerLookupIndices);
    // scatterGL.setSequences(fingers.map(finger => ({ indices: fingerLookupIndices[finger] })));
    scatterGL.updateDataset(dataset);
  }
  scatterGLHasInitialized = true;

  const f = (d) => { // Format to number to have consistent length
    const options = { minimumIntegerDigits: 3, minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false };
    let str = d.toLocaleString('en', options);
    if (d >= 0) {
      str = ` ${str}`;
    }
    return str;
  };
  const [handPoints, facePoints] = points;
  const handBox = getBoundingBox3D(handPoints, false);
  const faceBox = getBoundingBox3D(facePoints, true);
  const deltaVolume = getIntersectionVolume(handBox, faceBox);
  const d = comparePoints(handPoints, facePoints);

  document.querySelector('#distance').innerText = d
    ? `Closest ||p||: ${f(d.d)}, Δx: ${f(d.x)}, Δy: ${f(d.y)}, Δz: ${f(d.z)}`
    : `Closest ||p||: Undefined`;

  document.querySelector('#intersection').innerText = `Volume intersected: ${deltaVolume}`;
  document.querySelector('#deltaCenter').innerText = d
    ? `Center bounding box ||p||: ${f(Math.sqrt(Math.pow(handBox.xCenter - faceBox.xCenter, 2) + Math.pow(handBox.yCenter - faceBox.yCenter, 2) + Math.pow(handBox.zCenter - faceBox.zCenter, 2)))} Δx:${f(handBox.xCenter - faceBox.xCenter)} Δy:${f(handBox.yCenter - faceBox.yCenter)} Δz:${f(handBox.zCenter - faceBox.zCenter)}`
    : `Center bounding box: Undefined`;
  stats.end();
  requestAnimationFrame(renderPrediction);
}


async function main() {
  await tf.setBackend(state.backend);
  setupDatGui();

  stats.showPanel(0);  // 0: fps, 1: ms, 2: mb, 3+: custom
  document.getElementById('main').appendChild(stats.dom);

  await setupCamera();
  video.play();
  videoWidth = video.videoWidth;
  videoHeight = video.videoHeight;
  video.width = videoWidth;
  video.height = videoHeight;

  canvas = document.getElementById('output');
  canvas.width = videoWidth;
  canvas.height = videoHeight;
  const canvasContainer = document.querySelector('.canvas-wrapper');
  canvasContainer.style = `width: ${videoWidth}px; height: ${videoHeight}px`;

  ctx = canvas.getContext('2d');
  ctx.translate(canvas.width, 0);
  ctx.scale(-1, 1);
  ctx.fillStyle = '#32EEDB';
  ctx.strokeStyle = '#32EEDB';
  ctx.lineWidth = 0.5;

  faceModel = await facemesh.load({ maxFaces: state.maxFaces });
  handModel = await handpose.load();
  renderPrediction();

  if (renderPointcloud) {
    document.querySelector('#scatter-gl-container').style =
      `width: ${VIDEO_WIDTH}px; height: ${VIDEO_HEIGHT}px;`;

    scatterGL = new ScatterGL(
      document.querySelector('#scatter-gl-container'),
      { 'rotateOnStart': false, 'selectEnabled': false });
  }
};

main();
