import { BehaviorSubject, merge, Observable } from 'rxjs';
import { filter, map } from 'rxjs/operators';
import { Util } from '@hawryschuk/common';
import * as Mutex from '@hawryschuk/resource-locking/mutex';
import * as Semaphore from '@hawryschuk/resource-locking/semaphore';
import * as AtomicData from '@hawryschuk/resource-locking/atomic.data';
import { Model } from './model';

/** Basic DAO : In Memory : Reactive RXJS */
export class DAO {
    static instance: DAO;

    static getInstance(): DAO { return this.instance ||= new (this as any)(); }

    constructor(public models: { [name: string]: Function }) {
        const { constructor } = this as any;
        constructor.instance ||= this;
        DAO.instance ||= this;
    }

    ready$ = Promise.resolve(new Date());
    created$ = new BehaviorSubject<{ klass: any; object: any } | null>(null);
    updated$ = new BehaviorSubject<{ klass: any; object: any } | null>(null);
    deleted$ = new BehaviorSubject<{ klass: any; object: any } | null>(null);

    change$: Observable<{ action: string; klass: any; object: any }> =
        merge(
            this.created$.pipe(map(v => v && ({ ...v, action: 'created' }))),
            this.updated$.pipe(map(v => v && ({ ...v, action: 'updated' }))),
            this.deleted$.pipe(map(v => v && ({ ...v, action: 'deleted' }))),
        ).pipe(filter(v => !!v));
    protected instances: { [modelName: string]: { [modelId: string]: Model } } =
        Object.keys(this.models).reduce(
            (models, className) => ({ ...models, [className]: {} }),
            {} as any
        );
    get allModels(): Promise<Model[]> {
        return (async () => {
            const modelss: any[][] = await Promise.all(Object.entries(this.models).map(async ([klassName, klass]) => {
                const indexedObjects = await this.get<any>(klass).catch(e => { console.error(e); throw e; });
                const objects: Model[] = Object.values(indexedObjects);
                return objects.filter(Boolean);
            }));
            const array = modelss.reduce((all, models) => [...all, ...models], []);
            return array;
        })();
    }

    async reset() {
        for (let model of await this.allModels) {
            await model.delete(); // delete online,delete in memory
        }
    }

    /** Online Data : Memory : For Sub-Classes to implement ( ie: REST/Firestore/SQLite/etc ) */
    static reads = 0;
    async getOnline(klass: any, id = '', from = ''): Promise<Model | { [id: string]: Model }> {
        klass = this.klassToKlass(klass);
        const objects = this.instances[this.className(klass)] as { [id: string]: Model };
        if (!objects) throw new Error(`${this.className(klass)} is an unknown DAO Model`);
        return id ? objects[id] : objects;
    }

    async create<M extends Model>(klass: any, data: M): Promise<M> {
        klass = this.klassToKlass(klass);
        if (!data || Util.equals({}, data)) { throw new Error(`DAO.create(${this.className(klass)},${data})`); }
        const object: M = await klass.create(data, this);
        await Util.pause(10);
        await object.ready$;
        this.instances[this.className(klass)][object.id] = object;
        this.created$.next({ klass: this.className(klass), object });
        this.updateCache(klass, object.id, object);
        return object;
    }

    async delete(klass: any, id: string, fromObject = false, getOffline = false) {
        klass = this.klassToKlass(klass);
        const object: Model = getOffline      // BUG: SubClass.delete -> DAO.delete -> SubClass.get() 
            ? await DAO.prototype.getOnline.call(this, klass, id)
            : await this.get(klass, id);
        if (!fromObject && object) await object.delete(new Date, true);
        delete this.instances[this.className(klass)][id];
        this.deleted$.next({ klass: this.className(klass), object });
        this.updateCache(klass, id, null);
        delete this.cacheExpiry[this.cacheKey(klass, id)];
        return object;
    }

