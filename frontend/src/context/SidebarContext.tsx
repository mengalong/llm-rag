/**
 * SidebarContext — lets any Tab component inject content into the global sidebar.
 *
 * Usage:
 *   const { setSidebarContent } = useSidebar()
 *   useEffect(() => {
 *     setSidebarContent(<MyPanel />)
 *     return () => setSidebarContent(null)
 *   }, [deps])
 */
import { createContext, useContext, useState, type ReactNode } from 'react'

interface SidebarContextValue {
  sidebarContent: ReactNode
  setSidebarContent: (node: ReactNode) => void
}

const SidebarContext = createContext<SidebarContextValue>({
  sidebarContent: null,
  setSidebarContent: () => {},
})

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [sidebarContent, setSidebarContent] = useState<ReactNode>(null)
  return (
    <SidebarContext.Provider value={{ sidebarContent, setSidebarContent }}>
      {children}
    </SidebarContext.Provider>
  )
}

export function useSidebar() {
  return useContext(SidebarContext)
}
