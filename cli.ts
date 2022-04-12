#!/usr/bin/env ts-node

import { ExpressRestApiServer } from './express.rest.api.server';
import { SampleDAO } from './DAO.spec.exports';

const { argv: { server, type, port = 8001 } } = require('yargs');
const apiServer = server && (
    (type === 'memory' && new ExpressRestApiServer(new SampleDAO))
    // || (type === 'firestore' && new ExpressRestApiServer(new FirestoreBusinessModel(require('firebase-admin')) as BusinessModel))
    // || (type === 'rest' && new ExpressRestApiServer(new RestApiBusinessModel()))
);
if (!apiServer) {
    console.error('Missing arguments for server and type');
} else {
    console.info(`REST API SERVER USING A BUSINESS MODEL PERSISTED IN ${type} LISTENING ON PORT: ${port}`);
    apiServer.app.listen(port);
}
