import type { JSONSchema4, JSONSchema4TypeName } from 'json-schema'

import pluralize from 'pluralize'
const { singular } = pluralize

import type { Auth } from '../auth/types.js'
import type { SanitizedCollectionConfig } from '../collections/config/types.js'
import type { SanitizedConfig } from '../config/types.js'
import type { Field, FieldAffectingData, Option } from '../fields/config/types.js'
import type { SanitizedGlobalConfig } from '../globals/config/types.js'
import type { JobsConfig } from '../queues/config/types.js'

import { MissingEditorProp } from '../errors/MissingEditorProp.js'
import { fieldAffectsData, tabHasName } from '../fields/config/types.js'
import { deepCopyObject } from './deepCopyObject.js'
import { toWords } from './formatLabels.js'
import { getCollectionIDFieldTypes } from './getCollectionIDFieldTypes.js'

const fieldIsRequired = (field: Field) => {
  const isConditional = Boolean(field?.admin && field?.admin?.condition)
  if (isConditional) {
    return false
  }

  const isMarkedRequired = 'required' in field && field.required === true
  if (fieldAffectsData(field) && isMarkedRequired) {
    return true
  }

  // if any subfields are required, this field is required
  if ('fields' in field && field.type !== 'array') {
    return field.fields.some((subField) => fieldIsRequired(subField))
  }

  // if any tab subfields have required fields, this field is required
  if (field.type === 'tabs') {
    return field.tabs.some((tab) => {
      if ('name' in tab) {
        return tab.fields.some((subField) => fieldIsRequired(subField))
      }
      return false
    })
  }

  return false
}

function buildOptionEnums(options: Option[]): string[] {
  return options.map((option) => {
    if (typeof option === 'object' && 'value' in option) {
      return option.value
    }

    return option
  })
}

function generateEntitySchemas(
  entities: (SanitizedCollectionConfig | SanitizedGlobalConfig)[],
): JSONSchema4 {
  const properties = [...entities].reduce((acc, { slug }) => {
    acc[slug] = {
      $ref: `#/definitions/${slug}`,
    }

    return acc
  }, {})

  return {
    type: 'object',
    additionalProperties: false,
    properties,
    required: Object.keys(properties),
  }
}

function generateLocaleEntitySchemas(localization: SanitizedConfig['localization']): JSONSchema4 {
  if (localization && 'locales' in localization && localization?.locales) {
    const localesFromConfig = localization?.locales

    const locales = [...localesFromConfig].map((locale) => {
      return locale.code
    }, [])

    return {
      type: 'string',
      enum: locales,
    }
  }

  return {
    type: 'null',
  }
}

function generateAuthEntitySchemas(entities: SanitizedCollectionConfig[]): JSONSchema4 {
  const properties: JSONSchema4[] = [...entities]
    .filter(({ auth }) => Boolean(auth))
    .map(({ slug }) => {
      return {
        allOf: [
          { $ref: `#/definitions/${slug}` },
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              collection: { type: 'string', enum: [slug] },
            },
            required: ['collection'],
          },
        ],
      }
    }, {})

  return {
    oneOf: properties,
  }
}

/**
 * Generates the JSON Schema for database configuration
 *
 * @example { db: idType: string }
 */
function generateDbEntitySchema(config: SanitizedConfig): JSONSchema4 {
  const defaultIDType: JSONSchema4 =
    config.db?.defaultIDType === 'number' ? { type: 'number' } : { type: 'string' }

  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      defaultIDType,
    },
    required: ['defaultIDType'],
  }
}

/**
 * Returns a JSON Schema Type with 'null' added if the field is not required.
 */
export function withNullableJSONSchemaType(
  fieldType: JSONSchema4TypeName,
  isRequired: boolean,
): JSONSchema4TypeName | JSONSchema4TypeName[] {
  const fieldTypes = [fieldType]
  if (isRequired) {
    return fieldType
  }
  fieldTypes.push('null')
  return fieldTypes
}

