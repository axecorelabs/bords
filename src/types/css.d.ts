// Allow importing CSS files as side-effect imports (e.g. tldraw/tldraw.css)
declare module '*.css' {
  const content: Record<string, string>
  export default content
}
