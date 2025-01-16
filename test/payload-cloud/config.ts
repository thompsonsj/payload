import { fileURLToPath } from 'node:url'
const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)
import type { TaskConfig } from 'payload'

import { payloadCloudPlugin } from '@payloadcms/payload-cloud'
import dotenv from 'dotenv'
import path from 'path'

import { buildConfigWithDefaults } from '../buildConfigWithDefaults.js'
import { devUser } from '../credentials.js'
import { Media } from './collections/Media.js'
import { Users } from './collections/Users.js'

// NOTE: may need to create .env file for testing
dotenv.config({
  path: path.resolve(process.cwd(), './test/plugin-cloud/.env'),
})

export default buildConfigWithDefaults({
  admin: {
    importMap: {
      baseDir: path.resolve(dirname),
    },
  },
  collections: [Media, Users],
  jobs: {
    tasks: [
      {
        // Configure this task to automatically retry
        // up to two times
        retries: 2,

        // This is a unique identifier for the task

        slug: 'createMedia',

        // These are the arguments that your Task will accept
        inputSchema: [
          {
            name: 'title',
            type: 'text',
            required: true,
          },
        ],

        // These are the properties that the function should output
        outputSchema: [
          {
            name: 'postID',
            type: 'text',
            required: true,
          },
        ],

        // This is the function that is run when the task is invoked
        handler: async ({ input, req }) => {
          const newPost = await req.payload.create({
            collection: 'media',
            req,
            data: {
              alt: input.title || ``,
            },
          })
          return {
            output: {
              postID: newPost.id,
            },
          }
        },
      } as TaskConfig<'createMedia'>,
    ],
  },
  onInit: async (payload) => {
    await payload.create({
      collection: 'users',
      data: {
        email: devUser.email,
        password: devUser.password,
      },
    })
  },
  plugins: [payloadCloudPlugin()],
  serverURL: process.env.PAYLOAD_PUBLIC_SERVER_URL,
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
})