export function fieldsToJSONSchema(
  /**
   * Used for relationship fields, to determine whether to use a string or number type for the ID.
   * While there is a default ID field type set by the db adapter, they can differ on a collection-level
   * if they have custom ID fields.
   */
  collectionIDFieldTypes: { [key: string]: 'number' | 'string' },
  fields: Field[],
  /**
   * Allows you to define new top-level interfaces that can be re-used in the output schema.
   */
  interfaceNameDefinitions: Map<string, JSONSchema4>,
  config?: SanitizedConfig,
): {
  properties: {
    [k: string]: JSONSchema4
  }
  required: string[]
} {
  const requiredFieldNames = new Set<string>()

  return {
    properties: Object.fromEntries(
      fields.reduce((fieldSchemas, field) => {
        const isRequired = fieldAffectsData(field) && fieldIsRequired(field)
        if (isRequired) {
          requiredFieldNames.add(field.name)
        }

        let fieldSchema: JSONSchema4

        switch (field.type) {
          case 'text':
            if (field.hasMany === true) {
              fieldSchema = {
                type: withNullableJSONSchemaType('array', isRequired),
                items: { type: 'string' },
              }
            } else {
              fieldSchema = { type: withNullableJSONSchemaType('string', isRequired) }
            }
            break
          case 'textarea':
          case 'code':
          case 'email':
          case 'date': {
            fieldSchema = { type: withNullableJSONSchemaType('string', isRequired) }
            break
          }

          case 'number': {
            if (field.hasMany === true) {
              fieldSchema = {
                type: withNullableJSONSchemaType('array', isRequired),
                items: { type: 'number' },
              }
            } else {
              fieldSchema = { type: withNullableJSONSchemaType('number', isRequired) }
            }
            break
          }

          case 'checkbox': {
            fieldSchema = { type: withNullableJSONSchemaType('boolean', isRequired) }
            break
          }

          case 'json': {
            fieldSchema = field.jsonSchema?.schema || {
              type: ['object', 'array', 'string', 'number', 'boolean', 'null'],
            }
            break
          }

          case 'richText': {
            if (!field?.editor) {
              throw new MissingEditorProp(field) // while we allow disabling editor functionality, you should not have any richText fields defined if you do not have an editor
            }
            if (typeof field.editor === 'function') {
              throw new Error('Attempted to access unsanitized rich text editor.')
            }
            if (field.editor.outputSchema) {
              fieldSchema = field.editor.outputSchema({
                collectionIDFieldTypes,
                config,
                field,
                interfaceNameDefinitions,
                isRequired,
              })
            } else {
              // Maintain backwards compatibility with existing rich text editors
              fieldSchema = {
                type: withNullableJSONSchemaType('array', isRequired),
                items: {
                  type: 'object',
                },
              }
            }

            break
          }

          case 'radio': {
            fieldSchema = {
              type: withNullableJSONSchemaType('string', isRequired),
              enum: buildOptionEnums(field.options),
            }

            break
          }

          case 'select': {
            const optionEnums = buildOptionEnums(field.options)

            if (field.hasMany) {
              fieldSchema = {
                type: withNullableJSONSchemaType('array', isRequired),
                items: {
                  type: 'string',
                  enum: optionEnums,
                },
              }
            } else {
              fieldSchema = {
                type: withNullableJSONSchemaType('string', isRequired),
                enum: optionEnums,
              }
            }

            break
          }

          case 'point': {
            fieldSchema = {
              type: withNullableJSONSchemaType('array', isRequired),
              items: [
                {
                  type: 'number',
                },
                {
                  type: 'number',
                },
              ],
              maxItems: 2,
              minItems: 2,
            }
            break
          }

          case 'join': {
            fieldSchema = {
              type: withNullableJSONSchemaType('object', false),
              additionalProperties: false,
              properties: {
                docs: {
                  type: withNullableJSONSchemaType('array', false),
                  items: {
                    oneOf: [
                      {
                        type: collectionIDFieldTypes[field.collection],
                      },
                      {
                        $ref: `#/definitions/${field.collection}`,
                      },
                    ],
                  },
                },
                hasNextPage: { type: withNullableJSONSchemaType('boolean', false) },
              },
            }
            break
          }

          case 'upload':
          case 'relationship': {
            if (Array.isArray(field.relationTo)) {
              if (field.hasMany) {
                fieldSchema = {
                  type: withNullableJSONSchemaType('array', isRequired),
                  items: {
                    oneOf: field.relationTo.map((relation) => {
                      return {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                          relationTo: {
                            const: relation,
                          },
                          value: {
                            oneOf: [
                              {
                                type: collectionIDFieldTypes[relation],
                              },
                              {
                                $ref: `#/definitions/${relation}`,
                              },
                            ],
                          },
                        },
                        required: ['value', 'relationTo'],
                      }
                    }),
                  },
                }
              } else {
                fieldSchema = {
                  oneOf: field.relationTo.map((relation) => {
                    return {
                      type: withNullableJSONSchemaType('object', isRequired),
                      additionalProperties: false,
                      properties: {
                        relationTo: {
                          const: relation,
                        },
                        value: {
                          oneOf: [
                            {
                              type: collectionIDFieldTypes[relation],
                            },
                            {
                              $ref: `#/definitions/${relation}`,
                            },
                          ],
                        },
                      },
                      required: ['value', 'relationTo'],
                    }
                  }),
                }
              }
            } else if (field.hasMany) {
              fieldSchema = {
                type: withNullableJSONSchemaType('array', isRequired),
                items: {
                  oneOf: [
                    {
                      type: collectionIDFieldTypes[field.relationTo],
                    },
                    {
                      $ref: `#/definitions/${field.relationTo}`,
                    },
                  ],
                },
              }
            } else {
              fieldSchema = {
                oneOf: [
                  {
                    type: withNullableJSONSchemaType(
                      collectionIDFieldTypes[field.relationTo],
                      isRequired,
                    ),
                  },
                  {
                    $ref: `#/definitions/${field.relationTo}`,
                  },
                ],
              }
            }

            break
          }

          case 'blocks': {
            // Check for a case where no blocks are provided.
            // We need to generate an empty array for this case, note that JSON schema 4 doesn't support empty arrays
            // so the best we can get is `unknown[]`
            const hasBlocks = Boolean(field.blocks.length)

            fieldSchema = {
              type: withNullableJSONSchemaType('array', isRequired),
              items: hasBlocks
                ? {
                    oneOf: field.blocks.map((block) => {
                      const blockFieldSchemas = fieldsToJSONSchema(
                        collectionIDFieldTypes,
                        block.fields,
                        interfaceNameDefinitions,
                        config,
                      )

                      const blockSchema: JSONSchema4 = {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                          ...blockFieldSchemas.properties,
                          blockType: {
                            const: block.slug,
                          },
                        },
                        required: ['blockType', ...blockFieldSchemas.required],
                      }

                      if (block.interfaceName) {
                        interfaceNameDefinitions.set(block.interfaceName, blockSchema)

                        return {
                          $ref: `#/definitions/${block.interfaceName}`,
                        }
                      }

                      return blockSchema
                    }),
                  }
                : {},
            }
            break
          }

          case 'array': {
            fieldSchema = {
              type: withNullableJSONSchemaType('array', isRequired),
              items: {
                type: 'object',
                additionalProperties: false,
                ...fieldsToJSONSchema(
                  collectionIDFieldTypes,
                  field.fields,
                  interfaceNameDefinitions,
                  config,
                ),
              },
            }

            if (field.interfaceName) {
              interfaceNameDefinitions.set(field.interfaceName, fieldSchema)

              fieldSchema = {
                $ref: `#/definitions/${field.interfaceName}`,
              }
            }
            break
          }

          case 'row':
          case 'collapsible': {
            const childSchema = fieldsToJSONSchema(
              collectionIDFieldTypes,
              field.fields,
              interfaceNameDefinitions,
              config,
            )
            Object.entries(childSchema.properties).forEach(([propName, propSchema]) => {
              fieldSchemas.set(propName, propSchema)
            })
            childSchema.required.forEach((propName) => {
              requiredFieldNames.add(propName)
            })
            break
          }

          case 'tabs': {
            field.tabs.forEach((tab) => {
              const childSchema = fieldsToJSONSchema(
                collectionIDFieldTypes,
                tab.fields,
                interfaceNameDefinitions,
                config,
              )
              if (tabHasName(tab)) {
                // could have interface
                fieldSchemas.set(tab.name, {
                  type: 'object',
                  additionalProperties: false,
                  ...childSchema,
                })

                // If the named tab has any required fields then we mark this as required otherwise it should be optional
                const hasRequiredFields = tab.fields.some((subField) => fieldIsRequired(subField))

                if (hasRequiredFields) {
                  requiredFieldNames.add(tab.name)
                }
              } else {
                Object.entries(childSchema.properties).forEach(([propName, propSchema]) => {
                  fieldSchemas.set(propName, propSchema)
                })
                childSchema.required.forEach((propName) => {
                  requiredFieldNames.add(propName)
                })
              }
            })
            break
          }

          case 'group': {
            fieldSchema = {
              type: 'object',
              additionalProperties: false,
              ...fieldsToJSONSchema(
                collectionIDFieldTypes,
                field.fields,
                interfaceNameDefinitions,
                config,
              ),
            }

            if (field.interfaceName) {
              interfaceNameDefinitions.set(field.interfaceName, fieldSchema)

              fieldSchema = {
                $ref: `#/definitions/${field.interfaceName}`,
              }
            }
            break
          }

          default: {
            break
          }
        }

        if ('typescriptSchema' in field && field?.typescriptSchema?.length) {
          for (const schema of field.typescriptSchema) {
            fieldSchema = schema({ jsonSchema: fieldSchema })
          }
        }

        if (fieldSchema && fieldAffectsData(field)) {
          fieldSchemas.set(field.name, fieldSchema)
        }

        return fieldSchemas
      }, new Map<string, JSONSchema4>()),
    ),
    required: Array.from(requiredFieldNames),
  }
}

