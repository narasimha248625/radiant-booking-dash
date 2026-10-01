import { getTurfData } from './src/lib/turf.functions.ts';

async function run() {
  try {
    const data = await getTurfData();
    console.log("Success:", data);
  } catch (err) {
    console.error("Error:", err);
  }
}
run();
