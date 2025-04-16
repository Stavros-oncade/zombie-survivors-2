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
      window.location.href = purchaseUrl; // Redirect the main window
    } else {
      console.warn('Could not get purchase URL. Item might be invalid or store unavailable.');
      // Inform the user appropriately
    }
  } catch (error) {
    console.error(`Failed to get purchase URL for item ${itemId}:`, error);
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
      // Open tip URL in a new window/tab for better UX
      window.open(tipUrl, '_blank');
    } else {
        console.warn('Could not get tip URL.');
        // Inform the user appropriately
    }
  } catch (error) {
      console.error('Failed to get tip URL:', error);
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
       window.location.href = loginUrl; // Redirect the main window
     } else {
         console.warn('Could not get login URL.');
     }
   } catch (error) {
       console.error('Failed to get login URL:', error);
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
  sdk as oncadeSDK // Export sdk instance if needed elsewhere
}; 