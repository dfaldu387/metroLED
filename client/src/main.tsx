import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'
import { QueryClientProvider } from '@tanstack/react-query'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AppToaster } from '@/lib/toast'
import { queryClient } from '@/lib/query'
import { router } from '@/app/router'
import './globals.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* Keyboard users land here first, so they can skip the sidebar. */}
    <a
      href="#main-content"
      className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-brand-600 focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white"
    >
      Skip to main content
    </a>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={200} skipDelayDuration={300}>
        <RouterProvider router={router} />
        <AppToaster />
      </TooltipProvider>
    </QueryClientProvider>
  </StrictMode>,
)
