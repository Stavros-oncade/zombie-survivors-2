import React from 'react';
import { PurchaseItem } from '@oncade/sdk'; // Assuming PurchaseItem is exported or defined elsewhere
import { openPurchaseUrl } from '../oncade/OncadeIntegration'; // Import the purchase function
import { EventBus } from '../game/EventBus'; // Import EventBus to emit close event

interface StoreScreenProps {
  items: PurchaseItem[];
  // onClose: () => void; // We'll use EventBus to close instead
}

// Helper to format price from cents to dollars
const formatPrice = (priceInCents: number): string => {
  return `$${(priceInCents / 100).toFixed(2)}`;
};

const StoreScreen: React.FC<StoreScreenProps> = ({ items }) => {

  const handleBuyClick = (itemId?: string) => {
    if (!itemId) {
      console.error('Item ID is missing, cannot purchase.');
      alert('Cannot purchase this item: ID missing.');
      return;
    }
    console.log(`Attempting to purchase item: ${itemId}`);
    openPurchaseUrl(itemId);
    // Optionally close the store screen immediately after initiating purchase,
    // or wait for redirect handling.
    // handleClose(); 
  };

  const handleClose = () => {
    EventBus.emit('hide-store');
  };

  if (!items || items.length === 0) {
    return (
      <div style={styles.overlay}>
        <div style={styles.container}>
          <h2>Store</h2>
          <p>No items available at the moment.</p>
          <button onClick={handleClose} style={styles.closeButton}>Close</button>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.overlay}>
      <div style={styles.container}>
        <button onClick={handleClose} style={styles.closeButtonTopRight}>X</button>
        <h2>Store</h2>
        <div style={styles.itemList}>
          {items.map((item) => (
            <div key={item._id || item.name} style={styles.itemCard}>
              {item.imageUrl && (
                <img src={item.imageUrl} alt={item.name} style={styles.itemImage} />
              )}
              <h3 style={styles.itemName}>{item.name}</h3>
              <p style={styles.itemDescription}>{item.description}</p>
              <p style={styles.itemPrice}>{formatPrice(item.price)}</p>
              <button 
                onClick={() => handleBuyClick(item._id)} 
                disabled={!item._id} 
                style={styles.buyButton}
              >
                {item._id ? 'Buy' : 'Unavailable'}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// Basic inline styles
const styles: { [key: string]: React.CSSProperties } = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.7)', // Semi-transparent black overlay
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000, // Ensure it's above the Phaser canvas
  },
  container: {
    backgroundColor: '#fff',
    padding: '30px',
    borderRadius: '8px',
    boxShadow: '0 4px 15px rgba(0, 0, 0, 0.2)',
    width: '80%',
    maxWidth: '800px',
    maxHeight: '80vh',
    overflowY: 'auto',
    position: 'relative',
    textAlign: 'center',
    color: '#333',
  },
  closeButtonTopRight: {
    position: 'absolute',
    top: '10px',
    right: '10px',
    background: '#eee',
    border: 'none',
    borderRadius: '50%',
    width: '30px',
    height: '30px',
    fontSize: '16px',
    fontWeight: 'bold',
    cursor: 'pointer',
    lineHeight: '30px',
    textAlign: 'center',
  },
  itemList: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', // Responsive grid
    gap: '20px',
    marginTop: '20px',
    textAlign: 'left',
  },
  itemCard: {
    border: '1px solid #ddd',
    borderRadius: '4px',
    padding: '15px',
    backgroundColor: '#f9f9f9',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
  },
  itemImage: {
    maxWidth: '100%',
    maxHeight: '120px', // Limit image height
    height: 'auto',
    marginBottom: '10px',
    objectFit: 'contain',
  },
  itemName: {
    fontSize: '1.1em',
    margin: '10px 0 5px 0',
    color: '#111',
  },
  itemDescription: {
    fontSize: '0.9em',
    color: '#555',
    flexGrow: 1, // Allow description to take up space
    marginBottom: '10px',
  },
  itemPrice: {
    fontSize: '1em',
    fontWeight: 'bold',
    color: '#007bff',
    marginBottom: '15px',
  },
  buyButton: {
    padding: '8px 15px',
    backgroundColor: '#28a745',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '0.9em',
    marginTop: 'auto', // Push button to bottom
  },
  closeButton: { // Style for the close button when no items are present
    padding: '10px 20px',
    backgroundColor: '#6c757d',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '1em',
    marginTop: '20px',
  },
};

export default StoreScreen; 