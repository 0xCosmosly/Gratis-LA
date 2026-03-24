import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

function getGitHubPagesBasePath() {
  const explicitBasePath = process.env.VITE_BASE_PATH?.trim();
  if (explicitBasePath) {
    return explicitBasePath;
  }

  const repository = process.env.GITHUB_REPOSITORY;
  const owner = process.env.GITHUB_REPOSITORY_OWNER;

  if (!repository || !owner) {
    return '/';
  }

  const [, repoName] = repository.split('/');
  if (!repoName) {
    return '/';
  }

  return repoName.toLowerCase() === `${owner.toLowerCase()}.github.io` ? '/' : `/${repoName}/`;
}

export default defineConfig(({ command }) => ({
  base: '/Gratis-LA/',
  plugins: [react(), basicSsl()],
  server: {
    https: true as any,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'leaflet-vendor': ['leaflet'],
          'supabase-vendor': ['@supabase/supabase-js']
        }
      }
    }
  }
}));
