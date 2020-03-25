
import * as facemesh from '@tensorflow-models/facemesh';
import * as handpose from '@tensorflow-models/handpose';
import * as tf from '@tensorflow/tfjs-core';
import { sleep } from './utils';
import { fingerLookup, drawFacePredictions, drawHandPredictions } from './draw';
import { BoundingBox, boxLookup } from './box';

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

function getShortestDistance(points1, points2) {
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
        const minDistance = getShortestDistance(handPoints, facePoints);

        let detected = false;
        if (handBox && faceBox && deltaVolume > 0 && !!minDistance) {
            // Only if the two bounding boxes intersect
            if (faceBox.xMin < handBox.xMin && handBox.xMax < faceBox.xMax) {
                // The hand bounding box is with in the face box,
                // which means the hand is in front of the face
                detected = minDistance.d < 10;
            } else {
                // The hand is on the side
                detected = minDistance.d < 30;
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
