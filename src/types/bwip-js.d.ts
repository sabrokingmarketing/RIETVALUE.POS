// bwip-js only publishes types under the "node"/"browser" export conditions, which the
// TypeScript "bundler" resolver does not select. Declare the small surface we use.
declare module "bwip-js" {
  const bwipjs: { raw(opts: { bcid: string; text: string }): unknown };
  export default bwipjs;
}
