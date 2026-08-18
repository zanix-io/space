// ESM -> ESM bare import of another "npm package" — `bare-specifier-resolve.ts`'s own doc, item 6.
import { state, touch } from "@test-fixtures/pkg-a";
touch("pkg-b");
export { state };