// This function is part of the public API and is exported through payload/utilities
export function entityToJSONSchema(
  config: SanitizedConfig,
  incomingEntity: SanitizedCollectionConfig | SanitizedGlobalConfig,
  interfaceNameDefinitions: Map<string, JSONSchema4>,
  defaultIDType: 'number' | 'text',
  collectionIDFieldTypes?: { [key: string]: 'number' | 'string' },
): JSONSchema4 {
  if (!collectionIDFieldTypes) {
    collectionIDFieldTypes = getCollectionIDFieldTypes({ config, defaultIDType })
  }
  const entity: SanitizedCollectionConfig | SanitizedGlobalConfig = deepCopyObject(incomingEntity)
  const title = entity.typescript?.interface
    ? entity.typescript.interface
    : singular(toWords(entity.slug, true))

  const idField: FieldAffectingData = { name: 'id', type: defaultIDType as 'text', required: true }
  const customIdField = entity.fields.find(
    (field) => fieldAffectsData(field) && field.name === 'id',
  ) as FieldAffectingData

  if (customIdField && customIdField.type !== 'group' && customIdField.type !== 'tab') {
    customIdField.required = true
  } else {
    entity.fields.unshift(idField)
  }

  // mark timestamp fields required
  if ('timestamps' in entity && entity.timestamps !== false) {
    entity.fields = entity.fields.map((field) => {
      if (fieldAffectsData(field) && (field.name === 'createdAt' || field.name === 'updatedAt')) {
        return {
          ...field,
          required: true,
        }
      }
      return field
    })
  }

  if ('auth' in entity && entity.auth && !entity.auth?.disableLocalStrategy) {
    entity.fields.push({
      name: 'password',
      type: 'text',
    })
  }

  return {
    type: 'object',
    additionalProperties: false,
    title,
    ...fieldsToJSONSchema(collectionIDFieldTypes, entity.fields, interfaceNameDefinitions, config),
  }
}

