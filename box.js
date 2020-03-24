class BoundingBox {
    constructor(xMin, xMax, yMin, yMax, zMin, zMax) {
        this.xMin = xMin;
        this.xMax = xMax;
        this.yMin = yMin;
        this.yMax = yMax;
        this.zMin = zMin;
        this.zMax = zMax;
    }

    get xCenter() {
        return this.xMax - Math.abs(this.xMax - this.xMin);
    }

    get yCenter() {
        return this.yMax - Math.abs(this.yMax - this.yMin);
    }

    get zCenter() {
        return this.zMax - Math.abs(this.zMax - this.zMin);
    }

    static createFromPoints(objectPoints, xOffset = 0) {
        let box = undefined;

        for (let i = 0; i < objectPoints.length; i++) {
            const p = objectPoints[i];
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
            if (x < box.xMin) box.xMin = x;
            if (x > box.xMax) box.xMax = x;
            if (y < box.yMin) box.yMin = y;
            if (y > box.yMax) box.yMax = y;
            if (z < box.zMin) box.zMin = z;
            if (z > box.zMax) box.zMax = z;
        }

        if (box) {
            box.xMax = box.xMax + xOffset;
            box.xMin = box.xMin - xOffset;
        }

        return box
            ? new BoundingBox(box.xMin, box.xMax, box.yMin, box.yMax, box.zMin, box.zMax)
            : undefined;
    }

    getIntersectionVolume(box) {
        if (!box) return 0.0;

        // determine the coordinates of the intersection rectangle
        const xMin = Math.max(this.xMin, box.xMin);
        const yMin = Math.max(this.yMin, box.yMin);
        const zMin = Math.max(this.zMin, box.zMin);

        const xMax = Math.min(this.xMax, box.xMax);
        const yMax = Math.min(this.yMax, box.yMax);
        const zMax = Math.min(this.zMax, box.zMax);

        if (xMax < xMin || yMax < yMin || zMax < zMin) {
            return 0.0;
        }

        return (xMax - xMin) * (yMax - yMin) * (zMax - zMin);
    }
    toPoints() {
        return [
            [this.xMin, this.yMin, this.zMin],
            [this.xMin, this.yMin, this.zMax],
            [this.xMin, this.yMax, this.zMin],
            [this.xMin, this.yMax, this.zMax],
            [this.xMax, this.yMin, this.zMin],
            [this.xMax, this.yMin, this.zMax],
            [this.xMax, this.yMax, this.zMin],
            [this.xMax, this.yMax, this.zMax],
        ];
    }
}

const boxLookup = {
    top: [0, 2, 6, 4, 0],
    bottom: [1, 3, 7, 5, 1],
    column1: [0, 1],
    column2: [2, 3],
    column3: [4, 5],
    column4: [6, 7],
};

export { BoundingBox, boxLookup }