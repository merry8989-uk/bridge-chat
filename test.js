// Playwright test for Bridge Chat
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  console.log('Starting Playwright test...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  const errors = [];
  const consoleMessages = [];
  page.on('console', (msg) => {
    consoleMessages.push(`[${msg.type()}] ${msg.text()}`);
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(`PAGE ERROR: ${err.message}`));

  // Load frontend
  const indexPath = 'file://' + path.resolve(__dirname, 'frontend/index.html');
  console.log('Loading:', indexPath);
  await page.goto(indexPath, { waitUntil: 'networkidle' });

  // Clear localStorage for a fresh test
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });

  // Wait for app init
  await page.waitForTimeout(2000);

  // Screenshot 1: Login screen
  await page.screenshot({ path: 'test-screenshots/01-login.png' });
  console.log('✓ Screenshot 1: Login screen');

  // Check login elements exist
  const hasLoginScreen = await page.$('#loginScreen.active') !== null;
  const hasPlatformButtons = (await page.$$('.platform-btn')).length === 2;
  console.log('Login screen visible:', hasLoginScreen);
  console.log('Platform buttons:', hasPlatformButtons);

  // Click WhatsApp login button
  await page.click('.platform-btn.whatsapp');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'test-screenshots/02-qr-modal.png' });
  console.log('✓ Screenshot 2: QR modal');

  // Simulate scan
  await page.click('#qrSimulateBtn');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'test-screenshots/03-app.png' });
  console.log('✓ Screenshot 3: Main app');

  // Check if app screen is visible
  const hasApp = await page.$('#appScreen.active') !== null;
  console.log('App screen visible:', hasApp);

  // Check user info
  const meName = await page.textContent('#meName');
  const mePlatform = await page.textContent('#mePlatform');
  const xidValue = await page.textContent('#xidValue');
  console.log('User:', meName, '| Platform:', mePlatform, '| XID:', xidValue);

  // Check chat list
  const chatItems = await page.$$('.chat-item');
  console.log('Chat items:', chatItems.length);

  // Click first chat to open
  if (chatItems.length > 0) {
    await chatItems[0].click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'test-screenshots/04-chat-open.png' });
    console.log('✓ Screenshot 4: Chat open');

    // Send a message
    await page.fill('#messageInput', 'Hello from test!');
    await page.click('#sendBtn');
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'test-screenshots/05-message-sent.png' });
    console.log('✓ Screenshot 5: Message sent');
  }

  // Open new chat modal (back button is hidden on desktop, so skip it)
  const backBtnVisible = await page.isVisible('#backBtn');
  if (backBtnVisible) {
    await page.click('#backBtn');
    await page.waitForTimeout(500);
  }
  await page.click('#newChatBtn');
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'test-screenshots/06-new-chat.png' });
  console.log('✓ Screenshot 6: New chat modal');

  // Close modal
  await page.click('[data-modal-close="newChatModal"]');
  await page.waitForTimeout(300);

  // Open new temp chat
  await page.click('#newTempBtn');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'test-screenshots/07-temp-chat.png' });
  console.log('✓ Screenshot 7: Temp chat modal');

  // Get temp code
  const tempId = await page.textContent('#tempIdValue');
  console.log('Temp code:', tempId);

  // Open the temp chat
  await page.click('#tempOpenBtn');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'test-screenshots/08-temp-open.png' });
  console.log('✓ Screenshot 8: Temp chat open');

  // Debug
  console.log('After temp open - empty:', await page.getAttribute('#emptyState', 'class'));
  console.log('After temp open - chat:', await page.getAttribute('#chatView', 'class'));

  // Close any open modal first
  await page.evaluate(() => {
    document.querySelectorAll('.modal.active').forEach(m => m.classList.remove('active'));
  });
  await page.waitForTimeout(300);

  console.log('After modal close - empty:', await page.getAttribute('#emptyState', 'class'));
  console.log('After modal close - chat:', await page.getAttribute('#chatView', 'class'));

  // Toggle theme
  const backVisible2 = await page.isVisible('#backBtn');
  if (backVisible2) {
    await page.click('#backBtn');
    await page.waitForTimeout(300);
  }
  await page.click('#themeToggle');
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'test-screenshots/09-light-theme.png' });
  console.log('✓ Screenshot 9: Light theme');

  // Check for filter chips
  const filterChips = await page.$$('.filter-chip');
  console.log('Filter chips:', filterChips.length);

  // Click telegram filter
  await page.click('.filter-chip[data-filter="telegram"]');
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'test-screenshots/10-telegram-filter.png' });
  console.log('✓ Screenshot 10: Telegram filter');

  // Mobile view
  await page.setViewportSize({ width: 375, height: 667 });
  await page.waitForTimeout(500);

  // Debug
  console.log('=== Before mobile screenshot ===');
  console.log('appScreen class:', await page.getAttribute('#appScreen', 'class'));
  console.log('empty-state class:', await page.getAttribute('#emptyState', 'class'));
  console.log('chat-view class:', await page.getAttribute('#chatView', 'class'));

  const html = await page.evaluate(() => ({
    bodyHeight: document.body.offsetHeight,
    htmlHeight: document.documentElement.offsetHeight,
    emptyRect: document.getElementById('emptyState').getBoundingClientRect(),
    chatRect: document.getElementById('chatView').getBoundingClientRect(),
    paneRect: document.getElementById('chatPane').getBoundingClientRect(),
  }));
  console.log('HTML state:', JSON.stringify(html, null, 2));

  await page.screenshot({ path: 'test-screenshots/11-mobile-FRESH.png' });
  console.log('✓ Screenshot 11: Mobile view');

  // Final
  console.log('\n=== Console Errors ===');
  if (errors.length === 0) console.log('No errors!');
  else errors.forEach(e => console.log('  -', e));

  console.log('\n=== Console Messages ===');
  consoleMessages.forEach(m => console.log('  ', m));

  await browser.close();
  console.log('\n✓ Test complete');
})();