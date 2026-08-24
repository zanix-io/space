## Assets HTTP API — upload, transform, download

This is the full reference for `@zanix/space/assets-api`, the HTTP upload/transform/download API for
user-submitted assets (voice recordings, images, video). **This is a different subsystem from
[`docs/assets.md`](./assets.md)** — that guide covers `assetsDir`/`assetsPlugin`/`mediaPlugin`, the
build-time pipeline for an app's own static files (logos, icons, bundled media). Use this guide
instead when you need a real HTTP endpoint that accepts an upload FROM a client at request time,
runs a real transform (voice transcode, image optimize, video transcode) against it, and persists
the result. The two never share code or a route prefix; nothing in either subsystem imports the
other.

### Layering and composition

```
HTTP (ZanixController) -> AssetService -> {AssetTransformer, AssetStorage, AssetRepository, JobDispatcher}
```

`AssetService` (`createAssetService`) is the one place that composes everything into real behavior:
it drains an upload, enforces the configured size cap, persists the original bytes and its metadata,
dispatches the transform, and answers `getAsset`/`downloadVariant` queries afterward.
`createAssetsController` is a thin `ZanixController` HTTP adapter over an already-built
`AssetService` — it never talks to storage, ffmpeg, or sharp directly.

```ts
import {
  createAssetsController,
  createAssetService,
  createInMemoryAssetRepository,
  createLocalFilesystemAssetStorage,
} from '@zanix/space/assets-api'
import { ProgramModule } from '@zanix/server'

const service = createAssetService({
  storage: createLocalFilesystemAssetStorage('./var/assets'),
  repository: createInMemoryAssetRepository(),
})

await ProgramModule.defineApplication('my-app', () => {
  createAssetsController({
    prefix: 'assets',
    service,
    guards: { write: [/* your real guard */], read: [/* your real guard */] },
  })
})
```

`createAssetService`'s other options — `transformer` (default: `createAssetTransformer()` with no
cache), `jobs` (default: `createInlineJobDispatcher(...)`, which runs the whole transform chain
synchronously within the request), and `limits` (see below) — are all optional; only `storage` and
`repository` are required.

#### Guards are deny-by-default — you must supply real ones

`createAssetsController`'s `guards.write`/`guards.read` each default to `[denyAllGuard]` whenever
omitted or passed as an empty list — never to "no guard at all." `denyAllGuard` always responds
`403 FORBIDDEN`. This isn't an oversight: `POST /assets/audio` and `POST /assets/video` spawn a real
`ffmpeg` process, so an unguarded route would let anyone consume CPU/disk on demand. A real
integrator passes a real guard built from, e.g., `@zanix/auth`'s `AuthTokenValidation` — the same
mechanism this ecosystem's Templates/Triggers admin APIs already use. `guards.write` gates every
`POST` route; `guards.read` gates every `GET` route; they're independent, so read-only public access
without write access is a normal configuration.

### Upload contract

There's no multipart support in this API — one file per request, and the entire request body IS the
file. `readUploadedAssetFromRequest(req)` reads the body directly off the untouched `Request` as a
live `ReadableStream<Uint8Array>` (never `await request.arrayBuffer()`, so the bytes are never
buffered before `AssetService` gets to enforce its own size cap):

```ts
export interface UploadedAsset {
  stream: ReadableStream<Uint8Array>
  contentType: string // from the request's own Content-Type header
  filename?: string // from the X-Znx-Asset-Filename header, when the client sent one
  size?: number // only set when the client sent a real Content-Length — never assumed/computed
}
```

It throws `HttpError('BAD_REQUEST')` when the request has no body, or no `Content-Type` header.

The three write routes:

- `POST /assets/audio?format=aac|opus` — uploads a `.wav` (`Content-Type: audio/wav` required) and
  transcodes it via the voice profile.
- `POST /assets/image` — uploads a jpeg/png/webp and optimizes it in place.
- `POST /assets/video?breakpoint=msm|mlg|dmd|dlg&format=mp4|webm` — uploads an mp4/webm and
  transcodes it at `breakpoint` (both query params optional; `breakpoint` defaults to `'mlg'`).

Every write route returns the full, freshly-created `AssetRecord` (see below) as its JSON response —
by the time it responds, `status` already reflects the outcome (`'completed'` or `'failed'`; the
default `InlineJobDispatcher` runs the whole chain synchronously within the one request).

### Size limits and content verification

`AssetServiceOptions.limits` (all optional, `Required<AssetLimits>` internally) caps upload size per
kind — operator-configured at `createAssetService()` construction time, never something the HTTP
caller can raise or bypass:

