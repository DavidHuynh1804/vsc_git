/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        vscode: {
          bg: "var(--vscode-bg)",
          sidebar: "var(--vscode-sidebar)",
          activity: "var(--vscode-activity)",
          titlebar: "var(--vscode-titlebar)",
          statusbar: "var(--vscode-statusbar)",
          border: "var(--vscode-border)",
          fg: "var(--vscode-fg)",
          muted: "var(--vscode-muted)",
          accent: "var(--vscode-accent)",
          hover: "var(--vscode-hover)",
          active: "var(--vscode-active)",
          badge: "var(--vscode-badge)",
          inputBg: "var(--vscode-input-bg)",
        },
      },
      fontFamily: {
        mono: [
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Monaco",
          "Consolas",
          "Liberation Mono",
          "Courier New",
          "monospace",
        ],
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "Helvetica",
          "Arial",
          "sans-serif",
        ],
      },
    },
  },
  plugins: [],
};
