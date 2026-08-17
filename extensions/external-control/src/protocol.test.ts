/**
 * `public/external-control/client.js` repeats the protocol constants instead of
 * importing them, because it has to run as a plain <script> in a host that
 * knows nothing about this build. That duplication is fine as long as it cannot
 * drift silently — which is what this file is for.
 */

import fs from 'fs';
import path from 'path';

import { Actions, CHANNEL, MessageTypes, PROTOCOL_VERSION } from './protocol';

const client = require('../public/external-control/client.js');
const clientSource = fs.readFileSync(
  path.join(__dirname, '../public/external-control/client.js'),
  'utf8'
);

describe('el cliente no se desincroniza del protocolo', () => {
  it('usa el mismo nombre de canal', () => {
    expect(client.CHANNEL).toBe(CHANNEL);
  });

  it('declara la misma versión', () => {
    expect(client.PROTOCOL_VERSION).toBe(PROTOCOL_VERSION);
  });

  it.each(Object.values(Actions))('conoce la acción %s', action => {
    expect(clientSource).toContain(`'${action}'`);
  });

  it.each(Object.values(MessageTypes))('reconoce el mensaje %s', type => {
    expect(clientSource).toContain(`'${type}'`);
  });
});
