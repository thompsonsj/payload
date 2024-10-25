import type { AggregateOptions, MongooseQueryOptions, PipelineStage, QueryOptions } from 'mongoose'
import type { Document, FindOne, PayloadRequest } from 'payload'

import type { MongooseAdapter } from './index.js'

import { buildAggregation } from './utilities/buildAggregation.js'
import { sanitizeInternalFields } from './utilities/sanitizeInternalFields.js'
import { withSession } from './withSession.js'

export const findOne: FindOne = async function findOne(
  this: MongooseAdapter,
  { collection, joins, locale, req = {} as PayloadRequest, where },
) {
  const Model = this.collections[collection]
  const collectionConfig = this.payload.collections[collection].config
  const options: QueryOptions = {
    ...(await withSession(this, req)),
    lean: true,
  }

  const pipeline: PipelineStage.Lookup[] = []
  const projection: Record<string, boolean> = {}

  const query = await Model.buildQuery({
    locale,
    payload: this.payload,
    pipeline,
    projection,
    session: options.session,
    where,
  })

  const aggregate = await buildAggregation({
    adapter: this,
    collection,
    collectionConfig,
    joins,
    limit: 1,
    locale,
    pipeline,
    projection,
    query,
  })

  let doc
  if (aggregate) {
    ;[doc] = await Model.aggregate(aggregate, options as AggregateOptions)
  } else {
    doc = await Model.findOne(query, {}, options)
  }

  if (!doc) {
    return null
  }

  let result: Document = JSON.parse(JSON.stringify(doc))

  // custom id type reset
  result.id = result._id
  result = sanitizeInternalFields(result)

  return result
}
