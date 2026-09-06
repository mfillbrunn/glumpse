import { useState } from 'react';
import BrowseScreen from './src/screens/BrowseScreen';
import WelcomeScreen from './src/components/WelcomeScreen';

// GLUMPSE_RESPONSIVE_REFACTOR_V1
export default function App() {
  const [hasEntered, setHasEntered] = useState(false);

  if (!hasEntered) {
    return <WelcomeScreen onEnter={() => setHasEntered(true)} />;
  }

  return <BrowseScreen />;
}
