// Page scripts are imported as text and run inside browsed pages.
declare module "*?raw" {
  const source: string;
  export default source;
}
declare module "*.css";
declare module "*.png" {
  const url: string;
  export default url;
}
