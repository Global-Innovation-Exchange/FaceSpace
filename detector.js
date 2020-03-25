
import * as facemesh from '@tensorflow-models/facemesh';
import * as handpose from '@tensorflow-models/handpose';
import * as tf from '@tensorflow/tfjs-core';
// Use npm package once https://github.com/PAIR-code/scatter-gl/issues/36 is fixed
// import { ScatterGL } from 'scatter-gl';

import { sleep } from './utils';
import { fingerLookup, drawFacePredictions, drawHandPredictions } from './draw';
import { BoundingBox, boxLookup } from './box';

var createOctree = require('yaot'); // from https://github.com/anvaka/yaot

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

function getShortestDistance(handPoints, facePoints, distance_threshold) {
    if (handPoints.length != 0 || handPoints.length != 0) { // if there's no hand or face, there's no need to build the tree
        const tree = createOctree();
        let octree_points = [];

        for (let i = 0; i < facePoints.length; i++) {
            octree_points.push(facePoints[i][0], facePoints[i][1], facePoints[i][2]);
        }
        tree.init(octree_points);

        let min_distance = undefined;
        for (let hand_point_idx = 0; hand_point_idx < handPoints.length; hand_point_idx++) {
            const hand_point = handPoints[hand_point_idx];
            const matches = tree.intersectSphere(hand_point[0], hand_point[1], hand_point[2], distance_threshold);
            if (matches.length != 0) {
                for (let j = 0; j < matches.length; j++) {
                    const face_point_idx = matches[j] / 3; // tree.intersectSphere returns indexes at octree_points
                    const face_point = facePoints[face_point_idx];
                    const diff_x = hand_point[0] - face_point[0];
                    const diff_y = hand_point[1] - face_point[1];
                    const diff_z = hand_point[2] - face_point[2];
                    const distance = Math.sqrt(Math.pow(diff_x, 2) + Math.pow(diff_y, 2) + Math.pow(diff_z, 2));
                    if (min_distance === undefined || distance < min_distance.distance) {
                        min_distance = { diff_x, diff_y, diff_z, distance, hand_point_idx, face_point_idx };
                    }
                }
            }
        }
        return min_distance;
    }
    return undefined;
}

const defaultParams = {
    renderPointCloud: true,
    renderCanvas: true,
    renderFaceMesh: true,
    width: undefined,
    height: undefined,
    maxFaces: 1,
    timeout: 500,
    backend: 'webgl',
    onRender: () => { },
    onRendered: () => { },
    onDetected: () => { },
};

const unmodifiableParams = new Set(['width', 'height', 'backend']);
const modifiableParams = new Set(
    Object.keys(defaultParams).filter(k => !unmodifiableParams.has(k))
);

export default class Detector {
    constructor(containerElement, params) {
        params = Object.assign({}, defaultParams, params);

        const canvasWrapper = document.createElement('div');
        canvasWrapper.className = 'detector-canvas-wrapper';

        const canvas = document.createElement('canvas');
        canvas.className = 'detector-overlay';

        const video = document.createElement('video');
        video.setAttribute('playinline', 'playinline');
        video.style = `transform: scaleX(-1);
            visibility: hidden;
            width: auto;
            height: auto;`;

        canvasWrapper.appendChild(canvas);
        canvasWrapper.appendChild(video);
        containerElement.appendChild(canvasWrapper);

        const scatterContainer = document.createElement('div');
        scatterContainer.className = 'detector-scatter-gl-container';
        containerElement.appendChild(scatterContainer);

        this.params = params;
        this.containerElement = containerElement;
        this.canvasWrapper = canvasWrapper;
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.video = video;
        this.scatterContainer = scatterContainer;
        this.isStarted = false;
    }

    async setupCamera() {
        const stream = await navigator.mediaDevices.getUserMedia({
            'audio': false,
            'video': {
                facingMode: 'user',
                width: this.params.width,
                height: this.params.height,
            },
        });
        this.video.srcObject = stream;

        return new Promise((resolve) => {
            this.video.onloadedmetadata = () => {
                resolve(this.video);
            };
        });
    }