```ts
export const DEFAULT_ASSET_LIMITS = {
  image: 25 * 1024 * 1024, // 25MB
  audio: 50 * 1024 * 1024, // 50MB
  video: 200 * 1024 * 1024, // 200MB
}
```

Enforced in two layers, both real, neither alone sufficient: a fast reject against
`UploadedAsset.size` (the `Content-Length` header) when the client sent one — cheap, but
`Content-Length` is optional and client-controlled — followed by the real enforcement against bytes
actually read while buffering, which is what protects memory when `Content-Length` is absent
(chunked transfer-encoding) or understated. **Both layers reject synchronously, before any
`AssetRecord` is created** — the client gets a real `413 PAYLOAD_TOO_LARGE` HTTP response directly
from the `POST`, not a `200` with a later `'failed'` status.

```ts
createAssetService({
  storage,
  repository,
  limits: { image: 5 * 1024 * 1024 }, // override only the image cap; audio/video keep the defaults
})
```

Separately, `runImageTransformation` verifies that uploaded bytes for `kind: 'image'` actually START
WITH their declared `Content-Type`'s real file signature (magic bytes for jpeg/png/webp) — the
content-type allowlist alone only proves the client's CLAIM is one of jpeg/png/webp, never that the
bytes genuinely are. Unlike the size cap, this check happens INSIDE the transform job: the upload is
still accepted (`200`, the original is stored and downloadable), but the record ends up with
`status: 'failed'` and `error: { message: 'BAD_REQUEST' }`. This verification exists only for images
today — audio (`.wav`) and video (mp4/webm) still trust their declared `Content-Type` header alone.

### Lifecycle and querying an asset

```ts
export type AssetStatus = 'pending' | 'processing' | 'completed' | 'failed'
```

`'pending'` the moment the record is created, `'processing'` once the dispatcher starts the
transform, `'completed'`/`'failed'` as real terminal states — never skipped, even though the default
`InlineJobDispatcher` runs through all four within one request/response cycle. A future queue-backed
`JobDispatcher` (the port is deliberately opaque/JSON-serializable for exactly this) can leave a
record genuinely `'processing'` for longer.

- `GET /assets/:id` — the full `AssetRecord` (metadata + `variants`). `404` when `id` doesn't exist.
- `GET /assets/:id/status` — just `{ id, status, error }` (`error` only set when
  `status === 'failed'`).
- `GET /assets/:id/download?variant=<variantId>` — streams the real bytes; omit `variant` to
  download the original upload. Returns a raw `Response` (never buffers the whole file into a JSON
  DTO), with real `Content-Type`/`Content-Length` headers. `404` when the asset or the requested
  variant doesn't exist.

`AssetRecord.variants: AssetVariant[]` is a discriminated union (`ImageAssetVariant` /
`VideoAssetVariant` / `ThumbnailAssetVariant` / `AudioAssetVariant`) — every member shares
`variantId`/`format`/ `contentType`/`storageKey`/`size`/`checksum`/`transformId`/`policyVersion`
(`AssetVariantBase`) plus its own kind-specific fields (e.g. `width`/`height` for
image/video/thumbnail, `durationSeconds`/`channels`/`sampleRateHz` for audio).

`:id` is always a real `generateUUID()` value minted server-side by `AssetService` — every route
param validates it with `@IsUUID` (`AssetIdParamsRTO`), rejecting anything else (including a
path-traversal-shaped value) at the API boundary.

### Storage/repository adapters

`AssetStorage` (bytes: `put`/`get`/`delete`/`exists`) and `AssetRepository` (metadata:
`create`/`findById`/`update`/`delete`) are ports this package owns — it never implements a
production backend itself:

- **`createInMemoryAssetStorage()` / `createInMemoryAssetRepository()`** — in-process `Map`-backed,
  for tests. Never persist across a process restart.
