import { useEffect, useState } from 'react';

/**
 * Keep a closing modal mounted until its exit animation finishes.
 *
 * @param isOpen - Whether the modal should be open according to parent state
 * @param duration - Duration of the exit animation in ms (default: 300)
 * @returns { isMounted: boolean, isClosing: boolean }
 */
export function useModalAnimation(isOpen: boolean, duration: number = 300) {
  const [isMounted, setIsMounted] = useState(isOpen);
  const [isClosing, setIsClosing] = useState(false);

  if (isOpen && !isMounted) {
    setIsMounted(true);
    setIsClosing(false);
  }

  useEffect(() => {
    // Start the exit animation as soon as the parent closes the modal.
    if (!isOpen && isMounted && !isClosing) {
      // Trigger cooling-off/exit animation state
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsClosing(true);
    }
  }, [isOpen, isMounted, isClosing]);

  useEffect(() => {
    if (isClosing) {
      const timer = setTimeout(() => {
        setIsMounted(false);
        setIsClosing(false);
      }, duration);
      return () => clearTimeout(timer);
    }
  }, [isClosing, duration]);

  return { isMounted, isClosing };
}
