export declare type Coords3D = Array<[number, number, number]>;
export declare type Coords2DPlus = Array<[number, number, ...number[]]>;
export interface FacePrediction {
    faceInViewConfidence: number;
    boundingBox: {
        topLeft: [number, number];
        bottomRight: [number, number];
    };
    mesh: Coords3D;
    scaledMesh: Coords3D;
    annotations?: {
        [key: string]: Coords3D;
    };
}

export interface HandPrediction {
    annotations: {
        [key: string]: Coords3D;
    };
    handInViewConfidence: number;
    landmarks: Coords3D;
    boundingBox: {
        topLeft: [number, number];
        bottomRight: [number, number];
    };
}