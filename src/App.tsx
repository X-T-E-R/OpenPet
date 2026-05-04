import { PetWindow } from './PetWindow';
import { SettingsPage } from './SettingsPage';

function getWindowKind() {
  return new URLSearchParams(window.location.search).get('window') === 'pet' ? 'pet' : 'settings';
}

export function App() {
  return getWindowKind() === 'pet' ? <PetWindow /> : <SettingsPage />;
}
