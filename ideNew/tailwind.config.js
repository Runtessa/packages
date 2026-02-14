/** @type {import('tailwindcss').Config} */
const config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Inter"', '"Vazirmatn"', "system-ui", "sans-serif"],
      },
      boxShadow: {
        soft: "0 1px 3px rgba(0,0,0,0.35)",
      },
      colors: {
        // Brand
        primary: "#262525ff", // Green-500 (Minty)
        primaryDark: "#191919ff", // Green-700
        accent: "#4ADE80", // Green-400

        // Base Backgrounds (Neutral/Gray)
        bgApp: "#121212", // Pure Dark
        bgSurface: "#1E1E1E", // Elevation 1
        borderSubtle: "#2A2A2A", // Subtle Gray

        // Text
        textPrimary: "#FFFFFF", // Pure White
        textMuted: "#A3A3A3", // Neutral-400

        // Status
        danger: "#DC2626",
        warning: "#D97706",
        success: "#22C55E",

        // Duplicate keys (Strictly preserving your structure)
        bgSidebar: "#121212",
        surface: {
          DEFAULT: "#1E1E1E",
          muted: "#262626",
          strong: "#000000",
        },
        border: "#2A2A2A",
        text: {
          primary: "#FFFFFF",
          muted: "#A3A3A3",
        },
      },
    },
  },
  plugins: [],
};

export default config;
