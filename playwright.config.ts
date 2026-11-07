import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:3099",
    ...devices["iPhone 13"],
    defaultBrowserType: "chromium",
    screenshot: "only-on-failure",
    launchOptions: {
      executablePath:
        process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    },
  },
  webServer: {
    command: "node --import tsx backend/src/index.ts",
    url: "http://127.0.0.1:3099/api/health",
    reuseExistingServer: false,
    env: {
      DEV_AUTH: "true",
      NODE_ENV: "development",
      PORT: "3099",
      HOST: "127.0.0.1",
      DATABASE_PATH: ":memory:",
      SKI_DATA_PATH: process.env.SLOPEMATE_TEST_MAPS || "map-data",
      BOT_TOKEN: "",
    },
  },
});
