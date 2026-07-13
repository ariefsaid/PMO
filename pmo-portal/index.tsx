
import './index.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { installChunkReloadGuard } from '@/src/lib/chunkReload';

// A stale lazy-route chunk (old tab, new deploy) auto-reloads ONCE — 2026-07-13
// hardening fix (root cause: live PostHog captured
// "Failed to fetch dynamically imported module" with no recovery).
installChunkReloadGuard();

// Suppress MetaMask extension errors and ResizeObserver errors from the preview overlay
window.addEventListener('unhandledrejection', (event) => {
  if (event.reason && typeof event.reason.message === 'string' && event.reason.message.includes('MetaMask')) {
    event.preventDefault();
  }
});

const originalError = console.error;
console.error = (...args) => {
  if (args[0] && typeof args[0] === 'string' && args[0].includes('MetaMask')) {
    return;
  }
  originalError.call(console, ...args);
};

window.addEventListener('error', (event) => {
  if (event.message.includes('ResizeObserver loop') || event.message.includes('MetaMask')) {
    event.preventDefault();
  }
});

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
