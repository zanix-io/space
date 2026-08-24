import { assertEquals, assertRejects } from '@std/assert'
import { classValidation } from '@zanix/validator'
import { HttpError } from '@zanix/errors'
import {
  AssetIdParamsRTO,
  VideoUploadQueryRTO,
  VoiceUploadQueryRTO,
} from 'modules/assets-api/controllers/rtos/assets.rto.ts'

const REAL_ASSET_ID = '3fa85f64-5717-4562-b3fc-2c963f66afa6'

/**
 * These RTOs are otherwise only ever populated by `@zanix/server`'s own real request pipeline
 * (`@Search`/`@Params`), exercised end to end by the ffmpeg-backed functional suites — none of
 * which happen to send every field on every route (e.g. no functional test sends `?format=` on
 * `/assets/video`, since the whole point of that suite is proving the real, working DEFAULT).
 * `classValidation` is `@zanix/validator`'s own public, standalone entry point for turning a plain
 * object into a validated RTO instance — the same mechanism the real pipeline uses internally — so
 * this closes the remaining field combinations without booting a server.
 */

Deno.test('AssetIdParamsRTO: a real UUID id is validated and exposed', async () => {
  const rto = await classValidation(AssetIdParamsRTO, { id: REAL_ASSET_ID })
  assertEquals(rto.id, REAL_ASSET_ID)
})

Deno.test('AssetIdParamsRTO: a non-UUID id is rejected — id is always a real UUID', async () => {
  // Includes a path-traversal-shaped id: since `id` is never anything but a real UUID
  // (`AssetService` mints it via `generateUUID()`), rejecting non-UUID shapes here also closes
  // off `../`/absolute-path payloads at the API boundary, before `AssetStorage` is ever reached.
  await assertRejects(() => classValidation(AssetIdParamsRTO, { id: 'abc123' }), HttpError)
  await assertRejects(
    () => classValidation(AssetIdParamsRTO, { id: '../../etc/passwd' }),
    HttpError,
  )
})

Deno.test('VoiceUploadQueryRTO: format is validated and exposed', async () => {
  const rto = await classValidation(VoiceUploadQueryRTO, { format: 'aac' })
  assertEquals(rto.format, 'aac')
})

Deno.test(
  'VideoUploadQueryRTO: both breakpoint and format are validated and exposed when the caller ' +
    'sends them — the real query-string case no functional suite happens to exercise (those ' +
    'prove the working DEFAULT, i.e. omitting both)',
  async () => {
    const rto = await classValidation(VideoUploadQueryRTO, {
      breakpoint: 'dlg',
      format: 'webm',
    })
    assertEquals(rto.breakpoint, 'dlg')
    assertEquals(rto.format, 'webm')
  },
)

Deno.test(
  'VideoUploadQueryRTO: both fields are genuinely optional — omitting them validates cleanly',
  async () => {
    const rto = await classValidation(VideoUploadQueryRTO, {})
    assertEquals(rto.breakpoint, undefined)
    assertEquals(rto.format, undefined)
  },
)
