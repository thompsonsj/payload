import type { Payload } from 'payload'

import path from 'path'
import { fileURLToPath } from 'url'

import { initPayloadInt } from '../helpers/initPayloadInt.js'

let payload: Payload

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

describe('@payloadcms/plugin-cloud', () => {
  beforeAll(async () => {
    ;({ payload } = await initPayloadInt(dirname))
  })

  afterAll(async () => {
    if (typeof payload.db.destroy === 'function') {
      await payload.db.destroy()
    }
  })

  describe('tests', () => {
    it('should initialize payload without error', async () => {
      // test logic insignificant - only checking payload starts
      // remove when payload-cloud tests are added
      const user = await payload.create({
        collection: 'users',
        data: {
          email: 'user@payloadcms.com',
          password: 'password',
        },
      })
      expect(user.email).toEqual('user@payloadcms.com')
    })
  })
})
