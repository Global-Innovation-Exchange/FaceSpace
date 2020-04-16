import { scale, Color } from 'chroma-js';

const handler = {
    get: function (target: Record<number, number>, name: number) {
        return name in target ? target[name] : 0;
    },
};

interface HistoryItem {
    date: number;
    handIndex: number;
    faceIndex: number;
}
type ScaleColor = string | Color;
type ScaleColors = ScaleColor | ScaleColors[];

export default class DetectorHistory {
    private retention: number;
    private history: HistoryItem[];
    private faceCount: Record<number, number>;
    private handCount: Record<number, number>;

    constructor(retention: number) {
        this.retention = retention;
        this.history = [];
        // Use Proxy so undefined key will return 0
        this.faceCount = new Proxy({}, handler);
        this.handCount = new Proxy({}, handler);
    }

    private cleanup() {
        // Clean up the history that exceed the storing limit
        const now = Date.now()
        while (this.history.length > 0 &&
            (now - this.history[0].date) > this.retention) {
            const expired = this.history.shift();
            this.faceCount[expired.faceIndex]--;
            this.handCount[expired.handIndex]--;
        }
    }

    changeRetention(retention: number) {
        this.retention = retention;
        this.cleanup();
    }

    push(handIndex: number, faceIndex: number) {
        this.history.push({ date: Date.now(), handIndex, faceIndex });
        this.faceCount[faceIndex]++;
        this.handCount[handIndex]++;
        this.cleanup();
    }

    private getColorHandler(color: ScaleColors) {
        const fn = scale(color as ScaleColor[]);
        const colorHandler = {
            get: function(target: Record<number, number>, name: number) {
                return name in target ? fn(target[name]) : fn(0);
            },
        };
        return colorHandler;
    }

    private getMap(countMap: Record<number, number>, color: ScaleColors = null) {
        this.cleanup();
        const max = Math.max(...Object.values(countMap), 0);
        const copy = Object.assign({}, countMap);

        if (max !== 0) {
            // Normalizing
            Object.keys(copy).forEach(k => { copy[+k] /= max; });
        }

        return new Proxy(
            copy,
            color ? this.getColorHandler(color) : handler);
    }

    getFaceMap(color: ScaleColors = null) {
        return this.getMap(this.faceCount, color);
    }

    getHandMap(color: ScaleColors = null) {
        return this.getMap(this.handCount, color);
    }
}
