import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import { installTauriApi } from './tauri';

async function bootstrap() {
  await installTauriApi();
  const container = document.getElementById('root');
  if (container) {
    const root = createRoot(container);
    root.render(React.createElement(App));
  }
}

void bootstrap();
