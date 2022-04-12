import { Model } from './model';
import { DAO } from './DAO';
import { Util } from '@hawryschuk/common';
const { default: axios } = require('axios');

export class RestApiDAO extends DAO {
  constructor(models: any, public baseURL: string) { super(models); }

  httpClient = async ({
    method = 'get' as 'get' | 'post' | 'put' | 'delete',
    url = '',
    data = undefined as any,
    baseURL = this.baseURL,
    headers = {} as any,
  }): Promise<{ data: any; status: number; headers: any; error: any }> => {
    const { status, error, data: d2, headers: h2 } =
      await axios({ method, url, data, baseURL, headers })
        .catch(error2 => {
          if (!(error2 && error2.response && error2.response.headers)) {
            console.error(new Error(error2).stack)
            console.error(error2);
            throw new Error('RestAPIDAO: no error-http-response-headers');
          }
          const { response: { headers, data: d3, statusText, status } } = error2;
          const error = d3 && d3.error || statusText || status;
          return { status, error, data, headers };
        });
    return { status, error, data: d2, headers: h2 };
  };
  async create<M extends Model>(klass: any, data: M): Promise<M> {
    klass = this.klassToKlass(klass);
    const object = await super.create(klass, data);
    await this.httpClient({ method: 'post', url: `${klass.name}`, data: object.POJO() });
    return object;
  }
  async delete(klass: any, id: string, fromObject?: boolean) {
    klass = this.klassToKlass(klass);
    const object = await super.delete(klass, id, fromObject, true);
    await this.httpClient({ method: 'delete', url: `${klass.name}/${id}` });
    return object;
  }
  async update<M extends Model>(klass: any, id: string, data: M): Promise<M> {
    klass = this.klassToKlass(klass);
    const object: M = await super.update(klass, id, data);
    await this.httpClient({ method: 'put', url: `${klass.name}/${id}`, data });
    return object;
  }
  async getOnline(klass: any, id = '') {
    klass = this.klassToKlass(klass);
    await super.getOnline(klass, id);
    const doc2obj = async (doc: any): Promise<Model> => {
      const obj: Model = doc && new klass({ ...doc });
      obj && await obj.ready$;
      return obj;
    };
    return id
      ? await this
        .httpClient({ method: 'get', url: `${klass.name}/${id}` })
        .then(({ data }) => data && doc2obj(data))
        .catch(error => {
          if (error.status === 404) {
            return null;
          } else {
            console.error(error);
            console.error(new Error(error).stack);
            throw new Error(error);
          }
        })
      : await this.httpClient({ method: 'get', url: `${klass.name}` })
        .then(async ({ data: documents }) => documents
          ? await Promise.all((documents as any[]).map(doc2obj))
          : [] as any[]
        )
        .then(docs => docs.reduce((docs, doc) => ({ ...docs, [doc.id]: doc }), {}));
  }
}
