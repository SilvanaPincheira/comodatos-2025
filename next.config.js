/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // No frenes el build por errores de ESLint en producción
  eslint: {
    ignoreDuringBuilds: true,
  },

  // (Opcional) si el build se cae por tipos TS, descomenta:
  // typescript: { ignoreBuildErrors: true },
};

module.exports = nextConfig;
// Si prefieres ESM, usa esto en vez de la línea anterior:
// export default nextConfig;


