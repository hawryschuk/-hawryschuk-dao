import { Util } from '@hawryschuk/common';
import { filter, take } from 'rxjs/operators';
import { expect } from 'chai';
import { DAO } from './DAO';
import { Model } from './model';

export class Account extends Model { username: string; }
export class Membership extends Model { accountId: string; companyId: string; }
export class Company extends Model {
    name: string;
    memberships: string[] = (this as any).memberships || [];
    get members() { return Promise.all(this.memberships.map(id => this.dao.get(Membership, id))) }
}
export class SampleDAO extends DAO {
    static models = { Account, Company, Membership };
    constructor() { super(SampleDAO.models) }
}
export const testDAO = ({
    title = '',
    dao = new DAO({ Account, Company, Membership }),
    focus = false,
    skip = false,
    delay = 0
} = {}) => {
    if (skip) return;
    const _it = focus && it.only || it;
    title = title || dao.constructor.name;
    describe(`DAO:${title}`, () => {
        before(() => dao.ready$.then(() => dao.reset()));
        after(() => (dao as any).finish && (dao as any).finish());
        beforeEach(async () => {
            if (delay) {
                await Util.pause(delay);
                Util.log([new Date, '-after-delay-', delay]);
            }
        });

        _it('Makes public which models it has available', async () => {
            expect(dao.models.Account).to.be.ok;
        });
        _it('Does not create an object if one doesnt exist', async () => {
            const acmeSchool = await dao.get(Company, 'invalid-id');
            expect(acmeSchool).to.be.undefined;
        });
        _it('can create object : ie; Company', async () => {
            const acmeSchool = await dao.create(Company, <Company>{ name: 'Acme Public School' });   // ACT+ASSERT
            expect(acmeSchool.name).to.equal('Acme Public School');
            expect(acmeSchool.id).to.be.ok;
        });
        _it('can create object with an id specified', async () => {
            const acmeSchool = await dao.create(Company, <Company>{ id: 'xxx', name: 'Acme Public School - 1' });   // ACT+ASSERT
            expect(acmeSchool.id).to.equal('xxx');
        });
        _it('the model created will have its properties applied', async () => {
            const acmeSchool = await dao.create(Company, <Company>{ name: 'Acme Public School - 2' });   // ACT+ASSERT
            expect(acmeSchool.memberships).to.deep.equal([]);
        });
        _it('has an observable event for when objects are created$', async () => {
            await dao.create(Company, <any>{ name: 'Acme Public School 1' });                    // ARRANGE
            const { object: { name } } = await dao.created$.pipe(filter((c: any) => c?.object), take(1)).toPromise();                        // ACT+ASSERT
            expect(name).to.equal('Acme Public School 1');
        });
        _it('can get an object', async () => {
            const acmeSchool = await dao.create(Company, <any>{ name: 'Acme Public School 1' });   // ARRANGE
            const acmeSchool2: Company = await dao.get<Company>(Company, acmeSchool.id);                                                        // ACT
            expect(acmeSchool).to.be.ok;
            expect(acmeSchool2).to.be.ok;
            expect(acmeSchool).to.equal(acmeSchool2);                                                                                             // ASSERT
            expect(acmeSchool.name).to.equal('Acme Public School 1');                                                                               // ASSERT
        });
        _it('can update an object (DAO.update)', async () => {
            const company = await dao.create(Company, <any>{ name: 'Acme Public School 2' });    // ARRANGE
            await dao.update(Company, company.id, <any>{ name: 'Acme2' });                                                                  // ACT
            const { name } = await dao.get<Company>(Company, company.id);
            expect(name).to.equal('Acme2');
            expect(company.name).to.equal('Acme2');
        });
        _it('can update an object (Creator.update)', async () => {
            const company = await dao.create(Company, <Company>{ name: 'Acme Public School 3' });    // ARRANGE
            await company.update$({ name: 'Acme2' });                                                                  // ACT
            const { name } = await dao.get<Company>(Company, company.id);
            expect(name).to.equal('Acme2');
            expect(company.name).to.equal('Acme2');
        });
        _it('has an observable event for when objects are updated$', async () => {
            const company = await dao.create(Company, <Company>{ name: 'Acme Public School 4' });    // ARRANGE
            await dao.update(Company, company.id, { name: 'Acme2' });                                                                  // ARRAMHE
            const updated = await dao.updated$.pipe(filter((u: any) => u?.object?.name === 'Acme2'), take(1)).toPromise();   // ACT+ASSERT
            expect(updated).to.be.ok;
        })
        _it('deletes objects', async () => {
            {
                const company = await dao.create(Company, <Company>{ name: 'Acme Public School 5' });    // ARRANGE
                await dao.delete(Company, company.id);                                                                                     // ACT
                expect(await dao.get(Company, company.id)).to.not.be.ok;                                                                   // ASSERT                
            } {
                const company = await dao.create(Company, <Company>{ name: 'Acme Public School 6' });    // ARRANGE
                await company.delete();                                                                                                         // ACT
                expect(await dao.get(Company, company.id)).to.not.be.ok;                                                                   // ASSERT                
            }
        });
        _it('<event> object deletions', async () => {
            const company = await dao.create(Company, <Company>{ name: 'Acme Public School 7' });    // ARRANGE
            await dao.delete(Company, company.id);                                                                                     // ARRANGE
            expect(await dao.deleted$.pipe(filter((d: any) => d?.object === company), take(1)).toPromise()).to.be.ok                    // ASSERT
            expect(await company.deleted$.pipe(filter(v => !!v), take(1)).toPromise()).to.be.ok;                                            // ASSERT
        });
        _it('can reset the data in the model', async () => {
            await dao.reset();
            expect((await dao.allModels).length).to.equal(0);
        });
        _it('can synchronize data from online into memory', async () => {
            {   // OnlineAccount -> Local
                const local = new SampleDAO();
                const online = new SampleDAO();
                const onlineAccount = await online.create<Account>(Account, <Account>{ username: 'joe' });
                const syncOnlineAccount = async () => await local.synchronize(Account, onlineAccount.id, await online.get(Account, onlineAccount.id));
                expect((await local.allModels).length).to.equal(0, '0 models local');
                expect((await online.allModels).length).to.equal(1, '1 model online');
                await syncOnlineAccount();
                expect((await local.allModels).length).to.equal(1);
                expect((await online.allModels).length).to.equal(1);
                await onlineAccount.delete();
                await syncOnlineAccount();
                expect((await local.allModels).length).to.equal(0);
                expect((await online.allModels).length).to.equal(0);
            }
        });
    });
};
