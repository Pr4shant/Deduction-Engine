
import React from 'react';

interface LayoutProps {
  activeTab: 'field' | 'palace';
  setActiveTab: (tab: 'field' | 'palace') => void;
  children: React.ReactNode;
}

export const Layout: React.FC<LayoutProps> = ({ activeTab, setActiveTab, children }) => {
  return (
    <div className="min-h-screen flex flex-col bg-[#070707] h-screen overflow-hidden">
      <header className="h-16 md:h-24 flex items-center justify-between px-4 md:px-12 border-b border-[#111] z-50 bg-[#070707] shrink-0">
        <div className="flex items-center gap-4 md:gap-16">
          <div className="flex flex-col cursor-default">
            <span className="font-serif text-xl md:text-3xl font-light tracking-tight italic">Sherlock.</span>
            <span className="hidden xs:block text-[7px] md:text-[8px] uppercase tracking-[0.4em] text-[#333] font-bold mt-1">Intelligence Matrix</span>
          </div>
          
          <nav className="flex items-center gap-4 md:gap-12">
            <button
              onClick={() => setActiveTab('field')}
              className={`text-[9px] md:text-[10px] uppercase tracking-[0.2em] md:tracking-[0.3em] font-bold transition-all duration-500 relative py-1 md:py-2 ${
                activeTab === 'field' ? 'text-white' : 'text-[#444] hover:text-[#777]'
              }`}
            >
              Field
              <div className={`absolute -bottom-1 left-0 h-[1px] bg-white transition-all duration-700 ${activeTab === 'field' ? 'w-full opacity-100' : 'w-0 opacity-0'}`}></div>
            </button>
            <button
              onClick={() => setActiveTab('palace')}
              className={`text-[9px] md:text-[10px] uppercase tracking-[0.2em] md:tracking-[0.3em] font-bold transition-all duration-500 relative py-1 md:py-2 ${
                activeTab === 'palace' ? 'text-white' : 'text-[#444] hover:text-[#777]'
              }`}
            >
              Palace
              <div className={`absolute -bottom-1 left-0 h-[1px] bg-white transition-all duration-700 ${activeTab === 'palace' ? 'w-full opacity-100' : 'w-0 opacity-0'}`}></div>
            </button>
          </nav>
        </div>

        <div className="flex items-center gap-4 md:gap-10">
          <div className="flex items-center gap-2 md:gap-3">
            <div className={`w-1 h-1 rounded-full ${activeTab === 'field' ? 'bg-white' : 'bg-[#111]'}`}></div>
            <span className="hidden sm:inline text-[9px] font-mono uppercase tracking-[0.3em] text-[#333]">System v2.5.0</span>
          </div>
        </div>
      </header>

      <main className="flex-1 relative overflow-hidden bg-[#070707]">
        {children}
      </main>
    </div>
  );
};