    async load() {
        await Promise.all([
            this.setupCamera(),
            tf.setBackend(this.params.backend),
            tf.ready(),
        ]);
        this.video.play();
        // Get the actual initialized size
        const videoWidth = this.video.videoWidth;
        const videoHeight = this.video.videoHeight;
        this.videoWidth = videoWidth;
        this.videoHeight = videoHeight;

        this.canvas.width = videoWidth;
        this.canvas.height = videoHeight;
        this.canvasWrapper.style =
            `width: ${videoWidth}px; height: ${videoHeight}px`;

        this.ctx.translate(this.canvas.width, 0);
        this.ctx.scale(-1, 1);
        this.ctx.fillStyle = '#32EEDB';
        this.ctx.strokeStyle = '#32EEDB';
        this.ctx.lineWidth = 0.5;

        this.scatterContainer.style =
            `width: ${videoWidth}px; height: ${videoHeight}px;`;
        this.scatterGL = new ScatterGL(this.scatterContainer,
            { 'rotateOnStart': false, 'selectEnabled': false });

        if (!this.params.renderPointCloud) {
            this.scatterContainer.style.display = 'none';
        }

        if (!this.params.renderCanvas) {
            this.canvasWrapper.style.display = 'none';
        }

        [this.faceModel, this.handModel] = await Promise.all([
            facemesh.load({ maxFaces: this.params.maxFaces }),
            handpose.load(),
        ]);
    }

    clearCanvas() {
        this.ctx.drawImage(
            this.video,
            0,
            0,
            this.videoWidth,
            this.videoHeight,
            0,
            0,
            this.canvas.width,
            this.canvas.height
        );
    }

    async renderPrediction() {
        if (!this.faceModel || !this.handModel) {
            throw new Error('Run load() frist');
        }
        this.params.onRender();
        const [fp, hp] = await Promise.all([
            this.faceModel.estimateFaces(this.video),
            this.handModel.estimateHands(this.video),
        ]);
        this.clearCanvas();
        if (this.params.renderCanvas) {
            drawFacePredictions(this.ctx, fp, this.params.renderFaceMesh);
            drawHandPredictions(this.ctx, hp);
        }

        const handPoints = getHandPoints(hp);
        const facePoints = getFacePoints(fp);
        const handBox = BoundingBox.createFromPoints(handPoints);
        const faceBox = BoundingBox.createFromPoints(facePoints, 20);
        const handBoxPoints = handBox ? handBox.toPoints() : [];
        const faceBoxPoints = faceBox ? faceBox.toPoints() : [];

        if (this.params.renderPointCloud && this.scatterGL) {
            // These anchor points allow the hand pointcloud to resize according to its
            // position in the input.
            const ANCHOR_POINTS = [
                [0, 0, 0],
                [0, -this.videoHeight, 0],
                [-this.videoWidth, 0, 0],
                [-this.videoWidth, -this.videoHeight, 0],
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
            if (!this.scatterGLHasInitialized) {
                this.scatterGL.render(dataset);
            } else {
                this.scatterGL.updateDataset(dataset);
            }

            // Render lines for fingers and bounding boxes
            this.scatterGL.setSequences(fingerSeq.concat(handBoxSeq).concat(faceBoxSeq));
            this.scatterGL.setPointColorer((i, selectedIndices, hoverIndex) => {
                let length = handPoints.length;
                if (i < length) return 'red';

                length = length + facePoints.length;
                if (i < length) return 'green';

                length = length + ANCHOR_POINTS.length;
                if (i < length) return 'white';

                return 'blue';
            });
            this.scatterGLHasInitialized = true;
        }

        const deltaVolume = (handBox && faceBox)
            ? handBox.getIntersectionVolume(faceBox)
            : 0.0;
        const octree_distance_threshold = 35; // TODO: maybe turn this into a variable set by GUI?
        const minDistance = getShortestDistance(handPoints, facePoints, octree_distance_threshold);
        let detected = false;
        if (handBox && faceBox && deltaVolume > 0 && !!minDistance) {
            // Only if the two bounding boxes intersect
            if (faceBox.xMin < handBox.xMin && handBox.xMax < faceBox.xMax) {
                // The hand bounding box is with in the face box,
                // which means the hand is in front of the face
                detected = minDistance.distance < 10;
            } else {
                // The hand is on the side
                detected = minDistance.distance < 30;
            }
        }

        if (detected) this.params.onDetected();
        this.params.onRendered({ handPoints, facePoints, handBox, faceBox, deltaVolume, minDistance, detected });
    }

    async _loop() {
        await this.renderPrediction();
        if (!this.isStarted) return;
        if (this.params.timeout > 0) {
            await sleep(this.params.timeout);
        }

        this._loop();
    }

    start() {
        if (!this.isStarted) {
            this.isStarted = true;
            this._loop();
        }
    }

    stop() {
        this.isStarted = false;
    }

    update(params) {
        const keys = Object.keys(params).filter(k => modifiableParams.has(k));
        keys.forEach(k => {
            this.params[k] = params[k];
            if (k === 'renderPointCloud') {
                this.scatterContainer.style.display = params[k] ? '' : 'none';
            }
            if (k === 'renderCanvas') {
                this.canvasWrapper.style.display = params[k] ? '' : 'none';
            }
        });
    }
}
