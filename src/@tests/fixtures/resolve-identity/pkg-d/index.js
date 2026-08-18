"use strict";
// CJS -> CJS bare require of another "npm package" — `bare-specifier-resolve.ts`'s own doc, item 4.
var pkgC = require("@test-fixtures/pkg-c");
pkgC.state.touchedBy.push("pkg-d");
pkgC.state.count++;
exports.state = pkgC.state;
