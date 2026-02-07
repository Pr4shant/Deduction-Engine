
import React from 'react';

interface LayoutProps {
  activeTab: 'field' | 'palace';
  setActiveTab: (tab: 'field' | 'palace') => void;
  children: React.ReactNode;
}

export const Layout: React.FC<LayoutProps> = ({ activeTab, setActiveTab, children }) => {
  return (
    <div className="min-h-screen flex flex-col bg-[#0a0a0a]">
      <header className="h-20 flex items-center justify-between px-10 border-b border-[#1a1a1a] z-50">
        <div className="flex items-center gap-8">
          <div className="flex flex-col">
            <span className="font-serif text-2xl font-medium tracking-tight">Sherlock</span>
            <span className="text-[9px] uppercase tracking-[0.3em] text-[#737373] mt-[-4px]">Forensic Intelligence</span>
          </div>
          
          <nav className="hidden md:flex items-center gap-8 ml-12">
            <button
              onClick={() => setActiveTab('field')}
              className={`text-xs uppercase tracking-[0.2em] font-medium transition-all duration-300 relative py-2 ${
                activeTab === 'field' ? 'text-white' : 'text-[#525252] hover:text-white'
              }`}
            >
              Observation
              {activeTab === 'field' && <span className="absolute bottom-0 left-0 w-full h-[1px] bg-white animate-in fade-in slide-in-from-left-2"></span>}
            </button>
            <button
              onClick={() => setActiveTab('palace')}
              className={`text-xs uppercase tracking-[0.2em] font-medium transition-all duration-300 relative py-2 ${
                activeTab === 'palace' ? 'text-white' : 'text-[#525252] hover:text-white'
              }`}
            >
              Mind Palace
              {activeTab === 'palace' && <span className="absolute bottom-0 left-0 w-full h-[1px] bg-white animate-in fade-in slide-in-from-left-2"></span>}
            </button>
          </nav>
        </div>

        <div className="flex items-center gap-6">
          <div className="flex items-center gap-3">
            <div className={`w-1.5 h-1.5 rounded-full ${activeTab === 'field' ? 'bg-white animate-pulse' : 'bg-[#262626]'}`}></div>
            <span className="text-[10px] font-mono uppercase tracking-widest text-[#737373]">Live Feed</span>
          </div>
        </div>
      </header>

      <main className="flex-1 relative">
        {children}
      </main>
    </div>
  );
};
