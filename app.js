// Audiocut Studio - Application Entry Point
import { initEnvironment } from './js/services/storage.js';
import { initNavigation } from './js/components/navigation.js';
import { initSplitter } from './js/modules/splitter.js';
import { initTrimmer } from './js/modules/trimmer.js';
import { initMerger } from './js/modules/merger.js';
import { initEffects } from './js/modules/effects.js';
import { initConverter } from './js/modules/converter.js';

function bootstrap() {
  // 1. Initialize environment & storage integrations
  initEnvironment();

  // 2. Initialize navigation & view coordinator
  initNavigation();

  // 3. Initialize studio tools
  initSplitter();
  initTrimmer();
  initMerger();
  initEffects();
  initConverter();

  // 4. Render icons
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}
