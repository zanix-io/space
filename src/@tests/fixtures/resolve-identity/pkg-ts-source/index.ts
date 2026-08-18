// `bare-specifier-resolve.ts`'s own documented scope limit: a bare specifier resolving to raw,
// untranspiled TypeScript source (never transpiled by `@deno/loader`, since a canonically-resolved
// bare specifier no longer reaches `@deno/vite-plugin`'s own `load` hook). No real published npm
// package ships raw `.ts` at its entry file, so this is deliberately synthetic.
export const value: string = "ts-source-ok";