const fieldType: JSONSchema4 = {
  type: 'string',
  required: false,
}
const generateAuthFieldTypes = ({
  type,
  loginWithUsername,
}: {
  loginWithUsername: Auth['loginWithUsername']
  type: 'forgotOrUnlock' | 'login' | 'register'
}): JSONSchema4 => {
  if (loginWithUsername) {
    switch (type) {
      case 'login': {
        if (loginWithUsername.allowEmailLogin) {
          // allow username or email and require password for login
          return {
            additionalProperties: false,
            oneOf: [
              {
                additionalProperties: false,
                properties: { email: fieldType, password: fieldType },
                required: ['email', 'password'],
              },
              {
                additionalProperties: false,
                properties: { password: fieldType, username: fieldType },
                required: ['username', 'password'],
              },
            ],
          }
        } else {
          // allow only username and password for login
          return {
            additionalProperties: false,
            properties: {
              password: fieldType,
              username: fieldType,
            },
            required: ['username', 'password'],
          }
        }
      }

      case 'register': {
        const requiredFields: ('email' | 'password' | 'username')[] = ['password']
        const properties: {
          email?: JSONSchema4['properties']
          password?: JSONSchema4['properties']
          username?: JSONSchema4['properties']
        } = {
          password: fieldType,
          username: fieldType,
        }

        if (loginWithUsername.requireEmail) {
          requiredFields.push('email')
        }
        if (loginWithUsername.requireUsername) {
          requiredFields.push('username')
        }
        if (loginWithUsername.requireEmail || loginWithUsername.allowEmailLogin) {
          properties.email = fieldType
        }

        return {
          additionalProperties: false,
          properties,
          required: requiredFields,
        }
      }

      case 'forgotOrUnlock': {
        if (loginWithUsername.allowEmailLogin) {
          // allow email or username for unlock/forgot-password
          return {
            additionalProperties: false,
            oneOf: [
              {
                additionalProperties: false,
                properties: { email: fieldType },
                required: ['email'],
              },
              {
                additionalProperties: false,
                properties: { username: fieldType },
                required: ['username'],
              },
            ],
          }
        } else {
          // allow only username for unlock/forgot-password
          return {
            additionalProperties: false,
            properties: { username: fieldType },
            required: ['username'],
          }
        }
      }
    }
  }

  // default email (and password for login/register)
  return {
    additionalProperties: false,
    properties: { email: fieldType, password: fieldType },
    required: ['email', 'password'],
  }
}