    async update<M extends Model>(klass: any, id: string, data: any, fromObject?: M): Promise<M> {
        klass = this.klassToKlass(klass);
        const object: M = fromObject || await this.get(klass, id);
        if (!object) {
            throw new Error(`DAO.update(${this.className(klass)},${id}): object is not defined`);
        } else {
            const actual = object.POJO();
            const expected = { ...object.POJO(), ...data };
            const equals = Util.equalsDeep(actual, expected);
            if (!equals) {
                await object.update$(data, true); // object.POJO() should equal expected
                this.updated$.next({ klass: this.className(klass), object });
            } else {
                // Util.warn([`DAO.update: object-already-has-data`, { klass: this.className(klass), id, data }]);
            }
            this.updateCache(klass, id, object);
        }
        return object;
    }

    async where<C>(klass: any, criteria: C): Promise<C[]> {
        klass = this.klassToKlass(klass);
        const objects: C[] = Object.values(await this.get(klass));
        const found = objects.filter((o: any) => Object.entries(criteria).every(([key, value]) => o[key] === value));
        return found;
    }
    async findWhere<C>(klass: any, criteria: C): Promise<C | undefined> {
        klass = this.klassToKlass(klass);
        const objects: C[] = Object.values(await this.get(klass));
        const found = objects.find((o: any) => Object.entries(criteria).every(([key, value]) => o[key] === value));
        return found;
    }

    /** Cacheing strategy : 30seconds */
    static cacheExpiry = 10000;
    private cacheQuery = {};
    private get cacheExpiry() { return DAO.cacheExpiry; }
    private cacheKey(klass: any, id: string) {
        klass = this.klassToKlass(klass);
        return `${this.className(klass)}.${id || ''}`;
    }
    private updateCache(klass: any, id: string, object: any) {
        const key = this.cacheKey(klass, id);
        const item = this.cacheQuery[key] = this.cacheQuery[key] || {};
        return Object.assign(item, { time: new Date().getTime(), object });
    }

    private async getCached(klass: any, id: string) {
        klass = this.klassToKlass(klass);
        const cached = await Semaphore.getInstance({ data: AtomicData.getInstance({ resource: this.cacheKey(klass, id) }) }).use({
            block: async () => {
                const cacheItem = this.cacheQuery[this.cacheKey(klass, id)];
                const isExpired = cacheItem && (new Date().getTime() - cacheItem.time) >= this.cacheExpiry;
                if (cacheItem && !isExpired) {
                    return cacheItem.object;
                } else {
                    const online = await this.getOnline(klass, id, 'DAO(any).get');
                    await this.synchronize(klass, id, online);
                    const inmemory = await DAO.prototype.getOnline.apply(this, [klass, id, 'DAO.get']);
                    this.updateCache(klass, id, inmemory);
                    return inmemory;
                }
            }
        });
        return cached;
    }

    /** Get: 1) From Cache, 2) Online->Synchronize->Cache */
    async get<U = Model | Model[]>(klass: any, id = ''): Promise<U> {
        klass = this.klassToKlass(klass);
        if (!klass) { console.log('no klass name for', klass) }
        const cached = await this.getCached(klass, id);
        return cached;
    }

    klassToKlass(klass: any) { return typeof klass === 'string' ? this.models[klass] : klass; }
    className(klass: any) { return typeof klass === 'string' ? klass : Object.keys(this.models).find(className => this.models[className] === klass); }

    /** Feat: Synchronize in-memory with online */
    async synchronize(klass: any, id = '', online: any) {
        klass = this.klassToKlass(klass);
        if (!klass) throw 'up';
        const inMemory = await DAO.prototype.getOnline.call(this, klass, id, 'DAO.synchronize');
        if (id) {
            if (inMemory) {
                if (online) {
                    await Model.prototype.update$.call(inMemory, { ...online.POJO(), dao: this }, true);
                } else {
                    await DAO.prototype.delete.call(this, klass, id, false, true);
                }
                return inMemory;
            } else if (!inMemory) {
                if (online) {
                    const object = await DAO.prototype.create.call(this, klass, online.POJO());
                    return object;
                }
            }
        } else {
            for (const id of Object.keys(inMemory)) {
                await this.synchronize(klass, id, online[id]);
            }
            for (let [id, object] of Object.entries(online)) {
                if (!inMemory[id]) // perf: because its been updated
                    await this.synchronize(klass, id, object);
            }
        }
    }
}
