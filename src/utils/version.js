import { version } from '../../package.json';

// Vite supplies the build metadata. The fallback version follows the package,
// including release-please bumps, and never invents a build date.
export const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : version;
export const APP_BUILD_DATE = typeof __APP_BUILD_DATE__ !== 'undefined' ? __APP_BUILD_DATE__ : 'neuvedeno';