export function authCollectionToOperationsJSONSchema(
  config: SanitizedCollectionConfig,
): JSONSchema4 {
  const loginWithUsername = config.auth?.loginWithUsername
  const loginUserFields: JSONSchema4 = generateAuthFieldTypes({ type: 'login', loginWithUsername })
  const forgotOrUnlockUserFields: JSONSchema4 = generateAuthFieldTypes({
    type: 'forgotOrUnlock',
    loginWithUsername,
  })
  const registerUserFields: JSONSchema4 = generateAuthFieldTypes({
    type: 'register',
    loginWithUsername,
  })

  const properties: JSONSchema4['properties'] = {
    forgotPassword: forgotOrUnlockUserFields,
    login: loginUserFields,
    registerFirstUser: registerUserFields,
    unlock: forgotOrUnlockUserFields,
  }

  return {
    type: 'object',
    additionalProperties: false,
    properties,
    required: Object.keys(properties),
    title: `${singular(toWords(`${config.slug}`, true))}AuthOperations`,
  }
}

function generateAuthOperationSchemas(collections: SanitizedCollectionConfig[]): JSONSchema4 {
  const properties = collections.reduce((acc, collection) => {
    if (collection.auth) {
      acc[collection.slug] = {
        $ref: `#/definitions/auth/${collection.slug}`,
      }
    }
    return acc
  }, {})

  return {
    type: 'object',
    additionalProperties: false,
    properties,
    required: Object.keys(properties),
  }
}

