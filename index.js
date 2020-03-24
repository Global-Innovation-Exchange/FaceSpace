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

import { sleep } from './utils';
import { fingerLookup, drawFacePredictions, drawHandPredictions } from './draw';
import { BoundingBox, boxLookup } from './box';

function isMobile() {
  const isAndroid = /Android/i.test(navigator.userAgent);
  const isiOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  return isAndroid || isiOS;
}

let scatterGLHasInitialized = false;
const VIDEO_WIDTH = 640;
const VIDEO_HEIGHT = 500;
const mobile = isMobile();
// Don't render the point cloud on mobile in order to maximize performance and
// to avoid crowding limited screen space.
const renderPointCloud = mobile === false;
const stats = new Stats();
const state = {
  backend: 'webgl',
  maxFaces: 1,
  timeout: 500,
  triangulateMesh: true,
};

if (renderPointCloud) {
  state.renderPointCloud = true;
}

function setupDatGui() {
  const gui = new dat.GUI();
  gui.add(state, 'backend', ['webgl', 'cpu'])
    .onChange(async backend => {
      await tf.setBackend(backend);
      await tf.ready();
    });

  gui.add(state, 'maxFaces', 1, 20, 1).onChange(async val => {
    faceModel = await facemesh.load({ maxFaces: val });
  });
  gui.add(state, 'timeout', 0, 2000);

  gui.add(state, 'triangulateMesh');

  if (renderPointCloud) {
    gui.add(state, 'renderPointCloud').onChange(render => {
      document.querySelector('#scatter-gl-container').style.display =
        render ? 'inline-block' : 'none';
    });
  }
}

