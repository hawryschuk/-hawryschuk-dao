import { testDAO, SampleDAO } from './DAO.spec.exports';
import { RestApiDAO } from './rest.api.dao';
import { Model } from './model';

testDAO({
    title: `REST API DAO`,
    dao: new RestApiDAO(SampleDAO.models, 'http://localhost:8001')
});
