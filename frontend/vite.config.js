import { defineConfig } from 'vite'

// : Vite als Build-System einfuehren — OHNE Funktionsaenderung. Die bestehende
// app.js (eine grosse IIFE) wird zunaechst als Single-Entry ueber Vite gebaut (gebundelt,
// nicht minifiziert -> moeglichst nahe am Original). Die uebrigen statischen Assets
// (index.html, style.css, fonts, images, Rechtstexte) werden im Dockerfile unveraendert
// nach dist/ kopiert; Vite ersetzt dort nur das app.js-Bundle. Die Modulaufteilung
// und die Build-Zeit-Editionstrennung (VITE_EDITION) bauen darauf auf.
export default defineConfig({
  root: 'src',
  build: {
    outDir: '../dist',
    emptyOutDir: false,
    minify: false,
    target: 'es2020',
    lib: {
      entry: 'app.js',
      formats: ['iife'],
      name: 'AnsimateApp',
      fileName: () => 'app.js',
    },
  },
})
