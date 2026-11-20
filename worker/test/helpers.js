export const kv = () => {
  const m = new Map();
  return { m, get: async k => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); }, delete: async k => { m.delete(k); } };
};

export let lastPublicKey;
export async function pkcs8Pem() {
  const { privateKey, publicKey } = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  lastPublicKey = publicKey;
  const b64 = Buffer.from(await crypto.subtle.exportKey('pkcs8', privateKey)).toString('base64');
  return `-----BEGIN PRIVATE KEY-----\n${b64.match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----`;
}

export const square = (x = 0, y = 0, s = 10) => ({ type: 'Polygon', coordinates: [[[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]]] });
export const fc = (props = {}, geometry = square()) => ({ type: 'FeatureCollection', properties: { taxonKey: 123, scientificName: 'Danaus plexippus', author: 'Ann', ...props }, features: [{ type: 'Feature', properties: {}, geometry }] });
