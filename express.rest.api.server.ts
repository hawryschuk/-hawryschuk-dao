// tslint:disable-next-line:no-implicit-dependencies
import * as express from 'express';
import * as jwt from 'jwt-simple';
import { DAO } from './DAO';
import { Model } from './model';
export class ExpressRestApiServer {
  constructor(public dao: DAO) { }
  JWT_KEY = 'keep it simple';
  encode = (data: any) => jwt.encode(data, this.JWT_KEY);
  decode = (token: string) => jwt.decode(token, this.JWT_KEY);
  app = express()
    .use(require('cors')({ origin: true }))
    .use(require('body-parser').json())
    .use((req, res, next) => {
      res.append('x-redaction-restapi-version', '1.0.0');
      next();
    })

    .delete('/', async (req, res) => {
      await this.dao.reset();
      res.send({ reset: new Date })
    })

    .get('/data', async (req, res) => {
      const models = await this.dao.allModels;
      res.send(models.reduce((data, model) => {
        const col = data[model.constructor.name] = data[model.constructor.name] || {};
        col[model.id] = model.POJO();
        return data;
      }, {}));
    })

    .put('/:collection/:id', async ({ body, params: { collection, id } }, res) => {
      const klass = this.dao.models[collection];
      const object = klass && await this.dao.get<Model>(klass, id);
      object && await this.dao.update(klass, id, body);
      res.status(object ? 200 : 404);
      res.send(object && object.POJO());
    })

    .delete('/:collection/:id', async ({ body, params: { collection, id } }, res) => {
      const klass = this.dao.models[collection];
      const object: any = await this.dao.get(klass, id);
      object && await this.dao.delete(klass, id);
      res.status(object ? 200 : 404);
      res.send(object && object.POJO());
    })

    .get('/:collection/:id', async ({ headers: { authorization }, body, params: { collection, id } }, res) => {
      // this.decode(authorization);
      const klass = this.dao.models[collection];
      const object = await this.dao.get<Model>(klass, id);
      res.status(object ? 200 : 404);
      res.send(object && object.POJO && object.POJO());
    })

    .post('/:collection', async (req, res) => {
      const { body, params: { collection } } = req;
      const { id } = (body || {}) as any;
      const klass = this.dao.models[collection];
      const existing = id && await this.dao.get<Model>(klass, id);
      const object = existing || await this.dao.create(klass, body);
      existing && await existing.update$(body);
      res.status(object ? 200 : 404)
      res.send(object && object.POJO && object.POJO());
    })

    .get('/:collection', async ({ body, params: { collection } }, res) => {
      const klass = this.dao.models[collection];
      const objects: any[] = klass && Object.values(await this.dao.get(klass));
      res.status(objects ? 200 : 404);
      res.send(objects && objects.map(o => o.POJO()));
    })
}