function generateJobsSchemas(
  config: SanitizedConfig,
  jobsConfig: JobsConfig,
  interfaceNameDefinitions: Map<string, JSONSchema4>,
  /**
   * Used for relationship fields, to determine whether to use a string or number type for the ID.
   * While there is a default ID field type set by the db adapter, they can differ on a collection-level
   * if they have custom ID fields.
   */
  collectionIDFieldTypes: { [key: string]: 'number' | 'string' },
): {
  definitions?: Map<string, JSONSchema4>
  properties?: { tasks: JSONSchema4 }
} {
  const properties: { tasks: JSONSchema4; workflows: JSONSchema4 } = {
    tasks: {},
    workflows: {},
  }
  const definitions: Map<string, JSONSchema4> = new Map()

  if (jobsConfig?.tasks?.length) {
    for (const task of jobsConfig.tasks) {
      if (task?.inputSchema?.length) {
        const inputJsonSchema = fieldsToJSONSchema(
          collectionIDFieldTypes,
          task.inputSchema,
          interfaceNameDefinitions,
          config,
        )

        const fullInputJsonSchema: JSONSchema4 = {
          type: 'object',
          additionalProperties: false,
          properties: inputJsonSchema.properties,
          required: inputJsonSchema.required,
        }

        definitions.set(`Task${task.slug}Input`, fullInputJsonSchema)
      }
      if (task?.outputSchema?.length) {
        const outputJsonSchema = fieldsToJSONSchema(
          collectionIDFieldTypes,
          task.outputSchema,
          interfaceNameDefinitions,
          config,
        )

        const fullOutputJsonSchema: JSONSchema4 = {
          type: 'object',
          additionalProperties: false,
          properties: outputJsonSchema.properties,
          required: outputJsonSchema.required,
        }

        definitions.set(`Task${task.slug}Output`, fullOutputJsonSchema)
      }
    }
    // Now add properties.tasks definition that references the types in definitions keyed by task slug:
    properties.tasks = {
      type: 'object',
      additionalProperties: false,
      properties: Object.fromEntries(
        jobsConfig.tasks.map((task) => {
          const toReturn: JSONSchema4 = {
            type: 'object',
            additionalProperties: false,
            properties: {
              input: {},
            },
            required: ['input', 'output'],
          }

          if (task.inputSchema?.length) {
            ;(toReturn.required as string[]).push('input')
            toReturn.properties.input = {
              $ref: `#/definitions/Task${task.slug}Input`,
            }
          }
          if (task.outputSchema?.length) {
            ;(toReturn.required as string[]).push('output')
            toReturn.properties.output = {
              $ref: `#/definitions/Task${task.slug}Output`,
            }
          }
          return [task.slug, toReturn]
        }),
      ),
      required: jobsConfig.tasks.map((task) => task.slug),
    }
  }

  if (jobsConfig?.workflows?.length) {
    for (const workflow of jobsConfig.workflows) {
      if (workflow?.inputSchema?.length) {
        const inputJsonSchema = fieldsToJSONSchema(
          collectionIDFieldTypes,
          workflow.inputSchema,
          interfaceNameDefinitions,
          config,
        )

        const fullInputJsonSchema: JSONSchema4 = {
          type: 'object',
          additionalProperties: false,
          properties: inputJsonSchema.properties,
          required: inputJsonSchema.required,
        }

        definitions.set(`Workflow${workflow.slug}Input`, fullInputJsonSchema)
      }

      properties.workflows = {
        type: 'object',
        additionalProperties: false,
        properties: Object.fromEntries(
          jobsConfig.workflows.map((workflow) => {
            const toReturn: JSONSchema4 = {
              type: 'object',
              additionalProperties: false,
              properties: {
                input: {},
              },
              required: ['input'],
            }

            if (workflow.inputSchema?.length) {
              ;(toReturn.required as string[]).push('input')
              toReturn.properties.input = {
                $ref: `#/definitions/Workflow${workflow.slug}Input`,
              }
            }

            return [workflow.slug, toReturn]
          }),
        ),
        required: jobsConfig.tasks.map((task) => task.slug),
      }
    }
  }

  return {
    definitions,
    properties,
  }
}

