import { OncadeSDK, PurchaseItem } from '@oncade/sdk';

const ONCADE_API_KEY = 'api_test_63b897402a08ca75268e7a0e052efec5dd1b787e197350b785581ac8111a7bb8';
const ONCADE_GAME_ID = 'zombie-survivors-test-22eyd';

// Create a new SDK instance
const sdk = new OncadeSDK({
  apiKey: ONCADE_API_KEY,
  gameId: ONCADE_GAME_ID
});

let isInitialized = false;

// Initialize the SDK
async function initializeOncade(): Promise<void> {
  if (isInitialized) {
    console.log('Oncade SDK already initialized.');
    return;
  }
  try {
    // Check if running in an environment where Oncade SDK can initialize
    // (e.g., not in a Node.js environment during build if SDK relies on browser APIs)
    if (typeof window !== 'undefined') {
        await sdk.initialize();
        isInitialized = true;
        console.log('Oncade SDK initialized successfully.');
    } else {
        console.warn('Oncade SDK initialization skipped: Not in a browser environment.');
    }
  } catch (error) {
    console.error('Failed to initialize Oncade SDK:', error);
    isInitialized = false; // Ensure flag is false on error
  }
}

// Get the store catalog
async function getStoreCatalog(): Promise<PurchaseItem[]> {
  if (!isInitialized) {
    console.warn('Oncade SDK not initialized. Attempting to initialize...');
    await initializeOncade(); // Attempt to initialize if not already
  }
  if (!isInitialized) return []; // Return empty if initialization failed or skipped

  try {
    const catalog = await sdk.getStoreCatalog();
    console.log('Available items:', catalog);
    return catalog;
  } catch (error) {
    console.error('Failed to get store catalog:', error);
    return [];
  }
}

// Open the purchase URL for a specific item
// NOTE: This requires a UI to select an item and get its ID.
// This function is provided as a template for when you implement item selection.
async function openPurchaseUrl(itemId: string): Promise<void> {
   if (!isInitialized) {
    console.warn('Oncade SDK not initialized. Attempting to initialize...');
    await initializeOncade();
  }
   if (!isInitialized) return;

  try {
    // Adjust the redirect URL path as needed for your game's routing
    const redirectUrl = `${window.location.origin}/purchase-success`;
    const purchaseUrl = await sdk.getPurchaseURL({
      itemId,
      redirectUrl: redirectUrl
    });

    if (purchaseUrl) {
      console.log(`Redirecting to purchase URL for item ${itemId}: ${purchaseUrl}`);
      
      // Track purchase URL generation
      trackEvent('purchase_url_generated', { itemId });
      
      window.location.href = purchaseUrl; // Redirect the main window
    } else {
      console.warn('Could not get purchase URL. Item might be invalid or store unavailable.');
      
      // Track purchase URL generation failure
      trackEvent('purchase_url_generation_failed', { itemId });
      
      // Inform the user appropriately
    }
  } catch (error) {
    console.error(`Failed to get purchase URL for item ${itemId}:`, error);
    
    // Track purchase URL generation error
    trackEvent('purchase_url_error', { itemId, error: String(error) });
    
    // Inform the user appropriately
  }
}

// Open the tip URL
async function openTipUrl(): Promise<void> {
   if (!isInitialized) {
    console.warn('Oncade SDK not initialized. Attempting to initialize...');
    await initializeOncade();
  }
   if (!isInitialized) return;

  try {
    // Adjust the redirect URL path as needed for your game's routing
    const redirectUrl = `${window.location.origin}/tip-success`;
    const tipUrl = await sdk.getTipURL({
       redirectUrl: redirectUrl,
       gameId: ONCADE_GAME_ID
    });

    if (tipUrl) {
      console.log(`Opening tip URL: ${tipUrl}`);
      
      // Track tip URL generation
      trackEvent('tip_url_generated');
      
      // Open tip URL in a new window/tab for better UX
      window.open(tipUrl, '_blank');
    } else {
        console.warn('Could not get tip URL.');
        
        // Track tip URL generation failure
        trackEvent('tip_url_generation_failed');
        
        // Inform the user appropriately
    }
  } catch (error) {
      console.error('Failed to get tip URL:', error);
      
      // Track tip URL generation error
      trackEvent('tip_url_error', { error: String(error) });
      
      // Inform the user appropriately
  }
}

// Function to check session and purchase history
async function checkPurchases() {
   if (!isInitialized) {
    console.warn('Oncade SDK not initialized. Attempting to initialize...');
    await initializeOncade();
  }
   if (!isInitialized) return null;

  try {
    const sessionInfo = await sdk.getSessionInfo();
    if (!sessionInfo.isValid) {
      console.warn('No valid Oncade session available.');
      // You might want to trigger a login flow here if needed.
      // Example: openLoginUrl();
      return null;
    }

    if (!sessionInfo.hasUserId) {
      console.log('User not authenticated - purchase history not available.');
      // You could show a "Login" button instead of "Purchase History"
      return null; // Indicate user is not logged in
    }

    console.log('User authenticated, fetching transaction history...');
    const transactions = await sdk.getTransactionHistory();
    console.log('Transaction history:', transactions);

    // Game-specific logic to process transactions would go here.
    // Iterate through transactions, check status, grant items/currency,
    // and mark as processed (ideally via your own backend).
    // Example check for completed purchases:
    // const completedPurchases = transactions.filter(t => t.status === 'completed');

    return transactions;
  } catch (error) {
    console.error('Failed to check transactions:', error);
    
    // Track transaction history retrieval error
    trackEvent('transaction_history_error', { error: String(error) });
    
    return null;
  }
}

