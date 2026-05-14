import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      boxShadow: {
        soft: "0 24px 80px rgba(17, 24, 39, 0.16)",
      },
    },
  },
  plugins: [],
};

export default config;