/**
 * This is used for generating the TypeScript types (payload-types.ts) with the payload generate:types command.
 */
export function configToJSONSchema(
  config: SanitizedConfig,
  defaultIDType?: 'number' | 'text',
): JSONSchema4 {
  // a mutable Map to store custom top-level `interfaceName` types. Fields with an `interfaceName` property will be moved to the top-level definitions here
  const interfaceNameDefinitions: Map<string, JSONSchema4> = new Map()

  //  Used for relationship fields, to determine whether to use a string or number type for the ID.
  const collectionIDFieldTypes = getCollectionIDFieldTypes({ config, defaultIDType })

  // Collections and Globals have to be moved to the top-level definitions as well. Reason: The top-level type will be the `Config` type - we don't want all collection and global
  // types to be inlined inside the `Config` type
  const entityDefinitions: { [k: string]: JSONSchema4 } = [
    ...config.globals,
    ...config.collections,
  ].reduce((acc, entity) => {
    acc[entity.slug] = entityToJSONSchema(
      config,
      entity,
      interfaceNameDefinitions,
      defaultIDType,
      collectionIDFieldTypes,
    )
    return acc
  }, {})

  const authOperationDefinitions = [...config.collections]
    .filter(({ auth }) => Boolean(auth))
    .reduce(
      (acc, authCollection) => {
        acc.auth[authCollection.slug] = authCollectionToOperationsJSONSchema(authCollection)
        return acc
      },
      { auth: {} },
    )

  const jobsSchemas = config.jobs
    ? generateJobsSchemas(config, config.jobs, interfaceNameDefinitions, collectionIDFieldTypes)
    : {}

  let jsonSchema: JSONSchema4 = {
    additionalProperties: false,
    definitions: {
      ...entityDefinitions,
      ...Object.fromEntries(interfaceNameDefinitions),
      ...authOperationDefinitions,
    },
    // These properties here will be very simple, as all the complexity is in the definitions. These are just the properties for the top-level `Config` type
    type: 'object',
    properties: {
      auth: generateAuthOperationSchemas(config.collections),
      collections: generateEntitySchemas(config.collections || []),
      db: generateDbEntitySchema(config),
      globals: generateEntitySchemas(config.globals || []),
      locale: generateLocaleEntitySchemas(config.localization),
      user: generateAuthEntitySchemas(config.collections),
    },
    required: ['user', 'locale', 'collections', 'globals', 'auth', 'db'],
    title: 'Config',
  }
  if (jobsSchemas.definitions?.size) {
    for (const [key, value] of jobsSchemas.definitions) {
      jsonSchema.definitions[key] = value
    }
  }
  if (jobsSchemas.properties) {
    jsonSchema.properties.jobs = {
      type: 'object',
      additionalProperties: false,
      properties: jobsSchemas.properties,
      required: ['tasks'],
    }
  }

  if (config?.typescript?.schema?.length) {
    for (const schema of config.typescript.schema) {
      jsonSchema = schema({ jsonSchema })
    }
  }

  return jsonSchema
}
