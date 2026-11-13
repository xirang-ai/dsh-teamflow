/**
 * Version of the build this browser bundle came from.
 *
 * `scripts/build.mjs` substitutes the manifest `version` at bundle time: the
 * browser half cannot read `package.json` at runtime, and bundling the whole
 * manifest would ship the development fields to the browser. The Host half
 * reads the same field at runtime (`src/version.ts`), so for one build the
 * badge, the bundle banner and `meta.plugin_version` all agree.
 *
 * @module
 */

/** Replaced by esbuild's `define` with the string from `package.json`. */
declare const __TEAMFLOW_VERSION__: string

/** The manifest `version` that produced this bundle, for example `0.1.2`. */
export const PLUGIN_VERSION: string = __TEAMFLOW_VERSION__