// Optional: Function to open login URL
async function openLoginUrl(): Promise<void> {
    if (!isInitialized) {
     console.warn('Oncade SDK not initialized. Attempting to initialize...');
     await initializeOncade();
   }
    if (!isInitialized) return;

   try {
     // Get session info to retrieve the token if available
     const sessionInfo = await sdk.getSessionInfo();
     if (!sessionInfo.isValid || !sessionInfo.sessionToken) {
         console.warn('Cannot get login URL: No valid session or session token available.');
         
         // Track login URL generation failure
         trackEvent('login_url_generation_failed', { reason: 'invalid_session' });
         
         // Handle appropriately - maybe initialization failed or user needs to init first
         return;
     }

     // Adjust the redirect URL path as needed for your game's routing
     const redirectUrl = `${window.location.origin}/login-success`;
     const loginUrl = await sdk.getLoginURL({
        redirectUrl: redirectUrl,
        gameId: ONCADE_GAME_ID,
        sessionToken: sessionInfo.sessionToken // Added sessionToken
     });

     if (loginUrl) {
       console.log(`Redirecting to login URL: ${loginUrl}`);
       
       // Track login URL generation
       trackEvent('login_url_generated');
       
       window.location.href = loginUrl; // Redirect the main window
     } else {
         console.warn('Could not get login URL.');
         
         // Track login URL generation failure
         trackEvent('login_url_generation_failed', { reason: 'url_generation_failed' });
     }
   } catch (error) {
       console.error('Failed to get login URL:', error);
       
       // Track login URL generation error
       trackEvent('login_url_error', { error: String(error) });
   }
}

// Remote Config Functions

/**
 * Get a specific configuration value from remote config
 * @param key The configuration key to retrieve
 * @param defaultValue Optional default value if the key doesn't exist
 * @returns Promise resolving to the configuration value or default
 */
async function getConfig<T>(key: string, defaultValue?: T): Promise<T | undefined> {
  if (!isInitialized) {
    console.warn('Oncade SDK not initialized. Attempting to initialize...');
    await initializeOncade();
  }
  if (!isInitialized) return defaultValue;

  try {
    const value = await sdk.getConfig<T>(key, defaultValue);
    return value;
  } catch (error) {
    console.error(`Failed to get config for key "${key}":`, error);
    return defaultValue;
  }
}

/**
 * Get all configuration values from remote config
 * @returns Promise resolving to all configuration values
 */
async function getAllConfig(): Promise<Record<string, unknown>> {
  if (!isInitialized) {
    console.warn('Oncade SDK not initialized. Attempting to initialize...');
    await initializeOncade();
  }
  if (!isInitialized) return {};

  try {
    const config = await sdk.getAllConfig();
    return config;
  } catch (error) {
    console.error('Failed to get all config:', error);
    return {};
  }
}

/**
 * Subscribe to changes for a specific configuration key
 * @param key The configuration key to subscribe to
 * @param callback Function to call when the value changes
 * @returns Function to unsubscribe from the changes
 */
function onConfigChange<T>(key: string, callback: (value: T) => void): () => void {
  if (!isInitialized) {
    console.warn('Oncade SDK not initialized. Attempting to initialize...');
    initializeOncade().catch(console.error);
    return () => {}; // Return empty unsubscribe function
  }

  try {
    return sdk.onConfigChange<T>(key, callback);
  } catch (error) {
    console.error(`Failed to subscribe to config changes for key "${key}":`, error);
    return () => {}; // Return empty unsubscribe function
  }
}

// Telemetry Functions

/**
 * Track an event with optional payload
 * @param eventName Name of the event to track
 * @param payload Optional data to include with the event
 * @param options Optional options for tracking
 */
function trackEvent<EventPayload extends Record<string, unknown>>(
  eventName: string, 
  payload?: EventPayload,
  options?: { flushImmediately?: boolean }
): void {
  if (!isInitialized) {
    console.warn('Oncade SDK not initialized. Attempting to initialize...');
    initializeOncade().catch(console.error);
    return;
  }

  try {
    sdk.track(eventName, payload || {}, options);
  } catch (error) {
    console.error(`Failed to track event "${eventName}":`, error);
  }
}

/**
 * Flush telemetry data to the server
 * @returns Promise resolving when telemetry is flushed
 */
async function flushTelemetry(): Promise<void> {
  if (!isInitialized) {
    console.warn('Oncade SDK not initialized. Attempting to initialize...');
    await initializeOncade();
  }
  if (!isInitialized) return;

  try {
    await sdk.flushTelemetry();
  } catch (error) {
    console.error('Failed to flush telemetry:', error);
  }
}

// Export functions for use in other parts of the game
export {
  initializeOncade,
  getStoreCatalog,
  openPurchaseUrl, // Use after implementing item selection UI
  openTipUrl,
  checkPurchases,
  openLoginUrl, // Optional login function
  getConfig,
  getAllConfig,
  onConfigChange,
  trackEvent,
  flushTelemetry,
  sdk as oncadeSDK // Export sdk instance if needed elsewhere
}; 