- **`createLocalFilesystemAssetStorage(rootDir)`** — a real, disk-backed `AssetStorage`. Lets the
  complete vertical slice (upload → transform → store → download) run locally with zero external
  infra. It's a dev/test adapter, not the intended production object store; every key is confined to
  `rootDir` (via `@zanix/helpers`'s `confinePath`) before touching disk.
- **S3, structurally, no adapter needed** — `S3ObjectStorage` (`@zanix/datamaster/storage`, a
  sibling package `@zanix/space` never imports) already has an identical `put`/`get`/`delete`/
  `exists` shape, so it satisfies `AssetStorage` as-is. A consuming application composes it in
  itself; this package's own `dependency-boundary.test.ts` proves `@zanix/datamaster` never reaches
  `assets-api`'s published module graph, at compile time or runtime.
- **`createAssetRepositoryOverFiles(files)`** — maps `AssetRecord`'s domain fields
  (`kind`/`status`/`variants`/`error`) onto a generic file registry's free-form `metadata` bag,
  given any object matching the structurally-declared `FileRepositoryLike` shape — the exact shape
  `@zanix/datamaster/files`'s `MongoFileRepository` already has. Again, no import of
  `@zanix/datamaster` from this package; a consuming application passes its own
  `MongoFileRepository` instance (or anything else matching the shape) directly.

Both the S3 and Mongo pieces above are concrete classes from `@zanix/datamaster`, a **sibling
package** — never imported by `@zanix/space` itself. A real deployment composes them in from its own
code. For a complete worked example resolving between `LocalFilesystemAssetStorage` and a S3-backed
store by configuration, and migrating already-stored local objects into S3 once it becomes active,
see the reference implementation at `src/@tests/support/resolve-asset-storage.ts` (not shipped — a
hand-rolled example for an app that isn't using `@zanix/core`).

### Other exported types and low-level plumbing

The pieces above cover the day-to-day contract; the rest of the published surface is either a type
already implied by the shapes above, or plumbing most integrators never call directly:

- **`AssetLimits`/`AssetServiceOptions`/`AssetService`/`CreateAssetCommand`** — the types behind
  `createAssetService`'s options and return value
  (`AssetService.createAsset(command)`/`.getAsset(id)`/ `.downloadVariant(id, variantId?)`)
  documented above.
- **`AssetKind`** — `'audio' | 'image' | 'video'`, re-exported from `modules/asset-transform` (the
  build-time pipeline `docs/assets.md` documents) since both layers share the same kind concept.
- **`AssetTransformRequest`** — the discriminated union `CreateAssetCommand.transformRequest` takes;
  a controller (not application code) is the only place this package itself constructs one.
- **`AssetObject`/`CreateAssetInput`/`UpdateAssetInput`** — the plain data shapes the
  `AssetStorage`/ `AssetRepository` ports exchange (stored-object metadata, and repository
  create/update payloads, respectively) — relevant when writing a custom port implementation, not
  when just consuming one of the adapters above.
- **`JobDispatcher`/`AssetTransformationJobInput`** — the DISPATCH port deciding when/how a
  transform actually runs. The default (`jobs` omitted from `AssetServiceOptions`) is an
  `InlineJobDispatcher`, built via **`createInlineJobDispatcher`**/`InlineJobDispatcherOptions`,
  running the whole chain synchronously inside one request. `transformRequest` on the job input is
  deliberately typed `unknown` — a future queue-backed implementation (e.g. wired to
  `@zanix/asyncmq`) hands the exact same input to a real queue with zero change to this port or to
  `AssetService`.
- **`buildOriginalStorageKey(assetId)`/`buildVariantStorageKey(assetId, variantId)`** — build the
  logical, backend-independent `storageKey` strings (`assets/<id>/original`,
  `assets/<id>/variants/<variantId>`) every `AssetStorage` adapter treats as opaque. `AssetService`
  is the only real caller; documented here for completeness, not as something application code
  typically calls.
- **`CreateFileInputLike`/`FileRecordLike`/`FileRepositoryLike`/`UpdateFileInputLike`** — the
  structurally-declared shapes `createAssetRepositoryOverFiles` accepts, mirroring
  `@zanix/datamaster/files`'s own `MongoFileRepository`/`FileRecord`/`CreateFileInput`/
  `UpdateFileInput` without importing them.
- **`AssetsControllerInstance`/`AssetsControllerOptions`** — the types behind
  `createAssetsController`'s return value and options (`service`/`prefix`/`guards`), documented
  above.
- **`AssetIdParamsRTO`/`VideoUploadQueryRTO`/`VoiceUploadQueryRTO`** — the `@zanix/validator` RTOs
  validating, respectively, the `:id` route param and the `/assets/video`/`/assets/audio` query
  strings shown above.
- **`BaseRTO`** — re-exported from `@zanix/validator` because the three RTOs above extend it; the
  same convention `@zanix/server`'s own `mod.ts` already follows for its own RTOs.

### Automatic composition via `@zanix/core`

A `@zanix/core`-based application doesn't need to call `createAssetService`/`createAssetsController`
by hand at all: `Zanix.setup({ assets })` performs this exact composition automatically, wiring the
same `AssetStorage`/`AssetRepository` infrastructure (SeaweedFS/S3) described above. See
`@zanix/core`'s own documentation for that configuration's full contract — it isn't duplicated here.

### See also

- [`README.md`](../README.md#assets) — the "Assets" section this guide is one of two full references
  for (the other being [`docs/assets.md`](./assets.md), the build-time pipeline).
- [`docs/assets.md`](./assets.md) — static files served by a stable path, content-hashing, and the
  build-time image/SVG/video optimization pipeline this API's own `AssetTransformer` reuses.
