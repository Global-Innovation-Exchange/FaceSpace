import { scale, Color } from 'chroma-js';
import Dexie from 'dexie';

const handler = {
    get: function (target: Record<number, number>, name: number) {
        return name in target ? target[name] : 0;
    },
};
function createCounter(obj = {}) {
    // Use proxy so the undefined key would be 0
    return new Proxy(obj, handler);
}

class Database extends Dexie {
    history: Dexie.Table<HistoryItem, Date>;
    constructor() {
        super("Database");

        // Define tables and indices
        this.version(1).stores({
            history: '&date, isNew'
        });

        // This is needed to work across typescript using babel-preset-typescript
        this.history = this.table('history');
    }
}

interface HistoryItem {
    date: Date;
    handIndex: number;
    faceIndex: number;
    isNew: boolean;
}

type ScaleColor = string | Color;
type ScaleColors = ScaleColor | ScaleColors[];

export default class DetectorHistory {
    private retention: number;
    private db: Database;

    constructor(retention: number) {
        this.db = new Database();
        this.retention = retention;
    }

    private cleanup(now: Date = new Date()): Promise<void> {
        // Clean up the history that exceed the storing limit
        return this.db.transaction('rw', this.db.history, async () => {
            // cleanup
            const date = new Date(now.getTime() - this.retention);
            await this.get().below(date).delete();
        });
    }
    private get() {
        return this.db.history.where('date');
    }
    private getSince(from: Date, isNew?: boolean) {
        let collection = this.get().above(from);
        if (isNew !== undefined) {
            collection = collection.and(i => i.isNew == isNew);
        }

        return collection;
    }
    private getBetween(from: Date, to: Date, isNew?: boolean) {
        let collection = this.get().between(from, to);
        if (isNew !== undefined) {
            collection = collection.and(i => i.isNew == isNew);
        }

        return collection;
    }

    public getHistory(from: Date, to: Date, isNew?: boolean): Promise<HistoryItem[]> {
        return this.getBetween(from, to, isNew).toArray();
    }
    public getCount(from: Date, to: Date, isNew?: boolean): Promise<number> {
        return this.getBetween(from, to, isNew).count();
    }

    public getHistorySince(from: Date, isNew?: boolean): Promise<HistoryItem[]> {
        return this.getSince(from, isNew).toArray();
    }
    public getCountSince(from: Date, isNew?: boolean): Promise<number> {
        return this.getSince(from, isNew).count();
    }

    public changeRetention(retention: number) {
        this.retention = retention;
        this.cleanup();
    }

    public async push(handIndex: number, faceIndex: number, isNew: boolean) {
        const now = new Date();
        await this.db.transaction('rw', this.db.history, async () => {
            await this.db.history.add({ date: now, handIndex, faceIndex, isNew });
            await this.cleanup(now);
        });
    }

    // Initialize last hour if facecount and hand count is null
    public async getHeatMap(from: Date, to: Date) {
        const faceCount = createCounter();
        const handCount = createCounter();
        await this.getBetween(from, to, true).each(item => {
            faceCount[item.faceIndex]++;
            handCount[item.handIndex]++;
        });
        return {
            faceCount,
            handCount,
            getFaceMap(color: ScaleColors) {
                return getMap(this.faceCount, color);
            },
            getHandMap(color: ScaleColors) {
                return getMap(this.faceCount, color);
            }
        };
    }
}

function getColorHandler(color: ScaleColors) {
    const fn = scale(color as ScaleColor[]);
    const colorHandler = {
        get: function (target: Record<number, number>, name: number) {
            return name in target ? fn(target[name]) : fn(0);
        },
    };
    return colorHandler;
}

function getMap(countMap: Record<number, number>, color: ScaleColors = null) {
    const max = Math.max(...Object.values(countMap), 0);
    const copy = Object.assign({}, countMap);

    if (max !== 0) {
        // Normalizing
        Object.keys(copy).forEach(k => { copy[+k] /= max; });
    }

    return new Proxy(
        copy,
        color ? getColorHandler(color) : handler);
}