// Vercel function for /api/* (vercel.json rewrites every /api path here). The API is built by
// ops/vercel/build.sh into apps/api/dist/serverless.js; Vercel traces its dependencies from there.
export { default } from '../apps/api/dist/serverless.js';
