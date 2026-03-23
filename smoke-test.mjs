import { chromium } from 'playwright';
import { spawn } from 'child_process';
import path from 'path';

async function runSmokeTest() {
  console.log('Starting preview server...');
  const preview = spawn('npm', ['run', 'preview'], { stdio: 'pipe' });
  
  let port = null;
  
  // Wait for the server to start and grab the port
  await new Promise((resolve) => {
    preview.stdout.on('data', (data) => {
      const output = data.toString();
      console.log(`[Preview]: ${output}`);
      const match = output.match(/http:\/\/localhost:(\d+)/);
      if (match) {
        port = match[1];
        resolve();
      }
    });
    
    // Also resolve if it errors out immediately
    preview.stderr.on('data', (data) => {
      console.error(`[Preview Error]: ${data}`);
    });
  });

  if (!port) {
    console.error('Failed to find preview server port.');
    preview.kill();
    process.exit(1);
  }

  console.log(`Preview server running on port ${port}. Launching browser...`);
  
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  const issues = [];

  page.on('console', msg => {
    if (msg.type() === 'error') {
      issues.push(`Console Error: ${msg.text()}`);
    } else if (msg.type() === 'warning') {
      issues.push(`Console Warning: ${msg.text()}`);
    }
  });

  page.on('pageerror', error => {
    issues.push(`Page Error: ${error.message}`);
  });

  page.on('requestfailed', request => {
    issues.push(`Failed Network Request: ${request.url()} - ${request.failure().errorText}`);
  });

  console.log(`Navigating to http://localhost:${port}...`);
  try {
    const response = await page.goto(`http://localhost:${port}`, { waitUntil: 'networkidle' });
    if (!response.ok()) {
      issues.push(`HTTP Status: ${response.status()} ${response.statusText()}`);
    }
    
    // Check if the map or main elements rendered
    const hasMap = await page.locator('.leaflet-container').count() > 0;
    if (!hasMap) {
      issues.push('Missing Element: Leaflet map container not found on page load.');
    }
    
    // Wait a bit to let any async data load
    await page.waitForTimeout(4000);
    
  } catch (err) {
    issues.push(`Navigation Error: ${err.message}`);
  }

  // Filter out aborted map tile requests since they usually just mean the browser closed while tiles were still loading
  const filteredIssues = issues.filter(i => !(i.includes('basemaps.cartocdn.com') && i.includes('ERR_ABORTED')));

  await browser.close();
  preview.kill();
  
  console.log('\n--- SMOKE TEST RESULTS ---');
  if (filteredIssues.length === 0) {
    console.log('No issues found!');
  } else {
    filteredIssues.forEach((issue, idx) => {
      console.log(`${idx + 1}. ${issue}`);
    });
  }
}

runSmokeTest().catch(console.error);
