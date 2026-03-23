var _a;
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
function getGitHubPagesBasePath() {
    var _a;
    var explicitBasePath = (_a = process.env.VITE_BASE_PATH) === null || _a === void 0 ? void 0 : _a.trim();
    if (explicitBasePath) {
        return explicitBasePath;
    }
    var repository = process.env.GITHUB_REPOSITORY;
    var owner = process.env.GITHUB_REPOSITORY_OWNER;
    if (!repository || !owner) {
        return '/';
    }
    var _b = repository.split('/'), repoName = _b[1];
    if (!repoName) {
        return '/';
    }
    return repoName.toLowerCase() === "".concat(owner.toLowerCase(), ".github.io") ? '/' : "/".concat(repoName, "/");
}
export default defineConfig({
    base: ((_a = process.env.VITE_BASE_PATH) === null || _a === void 0 ? void 0 : _a.trim()) || (process.env.GITHUB_ACTIONS === 'true' ? getGitHubPagesBasePath() : '/'),
    plugins: [react()],
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
});
