import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    hmr: false
  },
  build: {
    chunkSizeWarningLimit: 12000, // data_pegawai ~10MB adalah static data file — suppress false alarm
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Codec besar yang hanya dipakai upload foto — biarkan lazy-load terpisah
          if (id.includes('node_modules/heic2any/')) {
            return 'heic2any';
          }
          if (id.includes('node_modules/utif/')) {
            return 'utif';
          }
          if (id.includes('node_modules/pdfjs-dist/')) {
            return 'pdf-viewer';
          }
          if (id.includes('node_modules/@keep-lts/xlsx/')) {
            return 'spreadsheet-viewer';
          }
          if (id.includes('node_modules')) {
            return 'vendor';
          }
          if (id.includes('src/data/data_lokasi')) {
            return 'data-lokasi';
          }
          if (id.includes('src/data/data_pegawai')) {
            return 'data-pegawai';
          }
        }
      }
    }
  }
});
