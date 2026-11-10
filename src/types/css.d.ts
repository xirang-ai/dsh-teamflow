/**
 * CSS imported for its text.
 *
 * The client bundle loads stylesheets as strings (esbuild `text` loader) and
 * renders them through a `<style>` tag; the browser build never imports CSS as
 * a side effect, so the TypeScript view is a plain string module.
 */
declare module '*.css' {
  const source: string
  export default source
}
