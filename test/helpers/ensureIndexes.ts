import type { Payload } from 'payload'

export const ensureIndexes = async (payload: Payload) => {
  if (payload.db.name === 'mongoose') {
    await Promise.all(
      payload.config.collections.map(async (coll) => {
        await payload.db?.collections[coll.slug]?.ensureIndexes()
      }),
    )
  }
}
