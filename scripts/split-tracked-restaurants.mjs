import fs from 'node:fs/promises';
import path from 'node:path';

const dataDir = path.join(process.cwd(), 'data');
const trackedPath = path.join(dataDir, 'tracked-restaurants.json');
const publicPath = path.join(dataDir, 'seed-restaurants.json');
const reviewPath = path.join(dataDir, 'review-restaurants.json');
const rejectedPath = path.join(dataDir, 'rejected-restaurants.json');

const tracked = JSON.parse(await fs.readFile(trackedPath, 'utf8'));

if (!Array.isArray(tracked)) {
  throw new Error('Tracked restaurant file must be an array.');
}

const publicRestaurants = tracked.filter((restaurant) => restaurant.verification_status === 'verified');
const reviewRestaurants = tracked.filter((restaurant) =>
  ['candidate', 'needs_review'].includes(restaurant.verification_status)
);
const rejectedRestaurants = tracked.filter((restaurant) => restaurant.verification_status === 'rejected');

await fs.writeFile(publicPath, JSON.stringify(publicRestaurants, null, 2) + '\n');
await fs.writeFile(reviewPath, JSON.stringify(reviewRestaurants, null, 2) + '\n');
await fs.writeFile(rejectedPath, JSON.stringify(rejectedRestaurants, null, 2) + '\n');

console.log(`Tracked restaurants: ${tracked.length}`);
console.log(`Public restaurants: ${publicRestaurants.length}`);
console.log(`Review restaurants: ${reviewRestaurants.length}`);
console.log(`Rejected restaurants: ${rejectedRestaurants.length}`);
