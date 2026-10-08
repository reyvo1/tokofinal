import { PHASE_DEVELOPMENT_SERVER } from "next/constants.js";

export default function nextConfig(phase) {
  const isDevelopmentServer = phase === PHASE_DEVELOPMENT_SERVER;
  const verificationOwnsTypes = process.env.T360_NEXT_VERIFY === "1";
  const tsconfigPath = isDevelopmentServer && !verificationOwnsTypes
    ? "tsconfig.json"
    : "tsconfig.build.json";

  return {
    typescript: {
      ignoreBuildErrors: false,
      tsconfigPath,
    },
    // The stock-count PWA is a directory in public/, and Next does not serve a directory index: only
    // /stock-count/index.html resolved, while /stock-count/ 308'd to /stock-count and then 404'd. Since
    // a manifest's `start_url: "./"` resolves to exactly that trailing-slash form, the app could not be
    // installed from a link at all — a defect no source-level test catches, found by loading it.
    //
    // Scoped to this one path on purpose. `trailingSlash: true` would fix it globally and change every
    // POS route in the process, which is not a trade worth making for one static app.
    async rewrites() {
      return [
        { source: '/stock-count', destination: '/stock-count/index.html' },
        { source: '/stock-count/index.html', destination: '/stock-count/index.html' },
        // POST-1D, same reasoning: a manifest's `start_url: "./"` resolves to the trailing-slash form,
        // which Next does not serve for a directory in public/.
        { source: '/kiosk', destination: '/kiosk/index.html' },
        { source: '/kiosk/index.html', destination: '/kiosk/index.html' },
      ];
    },
  };
}
