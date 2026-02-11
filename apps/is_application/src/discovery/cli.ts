import { discoverDevices } from "./index.js";

async function run(): Promise<void> {
  const devices = await discoverDevices();
  console.log(JSON.stringify(devices, null, 2));
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

