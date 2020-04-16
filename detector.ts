import * as facemesh from '@tensorflow-models/facemesh';
import * as handpose from '@tensorflow-models/handpose';
import * as tf from '@tensorflow/tfjs-core';
import { ScatterGL } from 'scatter-gl';

import { sleep } from './utils';
import { fingerLookup, drawFacePredictions, drawHandPredictions } from './draw';
import { BoundingBox, boxLookup } from './box';
import DetectionHistory from './detectorHistory';

import { Coords3D, FacePrediction, HandPrediction } from './type';

type Detection = {
    isNew: boolean,
    isDetected: boolean,
};

class DetectionBuffer {
    private buffer: boolean[];
    constructor(size: number) {
        this.buffer = [];
        for(let i = 0; i < (size + 1); i++) {
            this.buffer.push(false);
        }
    }

    push(isDetected: boolean) {
        this.buffer.push(isDetected);
        this.buffer.shift();
    }

    get detection() {
        const isDetected = this.buffer.slice(1).every(i => i);
        return {
            isNew: !this.buffer[0] && isDetected,
            isDetected,
        } as Detection;
    }
}

function getFacePoints(predictions: FacePrediction[]) {
    const pointsData = predictions.map(prediction =>
        prediction.scaledMesh.map(point => [-point[0], -point[1], -point[2]]));
    return pointsData.flat() as Coords3D;
}

function getHandPoints(predictions: HandPrediction[]) {
    const pointsData = predictions.map(prediction =>
        prediction.landmarks.map(point => [-point[0], -point[1], -point[2]]));
    return pointsData.flat() as Coords3D;
}

type MinDistance = {
    diffX: number,
    diffY:number,
    diffZ: number,
    distance: number,
    handPointIndex: number,
    facePointIndex: number,
}

function getShortestDistance(handPoints: Coords3D, facePoints: Coords3D) {
    let minDistance: MinDistance = undefined;
    if (handPoints.length != 0 || handPoints.length != 0) { // if there's no hand or face, there's no need to build the tree
        for (let handPointIndex = 0; handPointIndex < handPoints.length; handPointIndex++) {
            const handPoint = handPoints[handPointIndex];
            for (let facePointIndex = 0; facePointIndex < facePoints.length; facePointIndex++) {
                const facePoint = facePoints[facePointIndex];
                const diffX = handPoint[0] - facePoint[0];
                const diffY = handPoint[1] - facePoint[1];
                const diffZ = handPoint[2] - facePoint[2];
                const distance = Math.sqrt(Math.pow(diffX, 2) + Math.pow(diffY, 2) + Math.pow(diffZ, 2));
                if (minDistance === undefined || distance < minDistance.distance) {
                    minDistance = { diffX, diffY, diffZ, distance, handPointIndex, facePointIndex };
                }
            }
        }
    }
    return minDistance;
}

interface DetectorParams {
    renderCanvas: boolean;
    renderFaceMesh: boolean;
    renderPointCloud: boolean;
    renderBoundingBox: boolean;
    renderContactPoint: boolean;
    renderHeatmap: boolean;
    width: number | undefined;
    height: number | undefined,
    maxFaces: number,
    timeout: number,
    detectionHistory: number,
    detectionBufferSize: number,
    backend: string,
    onRender: () => void,
    onRendered: (params: {
        handPoints: Coords3D,
        facePoints: Coords3D,
        handBox: BoundingBox,
        faceBox: BoundingBox,
        deltaVolume: number,
        minDistance: MinDistance,
        detection: Detection
    }) => void,
    onDetected: () => void,
    [key: string]: any,
}

