// Stylesheets are bundled by the shell's build (Vite).
declare module "*.css";
// Images are bundled by the shell's build and resolve to a URL.
declare module "*.png" {
  const url: string;
  export default url;
}
