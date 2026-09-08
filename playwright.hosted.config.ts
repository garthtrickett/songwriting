import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'tests/hosted-browser',workers:1,timeout:30000,
  use:{baseURL:'http://127.0.0.1:5198',headless:true,screenshot:'only-on-failure'},
  webServer:{command:'VITE_AGENT_MODE=hosted bun run dev --port 5198',url:'http://127.0.0.1:5198',reuseExistingServer:false},
});
