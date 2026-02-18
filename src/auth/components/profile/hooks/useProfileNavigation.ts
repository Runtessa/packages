import { useCallback, useMemo, useRef, useState } from 'react';
import {
  RailKey,
  mobileAfterHomeKeys,
  mobileBeforeHomeKeys,
  mobilePrimaryKeys,
  railItems,
} from '../config';

interface UseProfileNavigationParams {
  copy: {
    nav: {
      home: string;
      personalInfo: string;
      contactInfo: string;
      dataPrivacy: string;
      security: string;
      twoFactor: string;
    };
  };
  isRtl: boolean;
  logout: () => Promise<void>;
}

export const useProfileNavigation = ({
  copy,
  isRtl,
  logout,
}: UseProfileNavigationParams) => {
  const [activeRail, setActiveRail] = useState<RailKey>('home');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const mobileMenuRef = useRef<HTMLDivElement | null>(null);

  const mobileBeforeHomeItems = useMemo(
    () => railItems.filter((item) => mobileBeforeHomeKeys.includes(item.key)),
    [],
  );
  const mobileAfterHomeItems = useMemo(
    () => railItems.filter((item) => mobileAfterHomeKeys.includes(item.key)),
    [],
  );
  const mobileHomeItem = useMemo(
    () => railItems.find((item) => item.key === 'home') || null,
    [],
  );
  const mobileOverflowItems = useMemo(
    () => railItems.filter((item) => !mobilePrimaryKeys.includes(item.key)),
    [],
  );

  const mobileMoreActive = useMemo(
    () => mobileOverflowItems.some((item) => item.key === activeRail),
    [activeRail, mobileOverflowItems],
  );

  const railLabels: Record<RailKey, string> = useMemo(
    () => ({
      home: copy.nav.home,
      'personal-info': copy.nav.personalInfo,
      'contact-info': copy.nav.contactInfo,
      'data-privacy': copy.nav.dataPrivacy,
      security: copy.nav.security,
      'two-factor': copy.nav.twoFactor,
    }),
    [copy],
  );

  const handleSectionNav = useCallback((key: RailKey, sectionId: string) => {
    setActiveRail(key);
    setMobileMenuOpen(false);
    window.requestAnimationFrame(() => {
      const node = document.getElementById(sectionId);
      if (node) {
        node.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }, []);

  const closeMobileMenu = useCallback(() => {
    setMobileMenuOpen(false);
  }, []);

  const handleLogout = useCallback(() => {
    setMobileMenuOpen(false);
    void logout();
  }, [logout]);

  return {
    activeRail,
    mobileMenuOpen,
    setMobileMenuOpen,
    mobileMenuRef,
    mobileBeforeHomeItems,
    mobileAfterHomeItems,
    mobileHomeItem,
    mobileOverflowItems,
    mobileMoreActive,
    railLabels,
    handleSectionNav,
    closeMobileMenu,
    handleLogout,
    toggleCornerClass: isRtl ? 'left-4' : 'right-4',
  };
};
