import { BehaviorSubject, Observable } from 'rxjs';
import { DAO } from './DAO';
import { Util } from '@hawryschuk/common';

/** Model Class: BusinessModel --o Creator (BusinessModel.Models , business.models) */
export class Model<T = DAO> {
    id: string;

    get dao() { return this[Symbol.for('dao')] }
    set dao(d: DAO) { this[Symbol.for('dao')] = d; }

    constructor({ id = Util.UUID, ...data }: any, dao: T) {
        Object.assign(this, { id, dao, ...data });
    }

    get value$() { return (this[Symbol.for('value$')] ||= new BehaviorSubject(this.POJO())); }
    get updated$() { return (this[Symbol.for('updated$')] ||= new BehaviorSubject<any>(null)); }
    get deleted$() { return (this[Symbol.for('deleted$')] ||= new BehaviorSubject<any>(null)); }
    get ready$() { return (this[Symbol.for('ready$')] ||= Util.pause(1).then(() => this.value$.next(this.POJO()))); }
    set ready$(v: any) { this[Symbol.for('ready$')] = v }

    static async create(data: any, dao: DAO): Promise<any> {
        if (Util.equalsDeep({}, data)) { throw new Error('Model: No Data'); }
        const object = new this(data, dao);
        await object.ready$;
        return object;
    }
    
    _cached?: number = (this as any)._cached || new Date().getTime();

    POJO?() {
        return Object
            .entries(this)
            .filter(([key, value]) => [Function, Promise, Observable, DAO].every(klass => !(value instanceof klass)))
            .filter(([key, value]) => !key.endsWith('$'))
            .filter(([key, value]) => !key.startsWith('_'))
            .filter(([key, value]) => key !== 'dao')
            .reduce((pojo, [key, value]) => ({ ...pojo, [key]: value }), {});
    }
    
    async delete?(date = new Date, fromDAO = false) {
        Util.log(`Model(${this.constructor.name}).delete(${date},${fromDAO})`)
        if (this.dao && !this.deleted$.value) {
            this.deleted$.next(date);
            !fromDAO && this.dao && await this.dao.delete(this.constructor, this.id, true, true);
            Util.log(['removing dao from object', this.constructor.name, this.POJO()]);
            this.dao = null;
        }
        Util.log(`/Model(${this.constructor.name}).delete(${date},${fromDAO})`)
    }
    
    /** Updates the object, syncs-data-with-dao, publishes an update event */
    async update$?(data: any, fromDao = false) {
        if (!Util.equalsDeep({ ...this.POJO(), ...data }, this.POJO())) {
            Object.assign(this, data);
            if (!fromDao && this.dao) await this.dao.update(this.constructor, this.id, data, this);
            this.value$.next(this.POJO());
            this.updated$.next(this.POJO());
        }
    }
}