// Prints a fresh VAPID key pair for Web Push. Run it once, set both values with
// `npx wrangler secret put`, and never commit or share the private key.
import { generateKeyPairSync } from 'node:crypto'

const { publicKey, privateKey } = generateKeyPairSync('ec', {
  namedCurve: 'P-256',
})
const publicRaw = publicKey
  .export({ format: 'der', type: 'spki' })
  .subarray(-65)

console.log('VAPID_PUBLIC_KEY=' + publicRaw.toString('base64url'))
console.log('VAPID_PRIVATE_KEY=' + privateKey.export({ format: 'jwk' }).d)
