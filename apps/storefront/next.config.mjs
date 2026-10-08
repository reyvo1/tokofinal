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
  };
}
