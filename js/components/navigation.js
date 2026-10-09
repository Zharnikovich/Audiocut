// Audiocut - Navigation & Global Audio Coordinator

const audioStoppers = new Set();

export function registerAudioStopper(callback) {
  if (typeof callback === 'function') {
    audioStoppers.add(callback);
  }
}

export function stopAllActiveAudio() {
  audioStoppers.forEach(fn => {
    try {
      fn();
    } catch (err) {
      console.warn('Audio stopper failed:', err);
    }
  });

  if (window.currentlyPlayingAudio) {
    window.currentlyPlayingAudio.pause();
    window.currentlyPlayingAudio = null;
  }
}

export function switchView(targetViewId) {
  stopAllActiveAudio();

  const featureNavBtns = document.querySelectorAll('.feature-nav-btn');
  const featureViews = document.querySelectorAll('.feature-view');
  const sidebarNav = document.getElementById('sidebarNav');

  featureNavBtns.forEach(btn => {
    const view = btn.getAttribute('data-view');
    const isTarget = view === targetViewId;
    if (isTarget) {
      btn.className = 'feature-nav-btn w-full text-left p-3.5 bg-neoYellow border-3 border-black shadow-[4px_4px_0px_0px_#000] font-black uppercase text-xs tracking-wider flex items-center justify-between transition-all translate-x-[-1px] translate-y-[-1px]';
      const sub = btn.querySelector('p:last-child');
      if (sub) sub.className = 'text-[9px] font-bold text-black/70 normal-case tracking-normal mt-0.5';
    } else {
      btn.className = 'feature-nav-btn w-full text-left p-3.5 bg-white hover:bg-black hover:text-white text-black border-2 border-black shadow-[2px_2px_0px_0px_#000] font-black uppercase text-xs tracking-wider flex items-center justify-between transition-all hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[3px_3px_0px_0px_#000] group';
      const sub = btn.querySelector('p:last-child');
      if (sub) sub.className = 'text-[9px] font-bold text-slate-500 group-hover:text-slate-300 normal-case tracking-normal mt-0.5';
    }
  });

  featureViews.forEach(viewEl => {
    if (viewEl.id === targetViewId) {
      viewEl.classList.remove('hidden');
    } else {
      viewEl.classList.add('hidden');
    }
  });

  // On mobile screens, collapse sidebar after selection
  if (window.innerWidth < 768 && sidebarNav) {
    sidebarNav.classList.add('hidden');
  }

  if (window.lucide) {
    window.lucide.createIcons();
  }

  // Notify views of layout change so canvases re-render
  window.dispatchEvent(new CustomEvent('viewchanged', { detail: { viewId: targetViewId } }));
}

export function initNavigation() {
  const featureNavBtns = document.querySelectorAll('.feature-nav-btn');
  const mobileMenuToggle = document.getElementById('mobileMenuToggle');
  const sidebarNav = document.getElementById('sidebarNav');

  if (mobileMenuToggle && sidebarNav) {
    mobileMenuToggle.addEventListener('click', () => {
      sidebarNav.classList.toggle('hidden');
    });
  }

  featureNavBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.getAttribute('data-view');
      if (target) switchView(target);
    });
  });
}
