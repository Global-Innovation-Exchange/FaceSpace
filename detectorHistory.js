import { scale } from 'chroma-js';

const handler = {
    get: function (target, name) {
        return name in target ? target[name] : 0;
    },
};

export default class DetectorHistory {
    constructor(retention) {
        this.retention = retention;
        this.history = [];
        // Use Proxy so undefined key will return 0
        this.faceCount = new Proxy({}, handler);
        this.handCount = new Proxy({}, handler);
    }

    _cleanup() {
        // Clean up the history that exceed the storing limit
        const now = new Date();
        while (this.history.length > 0 &&
            (now - this.history[0].date) > this.retention) {
            const expired = this.history.shift();
            this.faceCount[expired.faceIndex]--;
            this.handCount[expired.handIndex]--;
        }
    }

    changeRetention(retention) {
        this.retention = retention;
        this._cleanup();
    }

    push(handIndex, faceIndex) {
        this.history.push({ date: new Date(), handIndex, faceIndex });
        this.faceCount[faceIndex]++;
        this.handCount[handIndex]++;
        this._cleanup();
    }

    _getMap(countMap, color = null) {
        this._cleanup();
        const max = Math.max(...Object.values(countMap), 0);
        const copy = Object.assign({}, countMap);

        if (max !== 0) {
            // Normalizing 
            Object.keys(copy).forEach(k => { copy[k] /= max; });
        }

        if (color) {
            const fn = scale(color);
            const colorHandler = {
                get: function (target, name) {
                    return name in target ? fn(target[name]) : fn(0);
                },
            };
            return new Proxy(copy, colorHandler);
        }

        return new Proxy(copy, handler);
    }

    getFaceMap(color = null) {
        return this._getMap(this.faceCount, color);
    }

    getHandMap(color = null) {
        return this._getMap(this.handCount, color);
    }
}
