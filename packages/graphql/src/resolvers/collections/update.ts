import { updateByIDOperation } from 'payload/operations'
import type { GeneratedTypes } from 'payload'
import type { PayloadRequest } from 'payload/types'
import type { Collection } from 'payload/types'

import { isolateObjectProperty } from 'payload/utilities'
import type { Context } from '../types.d.ts'

export type Resolver<TSlug extends keyof GeneratedTypes['collections']> = (
  _: unknown,
  args: {
    autosave: boolean
    data: GeneratedTypes['collections'][TSlug]
    draft: boolean
    id: number | string
    locale?: string
  },
  context: {
    req: PayloadRequest
  },
) => Promise<GeneratedTypes['collections'][TSlug]>

export default function updateResolver<TSlug extends keyof GeneratedTypes['collections']>(
  collection: Collection,
): Resolver<TSlug> {
  async function resolver(_, args, context: Context) {
    let { req } = context
    const locale = req.locale
    const fallbackLocale = req.fallbackLocale
    req = isolateObjectProperty(req, 'locale')
    req = isolateObjectProperty(req, 'fallbackLocale')
    req.locale = args.locale || locale
    req.fallbackLocale = args.fallbackLocale || fallbackLocale

    const options = {
      id: args.id,
      autosave: args.autosave,
      collection,
      data: args.data,
      depth: 0,
      draft: args.draft,
      req: isolateObjectProperty(req, 'transactionID'),
    }

    const result = await updateByIDOperation<TSlug>(options)

    return result
  }

  return resolver
}
