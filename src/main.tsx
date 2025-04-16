import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';

// Basic mobile detection
const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

const rootElement = document.getElementById('root')!;

if (isMobile) {
    // Display a message if mobile
    rootElement.innerHTML = `
        <div class="mobile-blocker">
            <img src="/assets/title.png" alt="Game Title" />
            <h1>Mobile Not Supported</h1>
            <p>This game is designed for desktop browsers.</p>
        </div>
    `;
} else {
    // Render the main React app if not mobile
    ReactDOM.createRoot(rootElement).render(
        <React.StrictMode>
            <App />
        </React.StrictMode>,
    );
}
