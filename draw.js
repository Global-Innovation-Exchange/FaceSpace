import { TRIANGULATION } from './triangulation';

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

function drawFaceKeyPoints(ctx, keypoints, drawMesh) {
    if (drawMesh) {
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
}

// for rendering each finger as a polyline
const fingerLookup = {
    thumb: [0, 1, 2, 3, 4],
    indexFinger: [0, 5, 6, 7, 8],
    middleFinger: [0, 9, 10, 11, 12],
    ringFinger: [0, 13, 14, 15, 16],
    pinky: [0, 17, 18, 19, 20],
};

function drawHandKeyPoints(ctx, keypoints) {
    const keypointsArray = keypoints;

    for (let i = 0; i < keypointsArray.length; i++) {
        const y = keypointsArray[i][0];
        const x = keypointsArray[i][1];
        drawPoint(ctx, x - 2, y - 2, 3);
    }

    const fingers = Object.keys(fingerLookup);
    for (let i = 0; i < fingers.length; i++) {
        const finger = fingers[i];
        const points = fingerLookup[finger].map(idx => keypoints[idx]);
        drawPath(ctx, points, false);
    }
}

function drawFacePredictions(ctx, predictions, drawMesh) {
  predictions.forEach((prediction) => {
    const keyPoints = prediction.scaledMesh;
    drawFaceKeyPoints(ctx, keyPoints, drawMesh);
  });
}

function drawHandPredictions(ctx, predictions) {
  predictions.forEach((prediction) => {
    const keyPoints = prediction.landmarks;
    drawHandKeyPoints(ctx, keyPoints);
  });
}
export {
    fingerLookup,
    drawPoint,
    drawPath,
    drawFaceKeyPoints,
    drawHandKeyPoints,
    drawFacePredictions,
    drawHandPredictions,
};
