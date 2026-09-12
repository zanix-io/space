import { BaseRTO, IsBooleanString, IsEnum, IsUUID } from '@zanix/validator'

/** Route params for `GET /assets/:id`, `/:id/status`, `/:id/download`. `id` is always a real
 * `generateUUID()` value minted server-side (`AssetService`) — `@IsUUID` rejects anything else at
 * the API boundary before it can reach `AssetStorage`'s own `key`, including a path-traversal
 * payload (`../`, an absolute path) that isn't a UUID either. Defense in depth alongside — not a
 * replacement for — `confinePath`'s own containment check in each `AssetStorage` adapter. */
export class AssetIdParamsRTO extends BaseRTO {
  @IsUUID({ expose: true })
  accessor id!: string
}

/** Query validation for `POST /assets/audio` — the body itself is the raw upload stream, never
 * RTO-validated (see `../../upload.ts`'s own doc). `bitrateKbps` is deliberately not exposed here
 * yet — a real query-string-to-number coercion policy hasn't been decided; the voice profile's own
 * `VOICE_DEFAULT_BITRATE_KBPS` applies until it is. */
export class VoiceUploadQueryRTO extends BaseRTO {
  @IsEnum(['aac', 'opus'], { expose: true })
  accessor format!: 'aac' | 'opus'
}

/** Query validation for `POST /assets/video` — all optional, same reasoning `VoiceUploadQueryRTO`
 * gives: everything else `AssetTransformRequest`'s `'video'` member could carry
 * (`width`/`bitrateKbps`/`outputPath`) stays `AssetService`'s own transform-time decision, never an
 * HTTP-caller-facing knob. `breakpoint` defaults to `'mlg'` when omitted — see
 * `asset-service.ts`'s own `runVideoTransformation`. `thumbnail` stays a plain query STRING
 * (`'true'`/`'false'`), never coerced to a real `boolean` here — `IsBooleanString` only validates
 * the shape; the controller reads it as `search.thumbnail === 'true'` when building
 * `AssetTransformRequest`. */
export class VideoUploadQueryRTO extends BaseRTO {
  @IsEnum(['msm', 'mlg', 'dmd', 'dlg'], { expose: true, optional: true })
  accessor breakpoint: 'msm' | 'mlg' | 'dmd' | 'dlg' | undefined

  @IsEnum(['mp4', 'webm'], { expose: true, optional: true })
  accessor format: 'mp4' | 'webm' | undefined

  @IsBooleanString({ expose: true, optional: true })
  accessor thumbnail: string | undefined
}
