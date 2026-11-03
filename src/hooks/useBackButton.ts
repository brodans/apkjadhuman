import { useEffect, useRef } from 'react';

// Global registry of active back handlers
if (typeof window !== 'undefined') {
  (window as any).customBackHandlers = (window as any).customBackHandlers || [];
}

export function useBackButton(handler: () => boolean, active: boolean) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!active) return;

    // We define a wrapper that invokes the latest reference of the handler
    const currentWrapper = () => handlerRef.current();
    
    const handlers = (window as any).customBackHandlers;
    handlers.push(currentWrapper);

    return () => {
      const idx = handlers.indexOf(currentWrapper);
      if (idx !== -1) {
        handlers.splice(idx, 1);
      }
    };
  }, [active]);
}
