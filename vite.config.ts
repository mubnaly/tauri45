import { defineConfig } from 'vite';

// The Tauri shell loads `dist/` in production (see src-tauri/tauri.conf.json)
// and http://127.0.0.1:1420 in development.
export default defineConfig({
    clearScreen: false,
    server: {
        port: 1420,
        strictPort: true,
        host: '127.0.0.1',
    },
    envPrefix: ['VITE_', 'TAURI_'],
    build: {
        target: 'es2022',
        outDir: 'dist',
        emptyOutDir: true,
        sourcemap: false,
        minify: 'esbuild',
    },
});
