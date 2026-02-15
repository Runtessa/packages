/** @type {import('tailwindcss').Config} */
const config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx}',
    './components/**/*.{js,ts,jsx,tsx}',
    './lib/**/*.{js,ts,jsx,tsx}',
    './server.ts',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Inter"', '"Vazirmatn"', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        soft: '0 1px 3px rgba(0,0,0,0.35)',
      },
      colors: {
        primary: '#262525ff',
        primaryDark: '#191919ff',
        accent: '#4ADE80',
        bgApp: '#121212',
        bgSurface: '#1E1E1E',
        borderSubtle: '#2A2A2A',
        textPrimary: '#FFFFFF',
        textMuted: '#A3A3A3',
        danger: '#DC2626',
        warning: '#D97706',
        success: '#22C55E',
        bgSidebar: '#121212',
        surface: {
          DEFAULT: '#1E1E1E',
          muted: '#262626',
          strong: '#000000',
        },
        border: '#2A2A2A',
        text: {
          primary: '#FFFFFF',
          muted: '#A3A3A3',
        },
      },
    },
  },
  plugins: [],
};

export default config;