const defaultParams: DetectorParams = {
    renderCanvas: true,
    renderFaceMesh: false,
    renderPointCloud: false,
    renderBoundingBox: false,
    renderContactPoint: false,
    renderHeatmap: false,
    width: undefined,
    height: undefined,
    maxFaces: 1,
    timeout: 300, // 0.3 sec
    detectionHistory: 1000 * 60 * 60, // An hour
    detectionBufferSize: 2,
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
    params: DetectorParams;
    containerElement: HTMLElement;
    canvasWrapper: HTMLDivElement;
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    video: HTMLVideoElement;
    scatterContainer: HTMLDivElement;
    isStarted: boolean;
    hasScatterGLRendered: boolean;
    detectionHistory: DetectionHistory;
    detectionBuffer: DetectionBuffer;

    // These initialized after load()
    faceModel: facemesh.FaceMesh;
    handModel: handpose.HandPose;
    videoWidth: number;
    videoHeight: number;
    scatterGL: ScatterGL;

    constructor(containerElement: HTMLElement, params?: Partial<DetectorParams>) {
        params = Object.assign({}, defaultParams, params);

        const canvasWrapper = document.createElement('div') as HTMLDivElement;
        canvasWrapper.className = 'detector-canvas-wrapper';

        const canvas = document.createElement('canvas') as HTMLCanvasElement;
        canvas.className = 'detector-overlay';

        const video = document.createElement('video') as HTMLVideoElement;
        video.setAttribute('playinline', 'playinline');
        video.style.transform = 'scaleX(-1)';
        video.style.display = 'none';
        video.style.width = 'none';
        video.style.height = 'none';

        canvasWrapper.appendChild(canvas);
        canvasWrapper.appendChild(video);
        containerElement.appendChild(canvasWrapper);

        const scatterContainer = document.createElement('div') as HTMLDivElement;
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
        this.hasScatterGLRendered = false;
        this.detectionHistory = new DetectionHistory(this.params.detectionHistory);
        this.detectionBuffer = new DetectionBuffer(this.params.detectionBufferSize);
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

    /**
     * Load the detector's models and video.
     * @throws {DOMException} if a front facing camera is not found.
     * See https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia.
     */
    async load() {
        await Promise.all([
            this.setupCamera(),
            tf.setBackend(this.params.backend),
            tf.ready(),
        ]);
        this.video.play();
        // Safari will auto pause if the page goes into background tab
        // This is a fix to keep the video playing in background
        this.video.onpause = () => {
            this.video.play();
        };
        // Get the actual initialized size
        const videoWidth = this.video.videoWidth;
        const videoHeight = this.video.videoHeight;
        this.videoWidth = videoWidth;
        this.videoHeight = videoHeight;

        this.canvas.width = videoWidth;
        this.canvas.height = videoHeight;
        this.canvasWrapper.style.width = `${videoWidth}px`;
        this.canvasWrapper.style.height = `${videoHeight}px`;

        this.ctx.translate(this.canvas.width, 0);
        this.ctx.scale(-1, 1);
        this.ctx.fillStyle = '#32EEDB';
        this.ctx.strokeStyle = '#32EEDB';
        this.ctx.lineWidth = 0.5;

        this.scatterContainer.style.width = `${videoWidth}px`;
        this.scatterContainer.style.height = `${videoHeight}px`;
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
        // Clear the canvas
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
        // Draw the video on to the canvas
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

        // Skip if the video is paused
        if (this.video.paused) return;

        this.params.onRender();
        const videoPixels = tf.browser.fromPixels(this.video);
        const [fp, hp] = await Promise.all([
            this.faceModel.estimateFaces(videoPixels) as Promise<FacePrediction[]>,
            this.handModel.estimateHands(videoPixels) as Promise<HandPrediction[]>,
        ]);
        videoPixels.dispose();

        if (this.params.renderCanvas) {
            this.clearCanvas();
            drawFacePredictions(this.ctx, fp, this.params.renderFaceMesh);
            drawHandPredictions(this.ctx, hp);
        }

        const handPoints = getHandPoints(hp);
        const facePoints = getFacePoints(fp);
        const faceBox = BoundingBox.createFromPoints(facePoints, 10);
        const faceBoxPoints = faceBox ? faceBox.toPoints() : [];
        let isInFrontOfFace = false;

        // rescale hand z axis according to center of the face
        if (handPoints.length && facePoints.length) {
            const faceHalfWidth = (faceBox.xMax - faceBox.xMin) / 2;
            const faceCenterX = faceBox.xMin + faceHalfWidth;
            let handXAvg = 0;
            for (let i = 0; i < handPoints.length; i++) {
                handXAvg += handPoints[i][0];
            }
            handXAvg /= handPoints.length;
            const distanceToFaceCenterX = Math.abs(handXAvg - faceCenterX);
            if (handXAvg > faceBox.xMin && handXAvg < faceBox.xMax) { // hand in front of the face
                isInFrontOfFace = true;
                const isFarFromCenter = (faceHalfWidth - distanceToFaceCenterX) / faceHalfWidth; // from 1 to 0 depends on how far from face center x
                const scaleFactor = (Math.atan(isFarFromCenter * 32 - 25) / (Math.PI / 2) + 1) / 2;
                for (let i = 0; i < handPoints.length; i++) {
                    handPoints[i][2] = handPoints[i][2] + 35 * scaleFactor;
                }
            }
        }

        const handBox = BoundingBox.createFromPoints(handPoints);
        const handBoxPoints = handBox ? handBox.toPoints() : [];

        const deltaVolume = (handBox && faceBox)
            ? handBox.getIntersectionVolume(faceBox)
            : 0.0;
        const minDistance = getShortestDistance(handPoints, facePoints);

        let detected = false;
        if (handBox && faceBox && !!minDistance) {
            if (isInFrontOfFace) {
                // The hand bounding box is with in the face box,
                // which means the hand is in front of the face
                detected = minDistance.distance < 10;
            } else {
                // The hand is on the side
                detected = minDistance.distance < 30;
            }
        }
        this.detectionBuffer.push(detected);
        const detection = this.detectionBuffer.detection;

        if (detection.isDetected) {
            this.params.onDetected();
            this.detectionHistory.push(minDistance.handPointIndex, minDistance.facePointIndex);
        }

        if (this.params.renderPointCloud && this.scatterGL) {
            // These anchor points allow the hand pointcloud to resize according to its
            // position in the input.
            const ANCHOR_POINTS = [
                [0, 0, 0],
                [0, -this.videoHeight, 0],
                [-this.videoWidth, 0, 0],
                [-this.videoWidth, -this.videoHeight, 0],
            ] as Coords3D;
            // Add finger lines
            const fingerSeq = handPoints.length > 0
                ? Object.values(fingerLookup).map(fingerIndices => ({indices: fingerIndices})) : [];
            // Add hand bounding box lines
            const boxValues = Object.values(boxLookup);
            const handBoxSeqOffset = handPoints.length + facePoints.length + ANCHOR_POINTS.length;
            const handBoxSeq = handBoxPoints.length > 0
                ? boxValues.map(b => ({indices: b.map(s => s + handBoxSeqOffset)})) : [];
            // Add face bounding box lines
            const faceBoxSeqOffset = handBoxSeqOffset + handBoxPoints.length;
            const faceBoxSeq = faceBoxPoints.length > 0
                ? boxValues.map(b => ({indices: b.map(s => s + faceBoxSeqOffset)})): [];
            const dataset = new ScatterGL.Dataset(
                handPoints.concat(facePoints)
                    .concat(ANCHOR_POINTS)
                    .concat((this.params.renderBoundingBox ? handBoxPoints : []) as Coords3D)
                    .concat((this.params.renderBoundingBox ? faceBoxPoints : []) as Coords3D)
            );
            if (!this.hasScatterGLRendered) {
                this.scatterGL.render(dataset);
            } else {
                this.scatterGL.updateDataset(dataset);
            }

            const faceHeatmap = this.detectionHistory.getFaceMap('OrRd');
            const handHeatmap = this.detectionHistory.getHandMap(['skyblue', 'navy']);
            // Render lines for fingers and bounding boxes
            this.scatterGL.setSequences(fingerSeq.concat(handBoxSeq).concat(faceBoxSeq));
            this.scatterGL.setPointColorer((i, selectedIndices, hoverIndex) => {
                if (minDistance && this.params.renderContactPoint &&
                    (i == handPoints.length + minDistance.facePointIndex || i == minDistance.handPointIndex)) {
                    return 'red';
                }
                const renderHeatmap = this.params.renderHeatmap;
                let length = handPoints.length;
                if (i < length) return renderHeatmap ?  handHeatmap[i].toString() : 'skyblue';

                length = length + facePoints.length;
                if (i < length) return renderHeatmap ? faceHeatmap[i - handPoints.length].toString() : 'lightred';

                length = length + ANCHOR_POINTS.length;
                if (i < length) return 'white';

                return 'blue'; // 3d bounding box
            });
            this.hasScatterGLRendered = true;
        }

        this.params.onRendered({ handPoints, facePoints, handBox, faceBox, deltaVolume, minDistance, detection });
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

    update(params: Partial<DetectorParams>) {
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
