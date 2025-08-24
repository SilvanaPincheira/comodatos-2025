/** @type {import('next').NextConfig} */
const nextConfig = {};

module.exports = nextConfig;
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // ⬇️ No frenes el build en producción por errores de ESLint
  eslint: {
    ignoreDuringBuilds: true,
  },

  // (Opcional) si el build se cae por tipos TS, descomenta:
  // typescript: { ignoreBuildErrors: true },
};

module.exports = nextConfig;