async function setupCamera(elementId) {
  const video = document.getElementById(elementId);

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

function getFacePoints(predictions) {
  const pointsData = predictions.map(prediction =>
    prediction.scaledMesh.map(point => [-point[0], -point[1], -point[2]]));
  return pointsData.flat();
}

function getHandPoints(predictions) {
  const pointsData = predictions.map(prediction =>
    prediction.landmarks.map(point => [-point[0], -point[1], -point[2]]));
  return pointsData.flat();
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

async function renderPrediction(ctx, video, canvas, faceModel, handModel, scatterGL, onDetection) {
  stats.begin();
  const videoWidth = video.videoWidth;
  const videoHeight = video.videoHeight;
  const [fp, hp] = await Promise.all([faceModel.estimateFaces(video), handModel.estimateHands(video)]);
  ctx.drawImage(video, 0, 0, videoWidth, videoHeight, 0, 0, canvas.width, canvas.height);
  drawFacePredictions(ctx, fp, state.triangulateMesh);
  drawHandPredictions(ctx, hp);

  const handPoints = getHandPoints(hp);
  const facePoints = getFacePoints(fp);
  const handBox = BoundingBox.createFromPoints(handPoints);
  const faceBox = BoundingBox.createFromPoints(facePoints, 20);
  const handBoxPoints = handBox ? handBox.toPoints() : [];
  const faceBoxPoints = faceBox ? faceBox.toPoints() : [];

  if (renderPointCloud && state.renderPointCloud && scatterGL != null) {
    // These anchor points allow the hand pointcloud to resize according to its
    // position in the input.
    const ANCHOR_POINTS = [
      [0, 0, 0],
      [0, -videoHeight, 0],
      [-videoWidth, 0, 0],
      [-videoWidth, -videoHeight, 0],
    ];
    const fingerKeys = Object.keys(fingerLookup);
    const boxKeys = Object.keys(boxLookup);
    // Add finger lines
    const fingerSeq = handPoints.length > 0 ? fingerKeys.map(finger => ({ indices: fingerLookup[finger] })) : [];
    // Add hand bounding box lines
    const handBoxSeqOffset = handPoints.length + facePoints.length + ANCHOR_POINTS.length;
    const handBoxSeq = handBoxPoints.length > 0 ? boxKeys.map(b => ({ indices: boxLookup[b].map(s => s + handBoxSeqOffset) })) : [];
    // Add face bounding box lines
    const faceBoxSeqOffset = handBoxSeqOffset + handBoxPoints.length;
    const faceBoxSeq = faceBoxPoints.length > 0 ? boxKeys.map(b => ({ indices: boxLookup[b].map(s => s + faceBoxSeqOffset) })) : [];
    const dataset = new ScatterGL.Dataset(
      handPoints.concat(facePoints)
        .concat(ANCHOR_POINTS)
        .concat(handBoxPoints)
        .concat(faceBoxPoints)
    );
    if (!scatterGLHasInitialized) {
      scatterGL.render(dataset);
    } else {
      scatterGL.updateDataset(dataset);
    }

    // Render lines for fingers and bounding boxes
    scatterGL.setSequences(fingerSeq.concat(handBoxSeq).concat(faceBoxSeq));
    scatterGL.setPointColorer((i, selectedIndices, hoverIndex) => {
      let length = handPoints.length;
      if (i < length) return 'red';

      length = length + facePoints.length;
      if (i < length) return 'green';

      length = length + ANCHOR_POINTS.length;
      if (i < length) return 'white';

      return 'blue';
    });
    scatterGLHasInitialized = true;
  }

  const f = (d) => { // Format to number to have consistent length
    const options = { minimumIntegerDigits: 3, minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false };
    let str = d.toLocaleString('en', options);
    if (d >= 0) {
      str = ` ${str}`;
    }
    return str;
  };
  const deltaVolume = (handBox && faceBox) ? handBox.getIntersectionVolume(faceBox) : 0.0;
  const d = comparePoints(handPoints, facePoints);

  document.querySelector('#distance').innerText = d
    ? `Closest ||p||: ${f(d.d)}, Δx: ${f(d.x)}, Δy: ${f(d.y)}, Δz: ${f(d.z)}`
    : `Closest ||p||: Undefined`;

  document.querySelector('#intersection').innerText = `Volume intersected: ${deltaVolume}`;
  document.querySelector('#deltaCenter').innerText = d
    ? `Center bounding box ||p||: ${f(Math.sqrt(Math.pow(handBox.xCenter - faceBox.xCenter, 2) + Math.pow(handBox.yCenter - faceBox.yCenter, 2) + Math.pow(handBox.zCenter - faceBox.zCenter, 2)))} Δx:${f(handBox.xCenter - faceBox.xCenter)} Δy:${f(handBox.yCenter - faceBox.yCenter)} Δz:${f(handBox.zCenter - faceBox.zCenter)}`
    : `Center bounding box: Undefined`;

  let detected = false;
  if (handBox && faceBox && deltaVolume > 0 && !!d) {
    // Only if the two bounding boxes intersect
    if (faceBox.xMin < handBox.xMin && handBox.xMax < faceBox.xMax) {
      // The hand bounding box is with in the face box,
      // which means the hand is in front of the face
      detected = d.d < 10;
    } else {
      // The hand is on the side
      detected = d.d < 30;
    }
  }

  if(detected) onDetection();
  document.querySelector('#detection').innerText = `Detection: ${detected ? 'Yes' : 'No'}`;
  stats.end();
  if (state.timeout > 0) {
    await sleep(state.timeout);
  }
  renderPrediction(ctx, video, canvas, faceModel, handModel, scatterGL, onDetection);
}


async function main(onDetection = () => {}) {
  await tf.setBackend(state.backend);
  setupDatGui();

  stats.showPanel(0);  // 0: fps, 1: ms, 2: mb, 3+: custom
  document.getElementById('main').appendChild(stats.dom);

  const video = await setupCamera('video');
  video.play();
  const videoWidth = video.videoWidth;
  const videoHeight = video.videoHeight;
  video.width = videoWidth;
  video.height = videoHeight;

  const canvas = document.getElementById('output');
  canvas.width = videoWidth;
  canvas.height = videoHeight;
  const canvasContainer = document.querySelector('.canvas-wrapper');
  canvasContainer.style = `width: ${videoWidth}px; height: ${videoHeight}px`;

  const ctx = canvas.getContext('2d');
  ctx.translate(canvas.width, 0);
  ctx.scale(-1, 1);
  ctx.fillStyle = '#32EEDB';
  ctx.strokeStyle = '#32EEDB';
  ctx.lineWidth = 0.5;

  const [faceModel, handModel] = await Promise.all([
    facemesh.load({ maxFaces: state.maxFaces }),
    handpose.load(),
  ]);

  let scatterGL = null;
  if (renderPointCloud) {
    document.querySelector('#scatter-gl-container').style =
      `width: ${videoWidth}px; height: ${videoHeight}px;`;

    scatterGL = new ScatterGL(
      document.querySelector('#scatter-gl-container'),
      { 'rotateOnStart': false, 'selectEnabled': false });
  }
  renderPrediction(ctx, video, canvas, faceModel, handModel, scatterGL, onDetection);
};

main();
