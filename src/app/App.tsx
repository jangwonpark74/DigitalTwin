import { useState } from 'react';
import ActivityPreview from '../legacy/ActivityPreview';
import { routeFromSearch } from './routeRegistry';

export default function App() {
  const previewRoute = document.body.dataset.previewRoute
    ?? (window.location.pathname === '/frontend-preview.html' ? 'activity' : undefined);
  const [previewStarted, setPreviewStarted] = useState(false);
  if (previewRoute === 'activity' && !previewStarted) return <main className="app-preview-launcher">
    <h1>React workspace preview</h1>
    <p>Open the activity route to inspect the migrated React workspace.</p>
    <button type="button" onClick={() => setPreviewStarted(true)}>Preview activity route</button>
  </main>;
  return <ActivityPreview syncUrl initialRoute={routeFromSearch(window.location.search) ?? (previewRoute === 'activity' ? 'activity' : 'overview')} />;
}
