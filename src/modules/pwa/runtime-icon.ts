import { InternalError } from '@zanix/errors'
import { SHARP_SPECIFIER } from '../lazy/specifiers.ts'

type SharpModule = {
  default: (input: Uint8Array) => {
    resize(
      width: number,
      height: number,
    ): { png(): { toBuffer(): Promise<Uint8Array<ArrayBuffer>> } }
  }
}

let sharpModule: SharpModule | undefined

/**
 * Resizes the app's source icon to `size`×`size` PNG on demand, for an app that has no client build
 * output (dev), where `pwaPlugin` has written no `icons/` files yet the manifest still lists them.
 *
 * `sharp` is a native, build-tool dependency, so it is resolved with a dynamic `import()` through
 * {@linkcode SHARP_SPECIFIER} on the first call: a deployed server that has a build output never
 * reaches this module's `import()`, and neither does a client bundle.
 *
 * @param sourcePath - The resolved path of `PwaConfig.icon`.
 * @param size - The side of the square PNG to produce, in pixels.
 * @throws `Deno.errors.NotFound` when `sourcePath` does not exist (the caller answers `404`), and
 * an `InternalError` (`SPACE_PWA_ICON_RESIZE_FAILED`) when `sharp` cannot load or the source is
 * not a readable image.
 */
export async function resizeIcon(
  sourcePath: string,
  size: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const source = await Deno.readFile(sourcePath)
  try {
    sharpModule ??= await import(SHARP_SPECIFIER) as SharpModule
    return await sharpModule.default(source).resize(size, size).png().toBuffer()
  } catch (error) {
    throw new InternalError(`Failed to resize the PWA icon to ${size}x${size}.`, {
      code: 'SPACE_PWA_ICON_RESIZE_FAILED',
      meta: { source: 'zanix', size },
      cause: error,
    })
  }
}
