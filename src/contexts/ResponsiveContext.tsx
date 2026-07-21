import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';

export type ScreenSize = 'mobile' | 'tablet' | 'desktop';

export interface ResponsiveContextType {
  screenSize: ScreenSize;
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
}

const ResponsiveContext = createContext<ResponsiveContextType | null>(null);

export function ResponsiveProvider({ children }: { children: ReactNode }) {
  const [screenSize, setScreenSize] = useState<ScreenSize>('desktop');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    const handleResize = () => {
      const width = window.innerWidth;
      if (width < 768) {
        setScreenSize('mobile');
        setSidebarCollapsed(false);
      } else if (width < 1024) {
        setScreenSize('tablet');
        setSidebarCollapsed(true);
      } else {
        setScreenSize('desktop');
        setSidebarCollapsed(false);
      }
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <ResponsiveContext.Provider
      value={{
        screenSize,
        isMobile: screenSize === 'mobile',
        isTablet: screenSize === 'tablet',
        isDesktop: screenSize === 'desktop',
        sidebarOpen,
        setSidebarOpen,
        sidebarCollapsed,
        setSidebarCollapsed,
      }}
    >
      {children}
    </ResponsiveContext.Provider>
  );
}

export function useResponsive() {
  const context = useContext(ResponsiveContext);
  if (!context) {
    throw new Error('useResponsive must be used within ResponsiveProvider');
  }
  return context;
}
